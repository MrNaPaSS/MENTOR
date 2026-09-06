"""Фоновое ведение позиций: стоп в безубыток и дальше за целями.

Адаптация `PositionManager` из бота AlgoTradeWEEX. Смысл в одной фразе: сделку
нельзя оставлять без присмотра, когда трейдер закрыл вкладку. Цель исполняется
на бирже сама, а перенести после неё стоп некому — биржа таких правил не знает.

Исполнение целей узнаём опросом самих ордеров, а не по остатку позиции: так
сделано и в боте, и по делу — биржа знает исполненный объём точно, а остаток
врёт на частичном исполнении и округлении лота.

Решение вынесено в чистую функцию `decide`: ни сети, ни базы, ни таймеров — их
там нет намеренно, потому что ошибка в этих правилах стоит трейдеру денег.
Цикл вокруг тонкий и весь про доставку.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import timezone
from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy import select

from core.models import LiveTrade, ScalpTrade, WeexCredential, utcnow
from core.trading.position import (
    Position,
    should_move_stop,
    stop_after_take,
    take_share,
    takes_covered,
)
from core.weex import keys as keystore
from core.weex.futures import (
    Credentials,
    WeexFutures,
    WeexTradeError,
    floor_to_step,
    plan_order_id,
    round_to_tick,
)

logger = logging.getLogger("nmnh.trading.watcher")

# Как часто обходим позиции. Пятнадцать секунд — как в боте: цель исполняется
# мгновенно, но перенос стопа секундой позже ничего не меняет, а каждый обход
# это запрос на биржу за каждого ученика.
POLL_INTERVAL = 15.0

# Сколько проверок подряд позиция может отсутствовать, прежде чем считать её
# закрытой. Ответ приходит не мгновенно, и одна пустая выдача сразу после
# ордера значит «заявка ещё стоит», а не «сделка закрыта».
MISSING_TOLERANCE = 2

# Статусы биржи, означающие «ордер отработал».
FILLED_STATES = {"FILLED", "FULLY_FILLED", "CLOSED", "DONE", "FINISHED"}


@dataclass
class Decision:
    """Что делать со сделкой по итогам одной проверки."""

    takes_hit: int
    move_stop_to: float | None = None
    opened: bool = False
    closed: bool = False
    filled_orders: list[str] = field(default_factory=list)


def position_size(position: dict[str, Any] | None) -> float:
    """Объём позиции из ответа биржи: поле называется по-разному."""
    if not position:
        return 0.0
    for name in ("total", "size", "positionAmt", "available"):
        value = position.get(name)
        if value is None:
            continue
        try:
            return abs(float(value))
        except (TypeError, ValueError):
            continue
    return 0.0


def takes_filled(planned_qty: float, current_qty: float, targets: int) -> int:
    """Сколько целей исполнено, судя по остатку позиции.

    Считаем по объёму, а не по статусу ордера: цели у нас условные заявки, и
    обычная ручка состояния ордера про них не знает — она отвечала «не найдено»,
    из-за чего исполнение целей не замечалось вовсе, а стоп так и не переезжал
    в безубыток.

    Доли неравные — 30%, 50%, остаток, — поэтому делением не обойтись.
    """
    if targets <= 0 or planned_qty <= 0:
        return 0
    closed = max(0.0, planned_qty - current_qty)
    return takes_covered(closed / planned_qty, targets)


def decide(
    trade: LiveTrade,
    position: dict[str, Any] | None,
    open_plans: set[str],
    mark_price: float | None,
    missing_streak: int,
) -> Decision:
    """Решение по одной сделке. Только числа, никаких обращений наружу.

    `open_plans` — идентификаторы условных заявок, которые ещё висят на бирже.
    """
    size = position_size(position)

    if trade.status == "waiting":
        # Позиция появилась — заявка входа исполнилась.
        return Decision(trade.takes_hit, opened=size > 0)

    if size <= 0 and missing_streak >= MISSING_TOLERANCE:
        return Decision(trade.takes_hit, closed=True)

    takes: list[dict[str, Any]] = json.loads(trade.tp_orders_json or "[]")
    hit = max(trade.takes_hit, takes_filled(float(trade.qty), size, len(takes)))
    if hit <= trade.takes_hit:
        return Decision(trade.takes_hit)

    # Отмечаем сработавшими те цели, которых уже нет среди висящих заявок, — по
    # порядку и не больше, чем показал остаток позиции.
    filled: list[str] = []
    for take in takes:
        if take.get("filled") or len(filled) >= hit - trade.takes_hit:
            continue
        order_id = str(take.get("order_id") or "")
        if order_id and order_id not in open_plans:
            filled.append(order_id)

    state = Position(
        symbol=trade.symbol,
        side=trade.side,
        entry=float(trade.entry),
        quantity=size,
        stop=float(trade.current_stop),
    )
    prices = [float(t.get("price") or 0) for t in takes]

    # После первой цели предпочитаем безубыток самой биржи: он учитывает
    # реальную цену исполнения, комиссию и фандинг, а после частичного закрытия
    # ещё и смещается. Своей формулой пользуемся, только если биржа молчит.
    target = None
    if hit == 1:
        target = exchange_breakeven(position)
    if target is None:
        target = stop_after_take(state, hit, prices, mark_price)
    if target is not None and not should_move_stop(state, target):
        target = None

    return Decision(hit, move_stop_to=target, filled_orders=filled)


class PositionWatcher:
    """Обходит открытые сделки всех учеников и доводит их до конца."""

    def __init__(self, session_factory, http_session_factory, interval: float = POLL_INTERVAL):
        self._sessions = session_factory
        self._http = http_session_factory
        self.interval = interval
        self._task: asyncio.Task | None = None
        self._missing: dict[int, int] = {}

    def start(self) -> None:
        if not keystore.enabled():
            logger.info("Ведение позиций выключено: не задан ключ шифрования")
            return
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="trading-watcher")
            logger.info("Ведение позиций запущено, опрос раз в %.0f с", self.interval)

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — сбой обхода не роняет сервер
                logger.warning("Сбой ведения позиций: %s", exc)

    async def tick(self) -> None:
        """Один обход: по одному запросу позиций на ученика."""
        session = self._sessions()
        try:
            trades = (
                session.execute(
                    select(LiveTrade).where(LiveTrade.status.in_(("waiting", "open")))
                )
                .scalars()
                .all()
            )
            if not trades:
                return

            by_student: dict[int, list[LiveTrade]] = {}
            for trade in trades:
                by_student.setdefault(trade.student_id, []).append(trade)

            for student_id, group in by_student.items():
                try:
                    await self._handle_student(session, student_id, group)
                except Exception as exc:  # noqa: BLE001 — один ученик не мешает другим
                    logger.warning("Ученик %s: %s", student_id, exc)
            session.commit()
        finally:
            session.close()

    async def _handle_student(self, session, student_id: int, trades: Iterable[LiveTrade]) -> None:
        row = session.execute(
            select(WeexCredential).where(WeexCredential.student_id == student_id)
        ).scalar_one_or_none()
        if row is None or not row.is_active:
            return

        client = WeexFutures(
            Credentials(
                keystore.decrypt(row.api_key_enc),
                keystore.decrypt(row.secret_enc),
                keystore.decrypt(row.passphrase_enc),
            ),
            self._http,
        )
        positions = await client.positions()
        by_symbol = {str(p.get("symbol", "")).upper(): p for p in positions}

        for trade in trades:
            position = by_symbol.get(trade.symbol.upper())
            streak = self._missing.get(trade.id, 0)
            self._missing[trade.id] = streak + 1 if position_size(position) <= 0 else 0

            plans = await self._open_plans(client, trade)
            decision = decide(
                trade, position, plans, mark_price(position), self._missing[trade.id]
            )
            await self._apply(session, client, trade, decision)

    async def _open_plans(self, client: WeexFutures, trade: LiveTrade) -> set[str]:
        """Условные заявки, которые ещё висят на бирже.

        Сработавшая заявка со списка уходит — по её отсутствию и понятно, что
        цель взята. Спрашивать состояние каждой по отдельности нечем: обычная
        ручка ордера про условные не знает.
        """
        if trade.status != "open":
            return set()
        try:
            orders = await client.algo_orders(trade.symbol)
        except WeexTradeError as exc:
            logger.debug("Условные заявки %s не получены: %s", trade.symbol, exc)
            # Пустой ответ означал бы «все цели сработали» — при сбое связи это
            # неправда, поэтому возвращаем то, что записано у нас.
            return {
                str(t.get("order_id") or "")
                for t in json.loads(trade.tp_orders_json or "[]")
                if not t.get("filled")
            }
        return {
            str(o.get("orderId") or o.get("algoId") or o.get("id") or "")
            for o in orders
        }

    async def _apply(
        self, session, client: WeexFutures, trade: LiveTrade, decision: Decision
    ) -> None:
        changed = False

        if decision.opened:
            trade.status = "open"
            trade.opened_at = utcnow()
            changed = True
            logger.info("Позиция набрана: %s (%s)", trade.symbol, trade.client_id)

        # Цели ставим, когда позиция есть, а их ещё нет. До набора позиции биржа
        # сокращающий ордер не принимает — «cannot set reduce only», — поэтому
        # при лимитном входе лестница доезжает сюда, а не выставляется сразу.
        if trade.status == "open" and not json.loads(trade.tp_orders_json or "[]"):
            if await self._place_takes(client, trade):
                changed = True

        if decision.filled_orders:
            takes = json.loads(trade.tp_orders_json or "[]")
            for take in takes:
                if str(take.get("order_id") or "") in decision.filled_orders:
                    take["filled"] = True
            trade.tp_orders_json = json.dumps(takes, ensure_ascii=False)
            trade.takes_hit = decision.takes_hit
            changed = True
            logger.info("Цель взята: %s, всего %d", trade.symbol, trade.takes_hit)

        if decision.move_stop_to is not None:
            order_id = trade.sl_order_id or await self._find_stop_order(client, trade)
            if not order_id:
                logger.warning("Стоп-ордер %s не найден на бирже", trade.symbol)
            else:
                try:
                    await client.modify_tp_sl(
                        symbol=trade.symbol,
                        order_id=order_id,
                        trigger_price=num(decision.move_stop_to),
                    )
                    trade.sl_order_id = order_id
                    trade.current_stop = decision.move_stop_to
                    changed = True
                    logger.info(
                        "Стоп %s переставлен на %s после %d целей",
                        trade.symbol,
                        decision.move_stop_to,
                        trade.takes_hit,
                    )
                except WeexTradeError as exc:
                    # Не переставился — сделка остаётся с прежним стопом. Записать
                    # в базу перенос, которого не было, значит соврать себе же на
                    # следующем обходе.
                    logger.warning("Стоп %s не переставлен: %s", trade.symbol, exc)

        if decision.closed:
            trade.status = "closed"
            trade.closed_at = utcnow()
            changed = True
            self._missing.pop(trade.id, None)
            await self._record(session, client, trade)
            logger.info("Позиция закрыта: %s", trade.symbol)

        if changed:
            trade.updated_at = utcnow()

    async def _place_takes(self, client: WeexFutures, trade: LiveTrade) -> bool:
        """Выставить лестницу целей на уже открытой позиции."""
        prices: list[float] = json.loads(trade.targets_json or "[]")
        if not prices:
            return False

        filters = await client.symbol_filters(trade.symbol)
        # Наименьшая из долей: если даже она не набирает шага лота, лестницу
        # ставить нечем.
        smallest = min(take_share(i, len(prices)) for i in range(len(prices)))
        share = floor_to_step(float(trade.qty) * smallest, filters["step"])
        if share < filters["min_qty"]:
            # Объём не делится на цели — закрывать позицию будет стоп или сам
            # трейдер. Молча оставить сделку без целей честнее, чем поставить
            # одну на весь объём: расчёт был не такой.
            logger.info("Объём %s не делится на цели, лестница не ставится", trade.symbol)
            trade.targets_json = "[]"
            return True

        long = trade.side == "long"
        placed: list[dict[str, Any]] = []
        for i, price in enumerate(prices):
            try:
                # Условная заявка, а не сокращающий лимит: на позиции с висящей
                # защитой биржа отвечает «cannot set reduce only» — свободного к
                # сокращению объёма у неё нет, он весь зарезервирован стопом.
                order = await client.place_tp_sl(
                    symbol=trade.symbol,
                    plan_type="TAKE_PROFIT",
                    trigger_price=num(round_to_tick(price, filters["tick"])),
                    quantity=num(
                        floor_to_step(
                            float(trade.qty) * take_share(i, len(prices)), filters["step"]
                        )
                    ),
                    position_side="LONG" if long else "SHORT",
                    client_algo_id=f"tp{i + 1}_{trade.client_id}"[:32],
                )
            except WeexTradeError as exc:
                logger.warning("Цель %d %s не встала: %s", i + 1, trade.symbol, exc)
                break
            placed.append(
                {"price": price, "order_id": plan_order_id(order), "filled": False}
            )

        if not placed:
            return False
        trade.tp_orders_json = json.dumps(placed, ensure_ascii=False)
        logger.info("Цели выставлены: %s, %d шт.", trade.symbol, len(placed))
        return True

    async def _find_stop_order(self, client: WeexFutures, trade: LiveTrade) -> str:
        """Найти стоп этой позиции среди условных заявок.

        Стоп ставится вместе со входом, и его идентификатор биржа возвращает не
        в ответе на ордер, а в списке условных заявок.
        """
        try:
            orders = await client.algo_orders(trade.symbol)
        except WeexTradeError:
            return ""

        # Цели — тоже условные заявки, и перепутать их со стопом нельзя:
        # передвинутая «в безубыток» цель закрыла бы позицию по цене входа.
        ours = {
            str(t.get("order_id") or "")
            for t in json.loads(trade.tp_orders_json or "[]")
        }
        for order in orders:
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if order_id in ours:
                continue
            kind = str(order.get("planType") or order.get("type") or "").lower()
            if "sl" in kind or "stop" in kind or "loss" in kind:
                return order_id
        return ""

    async def _record(self, session, client: WeexFutures, trade: LiveTrade) -> None:
        """Записать закрытую сделку в журнал по реальным исполнениям.

        Результат берём у биржи, а не считаем сами: наш расчёт не знает ни
        проскальзывания, ни комиссии, и в журнале появилась бы прибыль, которой
        не было.
        """
        exists = session.execute(
            select(ScalpTrade)
            .where(ScalpTrade.student_id == trade.student_id)
            .where(ScalpTrade.client_id == trade.client_id)
        ).scalar_one_or_none()
        if exists is not None:
            return

        gross = 0.0
        fee = 0.0
        exit_price: float | None = None
        try:
            since = trade.opened_at or trade.created_at
            # Наивную дату из базы считаем UTC: `timestamp()` у неё считает по
            # местному времени, и окно исполнений уезжало бы на разницу поясов.
            aware = (
                since if since is None or since.tzinfo else since.replace(tzinfo=timezone.utc)
            )
            opened_ms = int(aware.timestamp() * 1000) if aware else 0
            for fill in await client.user_trades(trade.symbol, limit=100):
                try:
                    if int(fill.get("time", 0)) < opened_ms:
                        continue
                    gross += float(fill.get("realizedPnl") or 0)
                    fee += abs(float(fill.get("commission") or 0))
                    price = float(fill.get("price") or 0)
                    if price > 0:
                        exit_price = price
                except (TypeError, ValueError):
                    continue
        except WeexTradeError as exc:
            logger.warning("Исполнения %s не получены: %s", trade.symbol, exc)

        # В журнал идёт то, что осталось на счёте: биржа считает результат до
        # комиссии, а трейдер видит после.
        pnl = gross - fee

        session.add(
            ScalpTrade(
                student_id=trade.student_id,
                client_id=trade.client_id,
                symbol=trade.symbol,
                side=trade.side,
                entry=float(trade.entry),
                stop=float(trade.initial_stop),
                exit_price=exit_price,
                qty=float(trade.qty),
                margin=float(trade.margin or 0) or 1.0,
                leverage=trade.leverage,
                takes_hit=trade.takes_hit,
                outcome="take" if pnl > 0 else "stop",
                pnl=pnl,
                opened_at=trade.opened_at,
                closed_at=trade.closed_at or utcnow(),
                note="биржа",
            )
        )


def exchange_breakeven(position: dict[str, Any] | None) -> float | None:
    """Цена безубытка, посчитанная самой биржей.

    Она знает то, чего не знаем мы: по какой цене реально исполнился вход,
    сколько удержано комиссии и фандинга, и как всё это сдвинулось после
    частичного закрытия. Наша формула — запасной вариант, а не основной.
    """
    if not position:
        return None
    for name in ("breakEvenPrice", "breakevenPrice", "breakEven", "bePrice"):
        try:
            price = float(position.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if price > 0:
            return price
    return None


def mark_price(position: dict[str, Any] | None) -> float | None:
    if not position:
        return None
    for name in ("markPrice", "marketPrice", "lastPrice", "averageOpenPrice"):
        try:
            price = float(position.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if price > 0:
            return price
    return None


def num(value: float) -> str:
    """Число для биржи строкой, без экспоненты."""
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"
