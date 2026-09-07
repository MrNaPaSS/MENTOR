"""Перенос входа, стопа и цели - мышью по графику.

Трейдер тянет квадрат на новую цену, и заявка должна переехать туда же на
бирже. Всё остальное здесь - следствие одного различия: до входа и после входа
это две разные операции, и путать их нельзя.

Заявка ещё ждёт свою цену - позиции нет, защищать нечего. Стоп у такой заявки
живёт не отдельной условной заявкой, а полем самой лимитки: биржа заводит его
сама в момент исполнения. Передвинуть такое поле нельзя, поэтому лимитка
снимается и ставится заново - окна без защиты при этом не возникает, потому что
защищать пока нечего.

Позиция уже открыта - всё наоборот: снимать защиту нельзя ни на секунду.
Поэтому условная заявка двигается на месте, одним запросом, а не парой
«снять - поставить».

Цели у ждущей заявки на бирже вообще не стоят: сокращать нечего, пока вход не
исполнен. Их ставит сопровождение в момент набора позиции, читая замысел из
записи сделки, - значит перенос цели до входа это правка замысла, и ни одного
запроса к бирже он не требует.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.api.trading import _fail, _get_session, _num, _require_client
from backend.deps import get_current_student, get_session
from backend.trading.watcher import (
    cancel_plan,
    mark_price,
    order_marks,
    plan_alive,
    position_for,
    set_stop,
    stop_label,
    take_label,
)
from core.models import LiveTrade, Student, utcnow
from core.weex.futures import (
    WeexFutures,
    WeexTradeError,
    plan_order_id,
    public_price,
    round_to_tick,
)

router = APIRouter(prefix="/api/trading", tags=["trading"])
logger = logging.getLogger("nmnh.trading")


class MoveIn(BaseModel):
    """Куда трейдер перетащил уровни. Присылается только то, что сдвинулось."""

    symbol: str = Field(min_length=1, max_length=32)
    side: str                                        # long | short
    entry: float | None = Field(default=None, gt=0)
    stop: float | None = Field(default=None, gt=0)
    take: float | None = Field(default=None, gt=0)
    # Какую именно цель двигаем, если их несколько. Счёт с нуля, по возрастанию
    # в сторону прибыли.
    take_index: int = Field(default=0, ge=0, le=4)
    # Какую сделку двигаем. По одной монете их может идти несколько, в том
    # числе встречных, и переносить защиту соседней недопустимо.
    trade_id: str | None = Field(default=None, max_length=64)


def _live(session, student: Student, body: MoveIn) -> LiveTrade:
    """Наша запись о сделке. Без неё двигать нечего: чужие заявки не трогаем."""
    query = (
        select(LiveTrade)
        .where(LiveTrade.student_id == student.id)
        .where(LiveTrade.symbol == body.symbol.upper())
        .where(LiveTrade.side == body.side)
        .where(LiveTrade.status.in_(("waiting", "open")))
    )
    if body.trade_id:
        query = query.where(LiveTrade.client_id == body.trade_id)
    row = session.execute(query.order_by(LiveTrade.updated_at.desc())).scalars().first()
    if row is None:
        raise HTTPException(404, "Сделка не найдена - обновите терминал")
    return row


def _mine(live: LiveTrade) -> tuple[set[str], set[str]]:
    """Метки наших целей и стопов.

    Идентификатор биржа возвращает не всегда, а метку задаём мы сами при
    постановке - по ней заявку узнать можно в любом случае.
    """
    takes = {
        str(t.get("order_id") or "")
        for t in json.loads(live.tp_orders_json or "[]")
    }
    count = len(json.loads(live.tp_orders_json or "[]")) or 3
    takes |= {take_label(live.client_id, i) for i in range(count)}
    stops = {str(live.sl_order_id or "")}
    stops |= {stop_label(live.client_id, hit) for hit in range(4)}
    takes.discard("")
    stops.discard("")
    return takes, stops


def _kind(order: dict[str, Any]) -> str:
    return str(order.get("planType") or order.get("type") or "").lower()


def _id(order: dict[str, Any]) -> str:
    for name in ("orderId", "algoId", "id", "clientAlgoId"):
        if order.get(name):
            return str(order[name])
    return ""


def _trigger(order: dict[str, Any]) -> float:
    for name in ("triggerPrice", "stopPrice", "triggerPx", "planPrice", "price"):
        try:
            value = float(order.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


async def _protection(
    client: WeexFutures, live: LiveTrade
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Что из защиты стоит на бирже: цели и стопы, каждый со своей ценой.

    Сначала по нашим меткам, и только потом по виду заявки: имена видов у биржи
    свои, и по ним мы уже принимали цели за чужое.
    """
    try:
        orders = await client.algo_orders(live.symbol)
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    my_takes, my_stops = _mine(live)
    takes: list[dict[str, Any]] = []
    stops: list[dict[str, Any]] = []
    for order in orders:
        marks = order_marks(order)
        kind = _kind(order)
        if marks & my_takes or "profit" in kind or kind.endswith("tp"):
            takes.append(order)
        elif marks & my_stops or "stop" in kind or "loss" in kind or kind.endswith("sl"):
            stops.append(order)
    return takes, stops


