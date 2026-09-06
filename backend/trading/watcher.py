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
    DEFAULT_TAKER_FEE,
    Position,
    should_move_stop,
    stop_after_take,
    take_share,
    takes_covered,
)
from core.weex import keys as keystore
from core.weex.futures import (
    Credentials,
    public_price,
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

# Насколько должен разойтись биржевой безубыток с нашим стопом, чтобы его
# стоило переставлять: 0.02% цены входа. Мельче — это шум от фандинга, а
# каждая перестановка стопа стоит двух запросов и мгновения без защиты.
BE_DRIFT = 0.0002



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

    state = Position(
        symbol=trade.symbol,
        side=trade.side,
        entry=float(trade.entry),
        quantity=size,
        stop=float(trade.current_stop),
    )

    if hit <= trade.takes_hit:
        # Новых целей нет, но безубыток мог сдвинуться: биржа пересчитывает его
        # после каждого частичного закрытия и списания фандинга. Пока стоп
        # стоит именно в безубытке - следуем за биржей, а не за своей цифрой.
        #
        # В обе стороны: наша формула не знает ни реальной цены исполнения, ни
        # комиссии этого счёта, и промахивалась на десятки пунктов. Стоп,
        # стоящий дальше биржевого нуля, - это не защита, а ранний выход, и
        # держаться за него только потому, что он «лучше», значит выбивать
        # сделку раньше времени.
        if trade.takes_hit == 1:
            fresh = exchange_breakeven(position)
            if fresh is not None and abs(fresh - state.stop) > state.entry * BE_DRIFT:
                # Хуже входа безубыток не бывает: туда переставлять нельзя, это
                # уже убыток, а не ноль.
                losing = fresh < state.entry if trade.side == "long" else fresh > state.entry
                if not losing:
                    return Decision(trade.takes_hit, move_stop_to=fresh)
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

    prices = [float(t.get('price') or 0) for t in takes]

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

        # Цену спрашиваем отдельно и по одному разу на инструмент: в ответе по
        # позиции её нет вовсе, а без неё стоп уезжает не на ту сторону рынка -
        # биржа такой отклоняет, и позиция остаётся со старым.
        prices: dict[str, float | None] = {}

        for trade in trades:
            position = position_for(positions, trade.symbol, trade.side)
            streak = self._missing.get(trade.id, 0)
            self._missing[trade.id] = streak + 1 if position_size(position) <= 0 else 0

            price = mark_price(position)
            if price is None:
                sym = trade.symbol.upper()
                if sym not in prices:
                    prices[sym] = await public_price(self._http(), sym)
                price = prices[sym]

            plans = await self._open_plans(client, trade)
            decision = decide(trade, position, plans, price, self._missing[trade.id])
            await self._apply(session, client, trade, decision, price)

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
        self,
        session,
        client: WeexFutures,
        trade: LiveTrade,
        decision: Decision,
        price: float | None = None,
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
            if await self._set_stop(client, trade, decision.move_stop_to, price):
                trade.current_stop = decision.move_stop_to
                changed = True

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
        plan = split_ladder(
            float(trade.qty), prices, filters["step"], filters["min_qty"]
        )
        if not plan:
            # Даже вся позиция не набирает минимального объёма заявки -
            # закрывать её будет стоп или сам трейдер.
            logger.warning(
                "Объём %s мал даже для одной цели, лестница не ставится", trade.symbol
            )
            trade.targets_json = "[]"
            return True

        long = trade.side == "long"
        placed: list[dict[str, Any]] = []
        for i, (price, size) in enumerate(plan):
            try:
                # Условная заявка, а не сокращающий лимит: на позиции с висящей
                # защитой биржа отвечает «cannot set reduce only» - свободного к
                # сокращению объёма у неё нет, он весь зарезервирован стопом.
                order = await client.place_tp_sl(
                    symbol=trade.symbol,
                    plan_type="TAKE_PROFIT",
                    trigger_price=num(round_to_tick(price, filters["tick"])),
                    quantity=num(size),
                    position_side="LONG" if long else "SHORT",
                    client_algo_id=f"tp{i + 1}_{trade.client_id}"[:32],
                )
            except WeexTradeError as exc:
                # Дальше по лестнице, а не наружу: отказ по одной цели не повод
                # оставлять сделку без остальных. Цена могла уйти за первую -
                # биржа такую заявку не примет, а вторая и третья ещё впереди.
                logger.warning("Цель %d %s не встала: %s", i + 1, trade.symbol, exc)
                continue
            placed.append(
                {"price": price, "order_id": plan_order_id(order), "filled": False}
            )

        if not placed:
            return False
        trade.tp_orders_json = json.dumps(placed, ensure_ascii=False)
        # Цели сделки - те, что реально стоят на бирже. Иначе стоп после первой
        # прятался бы за ценой, которой на бирже нет, а журнал показывал бы
        # замысел вместо сделки.
        trade.targets_json = json.dumps([p["price"] for p in placed])
        logger.info("Цели выставлены: %s, %d шт.", trade.symbol, len(placed))
        return True

    async def _set_stop(
        self,
        client: WeexFutures,
        trade: LiveTrade,
        stop: float,
        market: float | None = None,
    ) -> bool:
        """Поставить стоп на новую цену: снять старый и выставить новый.

        Не «передвинуть»: стоп, приехавший вместе со входом, биржа заводит сама,
        и его идентификатор в ответе на ордер не приходит. Угадывать его по
        названию типа заявки — та самая ошибка, из-за которой стоп оставался на
        прежней цене после взятой цели.

        Порядок именно такой: сначала новый, потом снятие старого. Наоборот —
        это окно, в котором позиция стоит вообще без защиты.
        """
        filters = await client.symbol_filters(trade.symbol)
        size = float(trade.qty)
        try:
            positions = await client.positions()
            size = position_size(position_for(positions, trade.symbol, trade.side)) or size
        except WeexTradeError:
            pass

        quantity = floor_to_step(size, filters["step"])
        if quantity < filters["min_qty"]:
            logger.warning("Стоп %s не поставлен: нечего защищать", trade.symbol)
            return False

        long = trade.side == "long"

        # Стоп по ту сторону рынка биржа не примет: у лонга он обязан стоять
        # ниже цены, у шорта выше. Так и вышло на взятой цели - безубыток
        # оказался выше рынка, заявку отклонили, и позиция осталась со старым
        # стопом. Отступаем на шаг от цены: ровно в цену тоже не пускают.
        if market and market > 0:
            edge = market - filters["tick"] if long else market + filters["tick"]
            wrong = stop > edge if long else stop < edge
            if wrong:
                logger.info(
                    "Стоп %s подведён к рынку: %s не по ту сторону от %s",
                    trade.symbol,
                    stop,
                    market,
                )
                stop = edge

        try:
            placed = await client.place_tp_sl(
                symbol=trade.symbol,
                plan_type="STOP_LOSS",
                trigger_price=num(round_to_tick(stop, filters["tick"])),
                quantity=num(quantity),
                position_side="LONG" if long else "SHORT",
                client_algo_id=f"sl{trade.takes_hit}_{trade.client_id}"[:32],
            )
        except WeexTradeError as exc:
            # Не встал — старый остаётся на месте. Это хуже, чем хотелось, но
            # честнее, чем снять защиту и не поставить новую.
            logger.warning("Стоп %s не поставлен: %s", trade.symbol, exc)
            return False

        fresh = plan_order_id(placed)
        await self._drop_old_stops(client, trade, keep=fresh)
        trade.sl_order_id = fresh
        logger.info(
            "Стоп %s переставлен на %s после %d целей", trade.symbol, stop, trade.takes_hit
        )
        return True

    async def _drop_old_stops(self, client: WeexFutures, trade: LiveTrade, keep: str) -> None:
        """Снять прежние стопы, оставив только что поставленный.

        Цели не трогаем: они тоже условные заявки, и снять их значит остаться
        без лестницы.
        """
        takes = {
            str(t.get("order_id") or "")
            for t in json.loads(trade.tp_orders_json or "[]")
        }
        try:
            orders = await client.algo_orders(trade.symbol)
        except WeexTradeError as exc:
            logger.warning("Старые стопы %s не сняты: %s", trade.symbol, exc)
            return

        for order in orders:
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if not order_id or order_id == keep or order_id in takes:
                continue
            kind = str(order.get("planType") or order.get("type") or "").lower()
            # Заявку неизвестного вида не трогаем: снять чужую цель дороже, чем
            # оставить лишний стоп.
            if "profit" in kind or "tp" in kind:
                continue
            try:
                await client.cancel_algo_order(trade.symbol, order_id)
                logger.info("Снят прежний стоп %s по %s", order_id, trade.symbol)
            except WeexTradeError as exc:
                logger.warning("Прежний стоп %s не снят: %s", order_id, exc)

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
        hit = trade.takes_hit
        try:
            since = trade.opened_at or trade.created_at
            # Наивную дату из базы считаем UTC: `timestamp()` у неё считает по
            # местному времени, и окно исполнений уезжало бы на разницу поясов.
            aware = (
                since if since is None or since.tzinfo else since.replace(tzinfo=timezone.utc)
            )
            opened_ms = int(aware.timestamp() * 1000) if aware else 0
            fills = [
                f
                for f in await client.user_trades(trade.symbol, limit=100)
                if not opened_ms or fill_time(f) >= opened_ms
            ]
            hit = trade.takes_hit
            gross, fee, exit_price = settle(fills, float(trade.entry), trade.side)
            hit = max(
                trade.takes_hit,
                takes_reached(fills, json.loads(trade.targets_json or "[]"), trade.side),
            )
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
                takes_hit=hit,
                # Цели переносим целиком: без них журнал знает, сколько целей
                # взято, но не знает, каких именно, и отрисовать сделку задним
                # числом уже нечем.
                targets_json=trade.targets_json or "[]",
                outcome="take" if pnl > 0 else "stop",
                pnl=pnl,
                fee=fee,
                opened_at=trade.opened_at,
                closed_at=trade.closed_at or utcnow(),
                note="биржа",
            )
        )


