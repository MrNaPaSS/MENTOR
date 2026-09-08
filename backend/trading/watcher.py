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
# Сколько проходов ждать, пока биржа занесёт закрывающее исполнение в отчёт.
# Восемь проходов - две минуты: дольше ждать бессмысленно, запишем что есть.
RECORD_ATTEMPTS = 8

MISSING_TOLERANCE = 2

# Какую долю объёма отчёт об исполнениях должен покрыть, чтобы результату по
# нему можно было верить. Не единица: биржа округляет объёмы своим шагом, и
# точное равенство здесь давало бы ложную тревогу на каждой сделке.
FILLS_ENOUGH = 0.99

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
    # Объём позиции на бирже. По нему считаются взятые цели, и он же
    # записывается сделке: лимитка исполняется и частями, а планируемый объём
    # тогда врёт - терминал видел «взята цель» сразу после входа.
    size: float = 0.0


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
    resting: bool = False,
) -> Decision:
    """Решение по одной сделке. Только числа, никаких обращений наружу.

    `open_plans` — идентификаторы условных заявок, которые ещё висят на бирже.
    `resting` — вход этой сделки всё ещё стоит на бирже и ждёт своей цены.
    """
    size = position_size(position)

    if trade.status == "waiting":
        # Позиция появилась - но исполнилась ли именно эта заявка?
        #
        # Биржа отдаёт одну сводную позицию на монету и сторону: две лимитки на
        # покупку по ней неразличимы. Раньше сюда приходил один и тот же объём,
        # и обе сделки объявлялись открытыми - на одну позицию вставали две
        # лестницы целей и два стопа, а в журнал уходили две записи.
        #
        # Пока наш вход стоит в заявках, позиция набрана не им.
        return Decision(trade.takes_hit, opened=size > 0 and not resting, size=size)

    takes: list[dict[str, Any]] = json.loads(trade.tp_orders_json or "[]")

    if size <= 0 and missing_streak >= MISSING_TOLERANCE:
        # Последняя цель закрывает позицию целиком, и считать по остатку в этот
        # момент нечего. Смотрим на заявки: цель, которой не стало в списке
        # висящих, исполнилась - снимать их мы к этому моменту ещё не начинали.
        away = [
            t
            for i, t in enumerate(takes)
            if str(t.get("order_id") or "") not in open_plans
            and take_label(trade.client_id, i) not in open_plans
        ]
        fresh = [
            str(t.get("order_id") or "")
            for t in away
            if not t.get("filled") and t.get("order_id")
        ]
        # Число взятых целей на закрытии не поднимаем.
        #
        # Здесь считались «пропавшие» заявки - но стоп закрывает позицию
        # целиком, и вместе с ней с биржи разом уходят все оставшиеся цели. По
        # этому счёту выбитая сделка выглядела как сделка, забравшая все три:
        # именно так в журнале на стопе рисовались три достигнутые цели.
        #
        # Сколько целей взято на самом деле, знает остаток позиции, пока она
        # была открыта, - это число уже накоплено. А что было в конце, разберёт
        # запись в журнал: у неё есть цена выхода и реальные исполнения.
        return Decision(trade.takes_hit, closed=True, filled_orders=fresh)

    # Позиция больше запомненной - лимитка дозаполнилась. Это не взятая цель, а
    # добор объёма: считать цели от старого числа значит увидеть их там, где их
    # нет.
    if size > float(trade.qty):
        return Decision(trade.takes_hit, size=size)

    # Остатка нет - по нему целей не считают.
    #
    # takes_filled() считает цели долей закрытого объёма, а при нулевом остатке
    # эта доля равна единице: ответ «взяты все три». Так и выходило у
    # ликвидации - позицию уносит биржа, разом и целиком, - и у стопа тоже, на
    # том проходе, где остаток уже ноль, а закрытие ещё не подтверждено
    # (MISSING_TOLERANCE). Число успевало записаться в сделку, а оттуда попасть
    # в журнал: у сделки, не взявшей ни одной цели, стояли три.
    #
    # Ветка закрытия ниже об этом знает и счёт не поднимает; этот проход шёл
    # мимо неё - до неё не хватало одного пустого ответа.
    hit = (
        trade.takes_hit
        if size <= 0
        else max(trade.takes_hit, takes_filled(float(trade.qty), size, len(takes)))
    )

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
        # Стоп, поставленный руками на этом же числе целей, расчётом не
        # трогаем: трейдер видел рынок и решил сам, а безубыток - всего лишь
        # правило по умолчанию. Возьмёт следующую цель - правило вернётся.
        by_hand = int(getattr(trade, "hand_stop", -1) or -1) == trade.takes_hit
        if trade.takes_hit == 1 and not by_hand:
            fresh = exchange_breakeven(position, side=trade.side)
            if (
                fresh is not None
                and abs(fresh - state.stop) > state.entry * BE_DRIFT
                # Только вперёд. Забранная прибыль опускает ноль ниже входа -
                # это правда, но опускать за ней уже поставленный стоп значит
                # увеличивать риск задним числом.
                and should_move_stop(state, fresh)
            ):
                return Decision(trade.takes_hit, move_stop_to=fresh, size=size)
        return Decision(trade.takes_hit, size=size)

    # Отмечаем сработавшими те цели, которых уже нет среди висящих заявок, — по
    # порядку и не больше, чем показал остаток позиции.
    filled: list[str] = []
    for i, take in enumerate(takes):
        if take.get("filled") or len(filled) >= hit - trade.takes_hit:
            continue
        order_id = str(take.get("order_id") or "")
        if not order_id:
            continue
        # Ни по идентификатору, ни по нашей метке заявки нет - значит сработала.
        if order_id not in open_plans and take_label(trade.client_id, i) not in open_plans:
            filled.append(order_id)

    prices = [float(t.get('price') or 0) for t in takes]

    # После каждой цели стоп идёт в безубыток - тот, что считает биржа по своим
    # цифрам. Так это сделано и в боте заказчика: частичное закрытие меняет
    # стоимость позиции, и ноль после второй цели уже не тот, что после первой.
    #
    # Только вперёд: стоп, уже спрятанный за первой целью, не опускаем обратно
    # к нулю - это увеличение риска задним числом. Своя формула и правило «за
    # предыдущей целью» остаются запасными, на случай молчания биржи.
    target = exchange_breakeven(position, side=trade.side)
    if target is None:
        target = stop_after_take(state, hit, prices, mark_price)
    if target is not None and not should_move_stop(state, target):
        target = None

    return Decision(hit, move_stop_to=target, filled_orders=filled, size=size)


