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
from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy import select

from core.models import LiveTrade, ScalpTrade, WeexCredential, utcnow
from core.trading.position import Position, should_move_stop, stop_after_take
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures, WeexTradeError

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


def order_filled(order: dict[str, Any] | None) -> bool:
    """Исполнен ли ордер целиком."""
    if not order:
        return False
    state = str(order.get("status") or order.get("state") or "").upper()
    if state in FILLED_STATES:
        return True
    # Некоторые ответы не несут статуса вовсе — тогда смотрим на объём.
    try:
        executed = float(order.get("executedQty") or order.get("executedQuantity") or 0)
        total = float(order.get("origQty") or order.get("quantity") or 0)
    except (TypeError, ValueError):
        return False
    return total > 0 and executed >= total * 0.999


def decide(
    trade: LiveTrade,
    position: dict[str, Any] | None,
    orders: dict[str, dict[str, Any]],
    mark_price: float | None,
    missing_streak: int,
) -> Decision:
    """Решение по одной сделке. Только числа, никаких обращений наружу.

    `orders` — состояние ордеров целей по их идентификаторам.
    """
    size = position_size(position)

    if trade.status == "waiting":
        # Позиция появилась — заявка входа исполнилась.
        return Decision(trade.takes_hit, opened=size > 0)

    if size <= 0 and missing_streak >= MISSING_TOLERANCE:
        return Decision(trade.takes_hit, closed=True)

    takes: list[dict[str, Any]] = json.loads(trade.tp_orders_json or "[]")
    filled: list[str] = []
    hit = trade.takes_hit
    for take in takes:
        if take.get("filled"):
            continue
        order_id = str(take.get("order_id") or "")
        if order_id and order_filled(orders.get(order_id)):
            filled.append(order_id)
            hit += 1

    if hit == trade.takes_hit:
        return Decision(trade.takes_hit)

    state = Position(
        symbol=trade.symbol,
        side=trade.side,
        entry=float(trade.entry),
        quantity=size or float(trade.qty),
        stop=float(trade.current_stop),
    )
    prices = [float(t.get("price") or 0) for t in takes]
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

            orders = await self._take_orders(client, trade)
            decision = decide(
                trade, position, orders, mark_price(position), self._missing[trade.id]
            )
            await self._apply(session, client, trade, decision)

    async def _take_orders(self, client: WeexFutures, trade: LiveTrade) -> dict[str, dict]:
        """Состояние ещё не исполненных целей."""
        out: dict[str, dict] = {}
        if trade.status != "open":
            return out
        for take in json.loads(trade.tp_orders_json or "[]"):
            if take.get("filled"):
                continue
            order_id = str(take.get("order_id") or "")
            if not order_id:
                continue
            try:
                out[order_id] = await client.get_order(trade.symbol, order_id)
            except WeexTradeError as exc:
                logger.debug("Ордер %s не опрошен: %s", order_id, exc)
        return out

    async def _apply(
        self, session, client: WeexFutures, trade: LiveTrade, decision: Decision
    ) -> None:
        changed = False

        if decision.opened:
            trade.status = "open"
            trade.opened_at = utcnow()
            changed = True
            logger.info("Позиция набрана: %s (%s)", trade.symbol, trade.client_id)

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

    async def _find_stop_order(self, client: WeexFutures, trade: LiveTrade) -> str:
        """Найти стоп этой позиции среди условных заявок.

        Стоп ставится вместе со входом, и его идентификатор биржа возвращает не
        в ответе на ордер, а в списке условных заявок.
        """
        try:
            orders = await client.algo_orders(trade.symbol)
        except WeexTradeError:
            return ""
        for order in orders:
            kind = str(order.get("planType") or order.get("type") or "").lower()
            if "sl" in kind or "stop" in kind or "loss" in kind:
                return str(order.get("orderId") or order.get("id") or "")
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

        pnl = 0.0
        exit_price: float | None = None
        try:
            since = trade.opened_at or trade.created_at
            opened_ms = int(since.timestamp() * 1000) if since else 0
            for fill in await client.user_trades(trade.symbol, limit=100):
                try:
                    if int(fill.get("time", 0)) < opened_ms:
                        continue
                    pnl += float(fill.get("realizedPnl") or 0)
                    price = float(fill.get("price") or 0)
                    if price > 0:
                        exit_price = price
                except (TypeError, ValueError):
                    continue
        except WeexTradeError as exc:
            logger.warning("Исполнения %s не получены: %s", trade.symbol, exc)

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