# Имена полей в отчёте об исполнениях. У каждой биржи свои, а по этим числам
# считается то, что попадает в журнал: соврать здесь значит испортить всю
# статистику трейдера.
_PNL_FIELDS = ("realizedPnl", "realizePnl", "realisedPnl", "profit", "pnl", "income")
_FEE_FIELDS = ("commission", "fee", "tradeFee", "totalFee", "feeAmount")
_TIME_FIELDS = ("time", "createdTime", "timestamp", "tradeTime", "cTime", "ts")
_PRICE_FIELDS = ("price", "fillPrice", "dealPrice", "avgPrice")
_SIZE_FIELDS = ("qty", "size", "amount", "dealSize", "fillSize", "volume")
_SIDE_FIELDS = ("side", "orderSide", "direction", "tradeSide")

_fills_warned = False


def _first(row: dict[str, Any], names: tuple[str, ...]) -> float | None:
    """Первое читаемое число из перечисленных полей. Нет - None."""
    for name in names:
        if name not in row:
            continue
        try:
            return float(row[name])
        except (TypeError, ValueError):
            continue
    return None


def fill_time(row: dict[str, Any]) -> int:
    value = _first(row, _TIME_FIELDS)
    return int(value) if value else 0


def settle(
    fills: list[dict[str, Any]], entry: float, side: str
) -> tuple[float, float, float | None]:
    """Итог по исполнениям: результат до комиссии, комиссия и цена выхода.

    Результат берём тот, что посчитала биржа. Если поля с ним в отчёте нет -
    считаем сами по ценам закрывающих исполнений: у сделки известны цена входа
    и сторона, а в исполнении есть цена, объём и направление. Промолчать здесь
    нельзя: в журнал уйдёт ноль, и трейдер увидит +2 вместо +64.
    """
    reported = 0.0
    derived = 0.0
    fee = 0.0
    price: float | None = None
    has_reported = False
    long = side == "long"

    for row in fills:
        value = _first(row, _PNL_FIELDS)
        if value is not None:
            has_reported = True
            reported += value

        paid = _first(row, _FEE_FIELDS)
        if paid is not None:
            fee += abs(paid)

        at = _first(row, _PRICE_FIELDS) or 0.0
        size = abs(_first(row, _SIZE_FIELDS) or 0.0)
        if at > 0:
            price = at

        # Закрывающее исполнение идёт против стороны сделки: лонг закрывают
        # продажей. Открывающие в результат не входят - они его создали.
        direction = str(
            next((row[name] for name in _SIDE_FIELDS if name in row), "")
        ).lower()
        closing = ("sell" in direction or "short" in direction) if long else (
            "buy" in direction or "long" in direction
        )
        if closing and at > 0 and size > 0 and entry > 0:
            derived += (at - entry) * size if long else (entry - at) * size

    if not has_reported and fills:
        global _fills_warned
        if not _fills_warned:
            _fills_warned = True
            logger.warning(
                "Результат в отчёте об исполнениях не найден, поля: %s",
                ", ".join(sorted(str(k) for k in fills[0])),
            )
        return derived, fee, price

    return reported, fee, price