class PositionWatcher:
    """Обходит открытые сделки всех учеников и доводит их до конца."""

    def __init__(self, session_factory, http_session_factory, interval: float = POLL_INTERVAL):
        self._sessions = session_factory
        self._http = http_session_factory
        self.interval = interval
        self._task: asyncio.Task | None = None
        self._missing: dict[int, int] = {}
        # Сколько проходов ждём исполнения выхода по каждой сделке.
        self._pending: dict[int, int] = {}

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
                    # Фабрика сессии асинхронная: без ожидания в запрос уходил
                    # не сеанс, а корутина - и обход сделок падал целиком,
                    # оставляя позиции без сопровождения.
                    prices[sym] = await public_price(await self._http(), sym)
                price = prices[sym]

            plans = await self._open_plans(client, trade)
            resting = await self._resting(client, trade)
            decision = decide(
                trade, position, plans, price, self._missing[trade.id], resting
            )
            await self._apply(session, client, trade, decision, price)

    async def _resting(self, client: WeexFutures, trade: LiveTrade) -> bool:
        """Стоит ли ещё вход этой сделки в заявках биржи.

        Спрашиваем только у ждущих: у открытой сделки вход давно исполнился, и
        лишний запрос на каждом обходе не нужен.

        Не ответила биржа - считаем, что стоит: объявить заявку исполненной, не
        зная этого, значит поставить лестницу целей на чужую позицию.
        """
        if trade.status != "waiting":
            return False
        try:
            orders = await client.open_orders(trade.symbol)
        except WeexTradeError as exc:
            logger.debug("Заявки %s не получены: %s", trade.symbol, exc)
            return True
        for order in orders:
            mark = str(order.get("clientOrderId") or order.get("clientOid") or "")
            # По началу строки: при переносе лимитки к идентификатору
            # дописывается номер попытки, а сам он остаётся прежним.
            if mark and mark.startswith(trade.client_id):
                return True
        return False

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
        alive: set[str] = set()
        for order in orders:
            alive |= order_marks(order)
        return alive

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
            # Объём берём биржевой: лимитка могла исполниться частью, и цели
            # считаются от того, что действительно набрано.
            if decision.size > 0:
                trade.qty = decision.size
            changed = True
            logger.info("Позиция набрана: %s (%s)", trade.symbol, trade.client_id)

        # Цели ставим, когда позиция есть, а их ещё нет. До набора позиции биржа
        # сокращающий ордер не принимает — «cannot set reduce only», — поэтому
        # при лимитном входе лестница доезжает сюда, а не выставляется сразу.
        if trade.status == "open" and not json.loads(trade.tp_orders_json or "[]"):
            if await self._place_takes(client, trade):
                changed = True

        # Позиция подросла - лимитка дозаполнилась.
        if decision.size > float(trade.qty):
            trade.qty = decision.size
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
            # Сначала запись, потом закрытие. Наоборот - это сделка, которой
            # нет ни на бирже, ни в журнале: запись падала, сделка всё равно
            # помечалась закрытой, и следующий проход её уже не видел. Сделки
            # по стопу пропадали из журнала именно так.
            try:
                if not await self._record(session, client, trade):
                    return
            except Exception as exc:  # noqa: BLE001 - причина в логе, попробуем позже
                logger.error(
                    "Сделка %s не записана в журнал, попробуем на следующем проходе: %s",
                    trade.symbol,
                    exc,
                )
                return

            trade.status = "closed"
            trade.closed_at = utcnow()
            changed = True
            self._missing.pop(trade.id, None)
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
        return await set_stop(client, trade, stop, market)

    async def _drop_old_stops(self, client: WeexFutures, trade: LiveTrade, keep: str) -> None:
        await drop_old_stops(client, trade, keep)


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

    async def _record(self, session, client: WeexFutures, trade: LiveTrade) -> bool:
        """Записать закрытую сделку в журнал по реальным исполнениям.

        Результат берём у биржи, а не считаем сами: наш расчёт не знает ни
        проскальзывания, ни комиссии, и в журнале появилась бы прибыль, которой
        не было.

        Возвращает `False`, когда закрывающего исполнения в отчёте ещё нет.
        Биржа заносит его туда не мгновенно, а позиции уже не видно - и запись
        уходила с нулём вместо настоящего убытка. В этом случае сделка остаётся
        открытой и попытка повторяется на следующем проходе.
        """
        exists = session.execute(
            select(ScalpTrade)
            .where(ScalpTrade.student_id == trade.student_id)
            .where(ScalpTrade.client_id == trade.client_id)
        ).scalar_one_or_none()

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

            # Закрывающее исполнение идёт против стороны сделки. Пока его нет,
            # считать нечего: в отчёте одни входы, и результат выйдет нулевым.
            closing = "sell" if trade.side == "long" else "buy"
            has_exit = any(
                closing in str(f.get("side") or "").lower() for f in fills
            )
            waited = self._pending.get(trade.id, 0)
            if not has_exit and waited < RECORD_ATTEMPTS:
                self._pending[trade.id] = waited + 1
                logger.info(
                    "Исполнений выхода %s ещё нет, ждём (попытка %d)",
                    trade.symbol,
                    waited + 1,
                )
                return False

            # Ставка нужна только на случай, когда комиссии в отчёте нет.
            # Не узнали её - записываем то, что назвала биржа: остаться без
            # записи из-за справочной цифры нельзя.
            taker = 0.0
            try:
                taker = float((await client.symbol_filters(trade.symbol)).get("taker_fee") or 0)
            except Exception as exc:  # noqa: BLE001 - причина в логе, запись важнее
                logger.debug("Ставка комиссии %s не получена: %s", trade.symbol, exc)
            gross, fee, exit_price = settle(fills, float(trade.entry), trade.side, taker)
            # Взятые цели считаем по самим исполнениям биржи.
            #
            # Счётчик сделки ведёт сопровождение, и он умеет только расти: стоп
            # уносит с биржи все оставшиеся цели разом, по их исчезновению
            # сделка выглядит забравшей всё, и в журнале у выбитой в безубыток
            # стояли три цели вместо двух. Прежняя проверка ценой выхода это не
            # чинила - она бралась через max() и опустить счётчик не могла.
            #
            # Исполнения врать не умеют: до какой цели дошла хоть одна продажа
            # лонга, та и взята. Не получили исполнений - остаёмся при счётчике:
            # он хотя бы не пуст.
            hit = takes_from_fills(trade, fills)

            # Весь ли выход попал в отчёт.
            #
            # Молчать об этом нельзя: трейдер сверяет журнал с приложением
            # биржи, и число, посчитанное по половине исполнений, он читает как
            # настоящее. Ликвидация на -531 записывалась как -199 - ровно
            # потому, что закрытие в окно отчёта поместилось не целиком.
            #
            # Считать за биржу нечего: цены недостающих исполнений нам никто не
            # назвал. Поэтому не выдумываем, а говорим вслух и выкладываем в
            # журнал сервера всё, по чему считали.
            done = closed_size(fills, trade.side)
            if done < float(trade.qty) * FILLS_ENOUGH:
                logger.warning(
                    "Отчёт по %s (%s) неполон: закрыто %.6f из %.6f, "
                    "результат %.4f посчитан по %d исполнениям - в журнале он "
                    "будет меньше настоящего",
                    trade.symbol,
                    trade.client_id,
                    done,
                    float(trade.qty),
                    gross - fee,
                    len(fills),
                )
                for one in fills:
                    logger.warning("  исполнение: %s", one)

            # По этим строкам разбирается любое расхождение с биржей: сколько
            # исполнений попало в счёт, за какое окно и что в них было.
            logger.info(
                "Итог %s по %d исполнениям с %s: биржа %.4f, комиссия %.4f",
                trade.symbol,
                len(fills),
                aware.isoformat() if aware else "начала",
                gross,
                fee,
            )
            for one in fills:
                logger.debug(
                    "  исполнение %s: цена %s объём %s сторона %s результат %s комиссия %s",
                    one.get("orderId") or one.get("id") or "?",
                    one.get("price"),
                    one.get("qty") or one.get("size"),
                    one.get("side"),
                    one.get("realizedPnl"),
                    one.get("commission"),
                )

        except WeexTradeError as exc:
            logger.warning("Исполнения %s не получены: %s", trade.symbol, exc)

        # В журнал идёт то, что осталось на счёте: биржа считает результат до
        # комиссии, а трейдер видит после.
        pnl = gross - fee

        # Запись могла появиться раньше нашей: терминал пишет сразу, чтобы
        # сделка не пропала, если сервер до неё не дойдёт. Тогда мы её не
        # пропускаем, а поправляем - наши числа с биржи, а те были оценкой.
        record = exists or ScalpTrade(
            student_id=trade.student_id, client_id=trade.client_id
        )
        record.symbol = trade.symbol
        record.side = trade.side
        record.entry = float(trade.entry)
        record.stop = float(trade.initial_stop)
        record.exit_price = exit_price
        record.qty = float(trade.qty)
        record.margin = float(trade.margin or 0) or 1.0
        record.leverage = trade.leverage
        record.takes_hit = hit
        # Цели переносим целиком: без них журнал знает, сколько целей взято,
        # но не знает, каких именно, и отрисовать сделку задним числом нечем.
        record.targets_json = trade.targets_json or "[]"
        record.outcome = "take" if pnl > 0 else "stop"
        record.pnl = pnl
        record.fee = fee
        record.opened_at = trade.opened_at
        record.closed_at = trade.closed_at or utcnow()
        record.note = "биржа"
        # Отметка для журнала: эту запись оценкой с экрана не переписывают.
        record.from_exchange = True
        if exists is None:
            session.add(record)
        self._pending.pop(trade.id, None)
        return True


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