@router.post("/move")
async def move_levels(
    body: MoveIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Перенести вход, стоп или цель на новую цену."""
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")
    if body.entry is None and body.stop is None and body.take is None:
        raise HTTPException(422, "Нечего переносить")

    client = _require_client(session, student)
    live = _live(session, student, body)
    tick = (await client.symbol_filters(live.symbol))["tick"]

    try:
        position = position_for(await client.positions(), live.symbol, live.side)
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    if position is None:
        result = await _move_waiting(client, live, body, tick)
    else:
        # Цену спрашиваем отдельно: в ответе по позиции её нет вовсе - там
        # только объёмы, стоимости и комиссии. Без неё не понять, где стоп, а
        # где цель, и прежний стоп оставался висеть рядом с новым.
        market = mark_price(position)
        if market is None:
            market = await public_price(await _get_session(), live.symbol)
        result = await _move_open(client, live, body, tick, market)

    live.updated_at = utcnow()
    session.commit()
    return result


async def _move_waiting(
    client: WeexFutures, live: LiveTrade, body: MoveIn, tick: float
) -> dict[str, Any]:
    """Переставить ждущую лимитку: вход и стоп - вместе, целям хватит замысла."""
    targets: list[float] = json.loads(live.targets_json or "[]")
    if body.take is not None:
        take = round_to_tick(body.take, tick)
        # Замысел проверяем так же строго, как заявку на бирже. Цель по ту
        # сторону входа биржа отклонит - но не сейчас, а через час, когда
        # лимитка исполнится и сопровождение пойдёт её ставить: сделка окажется
        # без цели, и объяснить это будет уже нечем.
        entry = round_to_tick(body.entry, tick) if body.entry is not None else live.entry
        _guard(live.side, entry, None, take)
        while len(targets) <= body.take_index:
            targets.append(take)
        targets[body.take_index] = take
        live.targets_json = json.dumps(targets)

    if body.entry is None and body.stop is None:
        # Двигали только цель: на бирже её ещё нет, и трогать биржу незачем.
        return {"entry": live.entry, "stop": live.current_stop, "takes": targets, "planned": True}

    entry = round_to_tick(body.entry, tick) if body.entry is not None else live.entry
    stop = round_to_tick(body.stop, tick) if body.stop is not None else live.current_stop
    if entry <= 0:
        raise HTTPException(409, "У этой заявки нет цены входа - переносить нечего")
    _guard(live.side, entry, stop, None)

    # Снимаем старую заявку и ставим новую. Именно в этом порядке: позиции нет,
    # окна без защиты не возникает, а две живые лимитки на один вход - это
    # двойной объём, если обе исполнятся.
    old = await _entry_order(client, live)
    if old:
        try:
            await client.cancel_order(live.symbol, old)
        except WeexTradeError as exc:
            raise _fail(exc) from exc

    # Идентификатор для биржи новый: снятый она помнит ещё некоторое время и
    # повторный отклоняет. Наш собственный при этом не меняется - к нему
    # привязаны и метки заявок, и запись в журнале.
    live.replaces = (live.replaces or 0) + 1
    try:
        await client.place_order(
            symbol=live.symbol,
            side="BUY" if live.side == "long" else "SELL",
            position_side="LONG" if live.side == "long" else "SHORT",
            quantity=_num(live.qty),
            order_type="LIMIT",
            price=_num(entry),
            sl_trigger=_num(stop),
            client_order_id=f"{live.client_id}-{live.replaces}"[:64],
        )
    except WeexTradeError as exc:
        # Старой заявки уже нет, новая не встала - сказать об этом надо прямо:
        # трейдер думает, что просто подвинул уровень, а вход исчез.
        logger.warning("Лимитка %s не переставлена: %s", live.symbol, exc)
        live.status = "waiting"
        raise HTTPException(
            409, f"Заявка снята, но новая не встала: {exc}. Выставьте вход заново."
        ) from exc

    live.entry = entry
    live.initial_stop = stop
    live.current_stop = stop
    return {"entry": entry, "stop": stop, "takes": targets, "planned": True}


async def _move_open(
    client: WeexFutures,
    live: LiveTrade,
    body: MoveIn,
    tick: float,
    market: float | None = None,
) -> dict[str, Any]:
    """Подвинуть защиту открытой позиции.

    Не «передвинуть заявку», а поставить новую и снять прежнюю. Ручка биржи для
    переноса условной заявки на нашем счёте не двигает её, а заводит вторую: на
    позиции оказывались два стопа в паре долларов друг от друга, терминал
    показывал то один, то другой, и уровень «возвращался назад» сам собой.

    Порядок разный и по делу. Стоп: сначала новый, потом снятие старого -
    наоборот это окно, в котором позиция стоит без защиты. Цель: сначала снятие,
    потом новая - две цели на один объём биржа исполнит обе.
    """
    if body.entry is not None:
        raise HTTPException(409, "Позиция уже открыта - вход не переносится")

    takes, _stops = await _protection(client, live)
    targets: list[float] = json.loads(live.targets_json or "[]")

    if body.stop is not None:
        stop = round_to_tick(body.stop, tick)
        _guard(live.side, live.entry, stop, None)
        # Метка своя на каждый перенос: биржа помнит снятую ещё некоторое время
        # и повторную отклоняет - стоп тогда просто не переезжает.
        live.replaces = (live.replaces or 0) + 1
        # Цену рынка передаём: стоп по ту сторону рынка биржа не принимает, и
        # постановка подведёт его к рынку сама, вместо отказа.
        moved = await set_stop(
            client,
            live,
            stop,
            market,
            label=f"slm{live.replaces}_{live.client_id}",
        )
        if not moved:
            raise HTTPException(409, "Биржа не приняла новый стоп - прежний остался на месте")

        # Проверяем, что прежний стоп действительно ушёл. Снятие по неверному
        # идентификатору выглядит как успешное, и позиция оставалась с двумя
        # стопами: терминал зеркалил то один, то другой, и уровень «возвращался».
        stale = {m for order in _stops for m in order_marks(order)}
        stale.discard(live.sl_order_id or "")
        if stale and await plan_alive(client, live.symbol, stale):
            raise HTTPException(
                409,
                "Новый стоп поставлен, но прежний биржа не сняла - "
                "снимите лишний в приложении биржи",
            )

        live.current_stop = stop
        # Сопровождение переставляет стоп в безубыток после первой цели. Свой
        # стоп трейдер поставил руками и осознанно: возвращать его расчётом
        # нельзя, пока сделка не дойдёт до следующей цели.
        live.hand_stop = live.takes_hit

    if body.take is not None:
        take = round_to_tick(body.take, tick)
        _guard(live.side, live.entry, None, take)
        # Цели по порядку в сторону прибыли: у лонга снизу вверх, у шорта
        # сверху вниз. Трейдер тянет вторую цель - двигаться должна вторая.
        ladder = sorted(takes, key=_trigger, reverse=live.side == "short")
        if body.take_index >= len(ladder):
            raise HTTPException(409, "Такой цели на бирже нет")

        old = ladder[body.take_index]
        size = _size(old)
        if size <= 0:
            raise HTTPException(409, "Биржа не назвала объём этой цели")

        # Сначала снимаем, потом ставим: две цели на один объём биржа исполнит
        # обе. И убеждаемся, что старая действительно ушла - «успешный» ответ на
        # неверный идентификатор выглядит точно так же, как настоящее снятие, и
        # именно так на позиции появлялась вторая цель.
        cancel_plan_result = await cancel_plan(client, live.symbol, old)
        if not cancel_plan_result or await plan_alive(client, live.symbol, order_marks(old)):
            raise HTTPException(
                409,
                "Биржа не сняла прежнюю цель - новую не ставим, "
                "иначе на позиции окажутся две",
            )

        live.replaces = (live.replaces or 0) + 1
        try:
            placed = await client.place_tp_sl(
                symbol=live.symbol,
                plan_type="TAKE_PROFIT",
                trigger_price=_num(take),
                quantity=_num(size),
                position_side="LONG" if live.side == "long" else "SHORT",
                client_algo_id=f"tpm{live.replaces}_{live.client_id}"[:32],
            )
        except WeexTradeError as exc:
            # Старой цели уже нет, новая не встала - сказать надо прямо: трейдер
            # думает, что подвинул уровень, а цель исчезла вовсе.
            logger.warning("Цель %s не переставлена: %s", live.symbol, exc)
            raise HTTPException(
                409, f"Цель снята, но новая не встала: {exc}. Поставьте её заново."
            ) from exc

        while len(targets) <= body.take_index:
            targets.append(take)
        targets[body.take_index] = take
        live.targets_json = json.dumps(targets)

        # Запоминаем новую заявку: по её идентификатору сопровождение узнаёт,
        # что цель взята. Со старым оно ждало бы исполнения снятой.
        recorded = json.loads(live.tp_orders_json or "[]")
        while len(recorded) <= body.take_index:
            recorded.append({"price": take, "order_id": "", "filled": False})
        recorded[body.take_index] = {
            "price": take,
            "order_id": plan_order_id(placed),
            "filled": False,
        }
        live.tp_orders_json = json.dumps(recorded, ensure_ascii=False)

    return {
        "entry": live.entry,
        "stop": live.current_stop,
        "takes": targets,
        "planned": False,
    }


def _size(order: dict[str, Any]) -> float:
    """Объём условной заявки. Имя поля у биржи своё."""
    for name in ("quantity", "size", "qty", "origQty", "volume"):
        try:
            value = float(order.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


def _guard(side: str, entry: float, stop: float | None, take: float | None) -> None:
    """Уровень по ту сторону входа - это не перенос, а другая сделка.

    Биржа такую заявку всё равно отклонит, но её отказ придёт кодом и текстом
    про параметры. Трейдеру, который просто перетянул квадрат не туда, надо
    сказать словами, что именно не так.
    """
    if entry <= 0:
        return
    long = side == "long"
    if stop is not None and stop > 0:
        if long and stop >= entry:
            raise HTTPException(422, "Стоп лонга должен стоять ниже входа")
        if not long and stop <= entry:
            raise HTTPException(422, "Стоп шорта должен стоять выше входа")
    if take is not None and take > 0:
        if long and take <= entry:
            raise HTTPException(422, "Цель лонга должна стоять выше входа")
        if not long and take >= entry:
            raise HTTPException(422, "Цель шорта должна стоять ниже входа")


async def _entry_order(client: WeexFutures, live: LiveTrade) -> str:
    """Идентификатор ждущей лимитки этой сделки.

    Ищем по нашему клиентскому идентификатору с начала строки: при каждом
    переносе к нему дописывается номер попытки, а сам он остаётся прежним.
    """
    try:
        orders = await client.open_orders(live.symbol)
    except WeexTradeError as exc:
        raise _fail(exc) from exc
    for order in orders:
        mark = str(order.get("clientOrderId") or order.get("clientOid") or "")
        if mark.startswith(live.client_id):
            return str(order.get("orderId") or order.get("id") or "")
    return ""