def takes_reached(
    fills: list[dict[str, Any]], targets: list[float], side: str
) -> int:
    """Сколько целей сделка действительно прошла.

    Считать по остатку позиции можно, только пока позиция есть. Последняя цель
    закрывает её целиком - и в тот момент считать уже нечего: в журнал уходило
    «взято две» там, где взяли все три.

    Смотрим на исполнения: цель пройдена, если закрывающая сделка прошла по её
    цене или дальше. Это и есть факт, а не намерение.
    """
    if not targets or not fills:
        return 0
    long = side == "long"
    prices = [
        value
        for value in (_first(row, _PRICE_FIELDS) for row in fills)
        if value and value > 0
    ]
    if not prices:
        return 0
    reach = max(prices) if long else min(prices)
    return sum(1 for target in targets if (reach >= target if long else reach <= target))


def split_ladder(
    qty: float, prices: list[float], step: float, min_qty: float
) -> list[tuple[float, float]]:
    """Разложить объём позиции по целям: цена и объём каждой.

    Доли лестницы - 30 / 50 / 20 процентов, но объём биржа принимает только
    кратный шагу лота и не меньше минимального. На маленькой позиции доля в неё
    не укладывается, и раньше лестница не ставилась вовсе: сделка оставалась с
    одним стопом, хотя цели были нарисованы на графике.

    Теперь мелкие доли копятся до первой, которая проходит: вместо трёх целей
    получится две или одна, но они будут. Остаток достаётся последней - он и по
    замыслу её: третья цель забирает всё, что осталось.
    """
    if qty <= 0 or not prices or step <= 0:
        return []

    plan: list[tuple[float, float]] = []
    carry = 0.0
    for i, price in enumerate(prices):
        carry += qty * take_share(i, len(prices))
        size = floor_to_step(carry, step)
        if size >= min_qty:
            plan.append((price, size))
            carry -= size

    if plan and carry > 0:
        price, size = plan[-1]
        plan[-1] = (price, floor_to_step(size + carry, step))
    return plan