async def set_stop(
    client: WeexFutures,
    trade: LiveTrade,
    stop: float,
    market: float | None = None,
    label: str | None = None,
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

    # Цену, с которой заявка уходит на биржу, считаем один раз: с ней же потом
    # сверяем список, чтобы не снять только что поставленный стоп.
    trigger = round_to_tick(stop, filters["tick"])
    try:
        placed = await client.place_tp_sl(
            symbol=trade.symbol,
            plan_type="STOP_LOSS",
            trigger_price=num(trigger),
            quantity=num(quantity),
            position_side="LONG" if long else "SHORT",
            client_algo_id=(label or f"sl{trade.takes_hit}_{trade.client_id}")[:32],
        )
    except WeexTradeError as exc:
        # Не встал — старый остаётся на месте. Это хуже, чем хотелось, но
        # честнее, чем снять защиту и не поставить новую.
        logger.warning("Стоп %s не поставлен: %s", trade.symbol, exc)
        return False

    fresh = plan_order_id(placed)
    await drop_old_stops(client, trade, keep=fresh, market=market, fresh=trigger)
    logger.info(
        "Стоп %s: было %s, стало %s (целей взято %d, рынок %s)",
        trade.symbol,
        trade.current_stop,
        stop,
        trade.takes_hit,
        market if market else "неизвестен",
    )
    trade.sl_order_id = fresh
    logger.info(
        "Стоп %s переставлен на %s после %d целей", trade.symbol, stop, trade.takes_hit
    )
    return True


async def cancel_plan(client: WeexFutures, symbol: str, order: dict[str, Any]) -> str:
    """Снять условную заявку. Возвращает сработавший идентификатор или пустую строку.

    Идентификатор условной заявки биржа кладёт в разное поле, и угадать его
    заранее нельзя: в одном ответе это `orderId`, в другом `algoId`. Ошиблись -
    биржа отвечает «не найдено», заявка остаётся висеть, а мы об этом молчим.
    Так на позиции и оказывались два стопа и две цели: новую поставили, старую
    «сняли».

    Поэтому перебираем известные имена, пока одно не сработает. Лишний отказ
    дешевле, чем незамеченная живая заявка на деньги.
    """
    tried: list[str] = []
    last = ""
    for name in (
        "orderId",
        "algoId",
        "id",
        "planOrderId",
        "orderNo",
        "clientAlgoId",
        "clientOid",
    ):
        value = order.get(name)
        if not value:
            continue
        mark = str(value)
        if mark in tried:
            continue
        tried.append(mark)
        try:
            await client.cancel_algo_order(symbol, mark)
        except WeexTradeError as exc:
            last = str(exc)
            continue
        if len(tried) > 1:
            logger.info("Заявка %s снята по полю %s", mark, name)
        return mark
    if tried:
        logger.warning("Заявку %s снять не удалось (%s): %s", tried, symbol, last)
    return ""


async def plan_alive(client: WeexFutures, symbol: str, marks: set[str]) -> bool:
    """Висит ли ещё заявка с такими метками.

    Проверка после снятия: отказ биржи мы видим, а вот «успешный» ответ на
    несуществующий идентификатор - нет. Верить надо списку заявок, а не ответу.
    """
    if not marks:
        return False
    try:
        orders = await client.algo_orders(symbol)
    except WeexTradeError:
        # Не спросили - не утверждаем, что заявки нет.
        return True
    return any(order_marks(order) & marks for order in orders)


async def drop_old_stops(
    client: WeexFutures,
    trade: LiveTrade,
    keep: str,
    market: float | None = None,
    fresh: float | None = None,
) -> None:
    """Снять прежние стопы, оставив только что поставленный.

    Цели не трогаем: они тоже условные заявки, и снять их значит остаться
    без лестницы.

    Стоп от названия вида не опознавался: тот, что приезжает вместе со входом,
    биржа заводит сама и называет по-своему. Заявка с незнакомым названием
    оставалась висеть, и после переноса на позиции оказывались два стопа -
    новый и прежний.

    Поэтому решает не название, а сторона. Живой стоп лонга всегда ниже рынка,
    живая цель всегда выше: будь наоборот, они бы уже сработали. Это факт о
    заявке, а не догадка о её имени, и цель под такое правило не попадёт
    никогда. Рынок неизвестен - остаёмся при осторожном разборе по названию.
    """
    recorded = json.loads(trade.tp_orders_json or "[]")
    takes = {str(t.get("order_id") or "") for t in recorded}
    takes |= {take_label(trade.client_id, i) for i in range(len(recorded))}
    takes.discard("")
    try:
        orders = await client.algo_orders(trade.symbol)
    except WeexTradeError as exc:
        logger.warning("Старые стопы %s не сняты: %s", trade.symbol, exc)
        return

    for order in orders:
        marks = order_marks(order)
        # Номер только для журнала. Снимать заявку он не нужен: у части заявок
        # своего номера в списке нет вовсе - есть лишь метка, которую мы сами и
        # задали, - и такие раньше пропускались молча. Прежний стоп оставался
        # висеть, а трейдеру предлагалось убрать его руками.
        order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
        if keep in marks or marks & takes:
            continue

        trigger = _first(order, ("triggerPrice", "stopPrice", "triggerPx", "planPrice", "price"))

        # Только что поставленный стоп щадим и по цене: идентификатор в ответе
        # биржи приходит не всегда, и без этой проверки мы сняли бы его сам.
        if fresh and trigger and abs(trigger - fresh) <= max(fresh, 1.0) * 1e-6:
            continue

        # Сторона решает: живой стоп лонга ниже рынка, живая цель выше.
        kind = str(order.get("planType") or order.get("type") or "").lower()
        stop_like = "stop" in kind or "loss" in kind or kind.endswith("sl")
        if not stop_like and market and market > 0 and trigger:
            stop_like = trigger < market if trade.side == "long" else trigger > market
        if not stop_like:
            logger.info(
                "Условная заявка %s (%s) оставлена: не опознана как стоп",
                order_id,
                kind or "без вида",
            )
            continue
        if await cancel_plan(client, trade.symbol, order):
            logger.info("Снят прежний стоп %s по %s", order_id or "без номера", trade.symbol)
        else:
            logger.warning(
                "Прежний стоп %s по %s остался висеть - на позиции их теперь два",
                order_id or sorted(marks),
                trade.symbol,
            )


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


def is_closing(row: dict[str, Any], side: str) -> bool:
    """Закрывающее ли это исполнение: лонг закрывают продажей, шорт покупкой."""
    direction = str(
        next((row[name] for name in _SIDE_FIELDS if name in row), "")
    ).lower()
    if side == "long":
        return "sell" in direction or "short" in direction
    return "buy" in direction or "long" in direction


def closed_size(fills: list[dict[str, Any]], side: str) -> float:
    """Сколько объёма закрыто по отчёту об исполнениях.

    Нужен, чтобы понять, весь ли выход в отчёт попал. Отчёт приходит окном -
    последние сто исполнений по монете и не раньше входа, - а ликвидация
    закрывает позицию разом и по частям, и часть исполнений в окно не
    помещается. Результат тогда считается по тому, что видно, и в журнал
    уходит убыток меньше настоящего.
    """
    return sum(
        abs(_first(row, _SIZE_FIELDS) or 0.0) for row in fills if is_closing(row, side)
    )


def settle(
    fills: list[dict[str, Any]], entry: float, side: str, taker_fee: float = 0.0
) -> tuple[float, float, float | None]:
    """Итог по исполнениям: результат до комиссии, комиссия и цена выхода.

    Результат берём тот, что посчитала биржа. Если поля с ним в отчёте нет -
    считаем сами по ценам закрывающих исполнений: у сделки известны цена входа
    и сторона, а в исполнении есть цена, объём и направление. Промолчать здесь
    нельзя: в журнал уйдёт ноль, и трейдер увидит +2 вместо +64.

    С комиссией то же самое. Поля с ней в отчёте может не быть вовсе, и тогда в
    журнал уходил результат до неё: на счёт пришло 18.51, а записано было
    22.52 - ровно на комиссию больше. Не назвали - считаем сами, по ставке
    инструмента и обороту исполнений.
    """
    reported = 0.0
    derived = 0.0
    fee = 0.0
    turnover = 0.0
    # Оборот с названной комиссией и без неё. Раздельно - потому что отчёт
    # бывает неполным, и это надо уметь заметить.
    charged = 0.0
    silent = 0.0
    price: float | None = None
    has_reported = False
    has_fee = False
    long = side == "long"

    for row in fills:
        value = _first(row, _PNL_FIELDS)
        if value is not None:
            has_reported = True
            reported += value

        paid = _first(row, _FEE_FIELDS)
        at = _first(row, _PRICE_FIELDS) or 0.0
        size = abs(_first(row, _SIZE_FIELDS) or 0.0)
        if at > 0:
            price = at
        # Оборот всех ног: по нему считается комиссия, когда биржа её не назвала.
        turnover += at * size

        if paid is not None:
            has_fee = True
            fee += abs(paid)
            # Оборот тех исполнений, за которые комиссия названа. По нему
            # выводится ставка для промолчавших: см. ниже.
            charged += at * size
        else:
            silent += at * size

        # Закрывающее исполнение идёт против стороны сделки: лонг закрывают
        # продажей. Открывающие в результат не входят - они его создали.
        if is_closing(row, side) and at > 0 and size > 0 and entry > 0:
            derived += (at - entry) * size if long else (entry - at) * size

    # Комиссия, которую биржа не назвала.
    #
    # Назвать её она может не за все исполнения сразу, а за часть - и раньше
    # одного названного хватало, чтобы отключить досчёт для всех остальных.
    # Отчёт молчал про закрытие половины позиции, комиссия выходила ровно на
    # три четверти настоящей, и в журнале стояло +98.71 там, где на счёт
    # пришло +90.70: расхождение было не в прибыли, а в недосчитанной комиссии.
    #
    # Ставку берём у самих исполнений: сколько биржа удержала за названные,
    # столько же она удержала и за молчащие. Своя ставка инструмента идёт в ход
    # только когда сравнивать не с чем - когда не названо ничего. Справочная
    # ставка тут заметно грубее: у этих сделок она дала бы втрое больше того,
    # что удержано на самом деле.
    if silent > 0:
        rate = fee / charged if has_fee and charged > 0 else taker_fee
        if rate > 0:
            missed = silent * rate
            fee += missed
            logger.info(
                "Комиссия названа не за всё: оборот без неё %.2f, ставка %.4f%% "
                "(%s) - добавили %.4f, всего %.4f",
                silent,
                rate * 100,
                "по названным исполнениям" if has_fee and charged > 0 else "справочная",
                missed,
                fee,
            )

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


def take_label(client_id: str, index: int) -> str:
    """Метка нашей заявки на цель: она уходит на биржу вместе с ордером.

    Идентификатор, который биржа возвращает в ответе, приходит не всегда и не
    в одном и том же поле - на этом мы уже теряли связь со своими заявками.
    Метку же мы задаём сами, и по ней сделку узнать можно всегда.
    """
    return f"tp{index + 1}_{client_id}"[:32]


def stop_label(client_id: str, takes_hit: int) -> str:
    """Метка нашего стопа. Номер меняется с каждой взятой целью."""
    return f"sl{takes_hit}_{client_id}"[:32]


def order_marks(order: dict[str, Any]) -> set[str]:
    """Всё, чем заявку можно опознать: идентификаторы биржи и наша метка."""
    marks = {
        str(order.get(name) or "")
        for name in ("orderId", "algoId", "id", "clientAlgoId", "clientOid", "clientOrderId")
    }
    marks.discard("")
    return marks


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
    position: dict[str, Any] | None,
    taker_fee: float = DEFAULT_TAKER_FEE,
    side: str | None = None,
) -> float | None:
    """Цена, при которой оставшаяся позиция закрывается в ноль.

    Ровно та, что биржа показывает в позиции как Break Even. Готового поля WEEX
    не отдаёт, поэтому считаем её сами - из средней цены входа и комиссии обеих
    ног:

        лонг:  P = средняя * (1 + комиссия) / (1 - комиссия)
        шорт:  P = средняя * (1 - комиссия) / (1 + комиссия)

    Средняя берётся из денег и объёма входов, а не из задуманного уровня: это
    настоящая цена исполнения, с проскальзыванием и доборами.

    Раньше здесь считался другой ноль - «вся сделка в ноль, с учётом уже
    забранной прибыли». Он честен по смыслу, но забранная прибыль опускает его
    ниже входа, и после первой цели стоп уезжал под среднюю. Трейдер при этом
    видел в приложении биржи своё число и ставил стоп по нему - расхождение
    вышло в сто двадцать пунктов. Терминал обязан быть зеркалом биржи, а не
    спорить с ней своей арифметикой, пусть и правильной.

    Сторону берём у сделки, а не угадываем по ответу: в одностороннем режиме
    поля со стороной может не быть вовсе, и шорт считался бы как лонг - это
    ошибка ровно на две комиссии, и в ту сторону, где стоп не защищает.
    """
    if not position:
        return None

    # Если биржа однажды начнёт отдавать готовое число - берём его.
    for name in (
        "breakEvenPrice",
        "breakEvenPx",
        "bkePx",
        "costPrice",
        "breakevenPrice",
        "breakEvenPoint",
        "break_even_price",
        "bePrice",
    ):
        try:
            price = float(position.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if price > 0:
            return price

    entry = average_entry(position)
    if entry is None or not (0 <= taker_fee < 1):
        _log_missing_fields(position)
        return None

    long = (side or position_side(position)) != "short"
    if long:
        price = entry * (1 + taker_fee) / (1 - taker_fee)
    else:
        price = entry * (1 - taker_fee) / (1 + taker_fee)
    return price if price > 0 else None


_be_warned = False


def takes_from_fills(trade: LiveTrade, fills: list[dict[str, Any]]) -> int:
    """Сколько целей взято, судя по закрывающим исполнениям.

    Цель считается взятой, если хоть одно закрытие прошло по ней или дальше в
    сторону прибыли. Лонг закрывают продажей, шорт - покупкой; вход в счёт не
    идёт, иначе цель «брала» бы сама себя ценой входа.

    Это надёжнее одной цены выхода: у сделки, закрытой по частям, выходов
    несколько, и последний из них - стоп в безубытке, по которому не взята ни
    одна цель.
    """
    try:
        targets = [float(p) for p in json.loads(trade.targets_json or "[]")]
    except (TypeError, ValueError):
        return 0
    if not targets:
        return 0

    long = trade.side == "long"
    closing = "sell" if long else "buy"
    opening = "buy" if long else "sell"
    best: float | None = None
    whole = False
    for row in fills:
        direction = str(
            next((row[name] for name in _SIDE_FIELDS if name in row), "")
        ).lower()
        at = _first(row, _PRICE_FIELDS) or 0.0
        if opening in direction:
            # Вход в отчёте - значит он покрывает сделку с самого начала.
            whole = True
            continue
        if closing not in direction or at <= 0:
            continue
        best = at if best is None else (max(best, at) if long else min(best, at))

    if best is None:
        return trade.takes_hit
    counted = sum(1 for price in targets if (best >= price if long else best <= price))

    # Опустить счётчик вправе только полный отчёт.
    #
    # Список исполнений приходит окном - последние сто и не раньше времени
    # входа. Если входа в нём нет, окно застало сделку с середины, взятая цель
    # могла остаться за его краем, и счёт по такому отчёту занизил бы число
    # целей вместо того, чтобы поправить завышенное. Тогда доверяем счётчику:
    # ошибиться в его сторону безопаснее.
    return counted if whole else max(trade.takes_hit, counted)


def targets_reached(trade: LiveTrade, exit_price: float | None) -> int:
    """Сколько целей взято, судя по цене выхода.

    Цель считается взятой, если цена дошла до неё в сторону прибыли. Это факт о
    сделке, а не догадка по заявкам: стоп снимает с биржи все оставшиеся цели
    разом, и по их отсутствию выбитая сделка выглядит забравшей всё.
    """
    if not exit_price or exit_price <= 0:
        return 0
    try:
        targets = [float(p) for p in json.loads(trade.targets_json or "[]")]
    except (TypeError, ValueError):
        return 0
    long = trade.side == "long"
    return sum(1 for price in targets if (exit_price >= price if long else exit_price <= price))


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