def position_side(row: dict[str, Any] | None) -> str:
    """Сторона позиции: long, short или пусто, если биржа не сказала.

    В хедже по инструменту стоят две позиции, и брать первую попавшуюся нельзя:
    лонг увидит объём шорта, а приказ на закрытие уйдёт не в ту сторону - биржа
    ответит «position side invalid» и будет права.

    Сначала смотрим название стороны, потом знак объёма: в одностороннем режиме
    поля со стороной может не быть вовсе, а минус в размере есть всегда.
    """
    if not row:
        return ""
    name = str(row.get("positionSide") or row.get("holdSide") or row.get("side") or "").lower()
    if "long" in name or "buy" in name:
        return "long"
    if "short" in name or "sell" in name:
        return "short"

    for key in ("total", "size", "positionAmt", "available"):
        try:
            value = float(row.get(key))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value:
            return "long" if value > 0 else "short"
    return ""


def position_for(
    positions: list[dict[str, Any]], symbol: str, side: str
) -> dict[str, Any] | None:
    """Позиция нужной стороны по инструменту.

    Строку без стороны считаем своей: в одностороннем режиме позиция по
    инструменту одна, и отказываться от неё значило бы не увидеть собственную.
    """
    for row in positions:
        if str(row.get("symbol", "")).upper() != symbol.upper():
            continue
        found = position_side(row)
        if found in ("", side):
            return row
    return None


def _f(row: dict[str, Any], *names: str) -> float:
    """Первое читаемое число из перечисленных полей. Нет - ноль."""
    for name in names:
        try:
            return float(row.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
    return 0.0


def exchange_breakeven(
    position: dict[str, Any] | None, taker_fee: float = DEFAULT_TAKER_FEE
) -> float | None:
    """Цена, при которой позиция закрывается в настоящий ноль.

    Готового поля с безубытком WEEX не отдаёт - в ответе по позиции его нет
    вовсе. Зато есть всё, из чего он складывается: сколько денег зашло в
    позицию, сколько вышло, сколько удержано комиссии и фандинга. По ним
    считаем точно, а не по формуле «вход плюс две комиссии»: та не знает ни
    реальной цены исполнения, ни частичных закрытий, ни фандинга и промахивалась
    на десятки пунктов.

        лонг:  P = (зашло - вышло + удержано) / (остаток * (1 - комиссия))
        шорт:  P = (зашло - вышло - удержано) / (остаток * (1 + комиссия))

    «Зашло» и «вышло» - это цена на объём по всем исполнениям, поэтому средняя
    цена входа и доли закрытий учтены сами собой.
    """
    if not position:
        return None

    # Если биржа однажды начнёт отдавать готовое число - берём его.
    for name in (
        "breakEvenPrice",
        "breakevenPrice",
        "breakEvenPoint",
        "breakevenPoint",
        "break_even_price",
        "breakEven",
        "bePrice",
    ):
        try:
            price = float(position.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if price > 0:
            return price

    size = position_size(position)
    opened = _f(position, "cumOpenValue", "openValue")
    if size <= 0 or opened <= 0 or not (0 <= taker_fee < 1):
        _log_missing_fields(position)
        return None

    closed = _f(position, "cumCloseValue")
    held = (
        abs(_f(position, "cumOpenFee", "openFee"))
        + abs(_f(position, "cumCloseFee", "closeFee"))
        + _f(position, "cumFundingFee", "fundingFee")
    )

    if position_side(position) == "short":
        price = (opened - closed - held) / (size * (1 + taker_fee))
    else:
        price = (opened - closed + held) / (size * (1 - taker_fee))
    return price if price > 0 else None


_be_warned = False


def _log_missing_fields(position: dict[str, Any]) -> None:
    """Один раз сказать, чего не хватило: имена полей у бирж разные."""
    global _be_warned
    if _be_warned:
        return
    _be_warned = True
    logger.warning(
        "Безубыток не посчитать, поля позиции: %s",
        ", ".join(sorted(str(k) for k in position)),
    )


def average_entry(position: dict[str, Any] | None) -> float | None:
    """Средняя цена входа: стоимость входов на их объём.

    Готового поля с ценой входа в ответе нет - есть только «сколько денег
    зашло» и «на какой объём». Отношение и есть средняя.
    """
    if not position:
        return None
    value = _f(position, "cumOpenValue", "openValue")
    size = _f(position, "cumOpenSize") or position_size(position)
    return value / size if value > 0 and size > 0 else None


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
