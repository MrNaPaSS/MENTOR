"""Торговля с биржевого счёта ученика.

Ключи ученика лежат в базе зашифрованными, мастер-ключ приходит из окружения.
Нет мастер-ключа — раздел просто выключен: работать «пока без шифрования»
нельзя, это доступ к чужим деньгам.

Ордер ставится ровно тем же расчётом, что показан в терминале: вход, стоп и три
цели. Ничего не пересчитывается заново на сервере — расхождение между тем, что
трейдер видел, и тем, что ушло на биржу, недопустимо, а два независимых расчёта
рано или поздно разойдутся.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
import ssl
from collections.abc import Iterable, Sequence
from typing import Any

import aiohttp
import certifi
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.deps import get_current_student, get_session
from core.models import iso, LiveTrade, ScalpTrade, Student, WeexCredential, utcnow
from core.trading.position import (
    Position,
    breakeven_price,
    should_move_stop,
)
from backend.trading import leverage_caps
from backend.trading.refusals import explain, max_size_in
from core.weex import keys as keystore
from backend.trading.rewards import award_trade_coins
from backend.trading.watcher import (
    fill_time,
    order_marks,
    position_for,
    settle,
    split_ladder,
    stop_label,
    take_label,
)
from core.weex.futures import (
    public_filters,
    Credentials,
    WeexFutures,
    WeexTradeError,
    floor_to_step,
    plan_order_id,
    round_to_tick,
)

router = APIRouter(prefix="/api/trading", tags=["trading"])
logger = logging.getLogger("nmnh.trading")

# Одна сессия на процесс: соединения живут дольше запроса, и заводить их по
# числу учеников значит исчерпать сокеты на первом же десятке.
_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    """Общая сессия с проверкой сертификата биржи.

    Корневые сертификаты берём из certifi, а не из системного хранилища: на
    Windows Python до него не достаёт, и запрос падает с «unable to get local
    issuer certificate». Отключать проверку, как это сделано в партнёрском
    клиенте, здесь нельзя — в этих запросах ходят ключи от денег ученика, и
    подменённый сертификат означает, что их прочитает кто угодно по дороге.
    """
    global _session
    if _session is None or _session.closed:
        context = ssl.create_default_context(cafile=certifi.where())
        _session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=context))
    return _session


async def close_session() -> None:
    global _session
    if _session and not _session.closed:
        await _session.close()
    _session = None


class KeysIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=256)
    secret_key: str = Field(min_length=8, max_length=256)
    passphrase: str = Field(min_length=1, max_length=256)


class OrderIn(BaseModel):
    """Сделка ровно в том виде, в каком её показал терминал."""

    symbol: str = Field(min_length=1, max_length=32)
    side: str                       # long | short
    quantity: float = Field(gt=0)
    leverage: int = Field(ge=1, le=400)
    entry: float | None = Field(default=None, gt=0)   # пусто — вход по рынку
    stop: float = Field(gt=0)
    takes: list[float] = Field(default_factory=list, max_length=5)
    client_order_id: str | None = Field(default=None, max_length=64)


class CloseIn(BaseModel):
    """Фиксация позиции: доля от того, что сейчас открыто."""

    symbol: str = Field(min_length=1, max_length=32)
    side: str
    share: float = Field(gt=0, le=1)
    client_order_id: str | None = Field(default=None, max_length=64)
    # Какую именно сделку снимаем. По одному инструменту их может идти
    # несколько - в том числе встречных, - и снятие одной не должно уносить
    # защиту остальных.
    trade_id: str | None = Field(default=None, max_length=64)


class StopIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    side: str
    entry: float = Field(gt=0)
    quantity: float = Field(gt=0)
    order_id: str = Field(min_length=1, max_length=64)
    current_stop: float | None = Field(default=None, gt=0)
    mark_price: float | None = Field(default=None, gt=0)


def _credential(session, student: Student) -> WeexCredential | None:
    return session.execute(
        select(WeexCredential).where(WeexCredential.student_id == student.id)
    ).scalar_one_or_none()


def _client(row: WeexCredential) -> WeexFutures:
    return WeexFutures(
        Credentials(
            api_key=keystore.decrypt(row.api_key_enc),
            secret_key=keystore.decrypt(row.secret_enc),
            passphrase=keystore.decrypt(row.passphrase_enc),
        ),
        _get_session,
    )


def _require_client(session, student: Student) -> WeexFutures:
    if not keystore.enabled():
        raise HTTPException(503, "Торговля выключена: на сервере не задан ключ шифрования")
    row = _credential(session, student)
    if row is None or not row.is_active:
        raise HTTPException(428, "Сначала подключите ключи WEEX")
    return _client(row)


def _fail(exc: WeexTradeError) -> HTTPException:
    """Отказ биржи наружу - словами, по которым понятно, что делать.

    Отказ по существу — это 400, а не 502: шлюз ни при чём, не подошли данные
    ордера. Заодно 502 от приложения браузер и прокси разбирают по-разному, и
    сообщение биржи до трейдера не доезжало.

    Оригинал остаётся в журнале целиком: трейдеру нужен ответ, а нам - причина.
    """
    logger.warning("WEEX отказал: %s (код %s)", exc, exc.code)
    status = 502 if exc.retryable else 400
    return HTTPException(status, explain(str(exc)))


@router.get("/live")
async def live_trades(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сделки, которые сопровождение считает живыми - по всем монетам.

    Второе мнение о том, жива ли сделка. Биржа отвечает пустым списком позиций
    и на своей заминке, а терминал по такому ответу хоронил разметку: 10
    сентября две живые позиции по ETH исчезли с графика от двух пустых ответов
    подряд, пришедших за две секунды. Позиция при этом стояла на бирже.

    Здесь ходить на биржу не нужно вовсе: это память сервера. Сопровождение
    обходит биржу само, со своей выдержкой, и пока сделка у него в работе,
    терминалу хоронить её нельзя.

    Отдаём сделку целиком, а не одним опознавателем: по этим полям терминал
    возвращает разметку на график, если её у него нет. Разметка живёт в
    браузере, а браузер - вещь ненадёжная: другая машина, режим инкогнито,
    очищенное хранилище, ошибочные похороны вроде тех же. Позиция от этого не
    закрывается, и сделка, которую сервер ведёт, а биржа показывает, обязана
    быть на графике.
    """
    rows = (
        session.execute(
            select(LiveTrade)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.status.in_(("waiting", "open")))
        )
        .scalars()
        .all()
    )
    return {
        "trades": [
            {
                "client_id": row.client_id,
                "symbol": row.symbol,
                "side": row.side,
                "status": row.status,
                "qty": float(row.qty),
                "entry": float(row.entry),
                "stop": float(row.current_stop),
                "initial_stop": float(row.initial_stop),
                "targets": json.loads(row.targets_json or "[]"),
                "leverage": row.leverage,
                "margin": float(row.margin),
                "takes_hit": row.takes_hit,
                "created_at": _iso(row.created_at),
                "opened_at": _iso(row.opened_at),
            }
            for row in rows
        ],
        "closed": _just_closed(session, student.id),
    }


# Сколько закрытая сделка остаётся в ответе. Терминал хоронит сделку через
# десяток секунд после закрытия, а вкладка могла быть свёрнута - четверти часа
# хватает с запасом, и список при этом остаётся коротким.
JUST_CLOSED_WINDOW = timedelta(minutes=15)


def _just_closed(session, student_id: int) -> list[dict[str, Any]]:
    """Сделки, закрытые за последние минуты, - с ценой выхода и итогом.

    Чем закончилась сделка, терминал раньше угадывал сам: позиции на бирже нет
    - значит закрыта, а чем именно, неизвестно. Отсюда и два уведомления на
    одном стопе: сначала «взята цель 3» по снятым с биржи целям, потом «стоп».

    Сопровождение пишет сделку в журнал раньше, чем перестаёт её вести, - по
    исполнениям с биржи. Поэтому к моменту, когда терминал убедился в
    закрытии, здесь уже лежат настоящая цена выхода и итог после комиссии.
    """
    since = utcnow() - JUST_CLOSED_WINDOW
    rows = (
        session.execute(
            select(ScalpTrade)
            .where(ScalpTrade.student_id == student_id)
            .where(ScalpTrade.closed_at >= since)
        )
        .scalars()
        .all()
    )
    return [
        {
            "client_id": row.client_id,
            "exit_price": float(row.exit_price) if row.exit_price is not None else None,
            "pnl": float(row.pnl or 0),
            "fee": float(row.fee or 0),
            "takes_hit": row.takes_hit,
            "outcome": row.outcome,
            "closed_at": _iso(row.closed_at),
        }
        for row in rows
    ]


@router.get("/plans/{symbol}")
async def plans(
    symbol: str,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Что из защиты реально стоит на бирже: стопы и цели.

    График рисует цели по замыслу сделки, и когда биржа их не приняла,
    трейдер видит лестницу, которой нет. Пусть терминал сверяется с биржей и
    говорит правду - молчаливая картинка здесь дороже всего.
    """
    client = _require_client(session, student)
    sym = symbol.upper()
    try:
        orders = await client.algo_orders(sym)
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    live = session.execute(
        select(LiveTrade)
        .where(LiveTrade.student_id == student.id)
        .where(LiveTrade.symbol == sym)
        .where(LiveTrade.status.in_(("waiting", "open")))
    ).scalars().all()

    # Свои заявки узнаём по записанным идентификаторам, а не по названию вида:
    # имена у биржи свои, и по ним мы уже дважды принимали цели за чужое.
    mine_takes = {
        str(t.get("order_id") or "")
        for row in live
        for t in json.loads(row.tp_orders_json or "[]")
    }
    # И наши метки: идентификатор биржа возвращает не всегда, а метку мы задаём
    # сами при постановке - по ней заявку узнать можно в любом случае.
    for row in live:
        count = len(json.loads(row.tp_orders_json or "[]")) or 3
        mine_takes |= {take_label(row.client_id, i) for i in range(count)}
    mine_stops = {str(row.sl_order_id or "") for row in live}
    mine_stops |= {stop_label(row.client_id, hit) for row in live for hit in range(4)}
    mine_takes.discard("")
    mine_stops.discard("")

    stops = 0
    takes = 0
    stop_price: float | None = None
    take_prices: list[float] = []
    unknown: list[str] = []
    for order in orders:
        marks = order_marks(order)
        kind = str(order.get("planType") or order.get("type") or "").lower()
        trigger = _trigger_price(order)

        if marks & mine_takes:
            takes += 1
            if trigger:
                take_prices.append(trigger)
        elif marks & mine_stops:
            stops += 1
            stop_price = trigger or stop_price
        elif "profit" in kind or kind.endswith("tp"):
            takes += 1
            if trigger:
                take_prices.append(trigger)
        elif "stop" in kind or "loss" in kind or kind.endswith("sl"):
            stops += 1
            stop_price = trigger or stop_price
        else:
            # Незнакомую заявку записываем в стопы: она чем-то да защищает, а
            # ложная тревога «целей нет» дороже незамеченной цели.
            unknown.append(kind or "без вида")
            stops += 1
            stop_price = trigger or stop_price

    if unknown:
        logger.info("Условные заявки %s неизвестного вида: %s", sym, ", ".join(unknown))

    # Наши входы, которые всё ещё стоят и ждут своей цены.
    #
    # Без этого списка терминал не может отличить свои заявки друг от друга:
    # биржа отдаёт одну сводную позицию на монету и сторону, и по ней две
    # лимитки на покупку выглядят одинаково исполнившимися. Так и вышло -
    # зацепило верхнюю, а на графике открылись обе.
    waiting = [row.client_id for row in live if row.status == "waiting"]
    try:
        orders = await client.open_orders(sym)
    except WeexTradeError as exc:
        # Не спросили - считаем, что стоят все: объявить заявку исполненной,
        # не зная этого, дороже, чем показать её ждущей на пару секунд дольше.
        logger.warning("Заявки %s не получены: %s", sym, exc)
        resting = waiting
    else:
        marks = [
            str(order.get("clientOrderId") or order.get("clientOid") or "")
            for order in orders
        ]
        # По началу строки: при переносе лимитки к идентификатору дописывается
        # номер попытки, а сам он остаётся прежним.
        resting = [
            row.client_id
            for row in live
            if any(mark.startswith(row.client_id) for mark in marks if mark)
        ]
    return {
        "symbol": sym,
        "stops": stops,
        "takes": takes,
        # Сколько целей было поставлено на самом деле. Без этого числа «целей
        # на бирже меньше, чем в замысле» читается как «цели взяты» - в том
        # числе тогда, когда их не ставили вовсе или сняли рукой.
        "placed_takes": sum(
            len(json.loads(row.tp_orders_json or "[]")) for row in live
        ),
        # Сколько целей сопровождение засчитало взятыми. Это единственное
        # число, которому здесь можно верить: вычитание «поставлено минус
        # висит» врёт, стоит бирже ответить непривычно и заявку не опознать.
        "takes_hit": max((row.takes_hit for row in live), default=0),
        # Цены, по которым защита реально стоит. Терминал рисует их вместо
        # собственных: своя цифра безубытка расходилась с биржевой на сотню
        # пунктов, а стоп к тому времени уже стоял в третьем месте.
        "stop_price": stop_price,
        "take_prices": sorted(take_prices),
        # Чьи входы ещё ждут своей цены. Только по этому списку терминал и
        # отличает свою исполнившуюся лимитку от соседней, которая ещё стоит.
        "resting": resting,
        # Когда позиция была набрана на самом деле.
        #
        # Терминал замечает исполнение своей лимитки только на той монете, на
        # которой открыт: позиции он опрашивает по одному инструменту. Пока
        # трейдер смотрел другую монету, вход состоялся молча, а вернувшись, он
        # ставил началом сделки момент возвращения - и бокс на графике начинался
        # не там, где сделка открылась, а там, где на неё посмотрели.
        #
        # Сопровождение на сервере обходит все монеты подряд и время входа
        # знает. Ему и верим.
        "opened": {
            row.client_id: _iso(row.opened_at) for row in live if row.opened_at
        },
    }


def _iso(value: datetime | None) -> str | None:
    """Время наружу - всегда с зоной.

    База хранит дату строкой и часовой пояс теряет. Отдать такую строку как
    есть значит заставить браузер прочитать её как местное время.
    """
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _trigger_price(order: dict[str, Any]) -> float | None:
    """Цена срабатывания условной заявки. Имя поля у биржи своё."""
    for name in (
        "triggerPrice",
        "stopPrice",
        "triggerPx",
        "executePrice",
        "planPrice",
        "price",
    ):
        try:
            value = float(order.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return None


@router.get("/limits/{symbol}")
async def limits(
    symbol: str,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Пределы инструмента: плечо, комиссия, шаги.

    Нужны до отправки ордера, а не после: у большинства монет биржи потолок
    плеча ×20 или ×50, а кнопки в окне расчёта предлагают до ×400. Раньше это
    выяснялось отказом биржи после нажатия «Войти».

    Ключей не требует - справочник биржи открыт, и знать предел вправе и тот,
    кто счёт ещё не подключил.
    """
    filters = await public_filters(await _get_session(), symbol.upper())
    return {
        "symbol": symbol.upper(),
        "max_leverage": int(filters.get("max_leverage") or 20),
        "taker_fee": float(filters.get("taker_fee") or 0.0008),
        "step": float(filters.get("step") or 0.001),
        "tick": float(filters.get("tick") or 0.01),
        "min_qty": float(filters.get("min_qty") or 0.001),
        # Потолок одной заявки и всей позиции, в монете. По ним считается
        # предельная сумма сделки: отказ «position exceed max size» приходит
        # уже после нажатия, а знать предел нужно до.
        "max_qty": float(filters.get("max_qty") or 0.0),
        "max_position": float(filters.get("max_position") or 0.0),
        # Пределы по плечам, узнанные из отказов биржи: плечо -> позиция в
        # монете. Справочный max_position верен только для малого плеча.
        "leverage_caps": {
            str(lev): size for lev, size in leverage_caps.caps_for(session, symbol).items()
        },
    }


def _order_left(order: dict[str, Any]) -> float:
    """Сколько ещё не исполнено в заявке. Имена полей у биржи свои."""
    total = 0.0
    for name in ("origQty", "quantity", "size", "qty"):
        try:
            total = abs(float(order.get(name)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if total > 0:
            break
    try:
        done = abs(float(order.get("executedQty") or 0))
    except (TypeError, ValueError):
        done = 0.0
    return max(0.0, total - done)


async def _exposure(client: WeexFutures, symbol: str) -> float | None:
    """Сколько монеты уже занято на бирже: позиции обеих сторон и ждущие входы.

    Предел биржа считает по всему сразу. None - биржа не ответила, и тогда
    проверку не делаем: не пускать сделку из-за заминки хуже, чем получить
    отказ самой биржи.
    """
    try:
        rows = await client.positions()
        orders = await client.open_orders(symbol)
    except WeexTradeError:
        return None
    held = sum(
        abs(float(row.get("size") or row.get("total") or 0))
        for row in rows or []
        if str(row.get("symbol", "")).upper() == symbol
    )
    return held + sum(_order_left(order) for order in orders or [])


@router.get("/status")
async def status(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Готов ли терминал торговать с биржевого счёта."""
    row = _credential(session, student)
    return {
        "enabled": keystore.enabled(),
        "connected": bool(row and row.is_active),
        "key_tail": row.key_tail if row else "",
        "updated_at": iso(row.updated_at) if row else None,
        "taker_fee": taker_fee(session, student),
    }


# Сколько последних сделок берём, чтобы вывести ставку.
#
# Двух десятков хватает: ставка меняется со ступенью VIP, то есть раз в
# несколько недель, а по одной сделке её вывести нельзя - в комиссии одной
# сделки сидят и вход лимиткой, и выход по рынку, и они считаются по разным
# ставкам.
FEE_SAMPLE = 20


def taker_fee(session, student: Student) -> float | None:
    """Ставка комиссии этого трейдера - по его же сделкам.

    У каждого она своя: биржа считает её от уровня VIP, и справочные 0.08% с
    ноги верны только для нулевого. Спросить её у WEEX напрямую нечем - в
    ответе по инструменту стоит стандартная ставка, а не ставка счёта.

    Зато есть свои закрытые сделки: в них лежит и удержанная комиссия, и
    оборот обеих ног. Их отношение и есть настоящая ставка - та, по которой
    биржа считала.

    Пусто, если сделок с комиссией ещё нет: тогда терминал остаётся на
    справочной ставке. Врать в меньшую сторону здесь нельзя - оценка результата
    выйдет выше того, что придёт на счёт.
    """
    rows = session.execute(
        select(ScalpTrade.fee, ScalpTrade.entry, ScalpTrade.exit_price, ScalpTrade.qty)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.from_exchange.is_(True))
        .where(ScalpTrade.fee > 0)
        .order_by(ScalpTrade.closed_at.desc())
        .limit(FEE_SAMPLE)
    ).all()

    paid = 0.0
    turnover = 0.0
    for fee, entry, exit_price, qty in rows:
        if not (entry and exit_price and qty):
            continue
        paid += float(fee or 0)
        turnover += (float(entry) + float(exit_price)) * float(qty)

    if paid <= 0 or turnover <= 0:
        return None
    rate = paid / turnover
    # Разумные границы: биржевые ставки лежат между сотой долей процента и
    # десятой. Число за их пределами - это не ставка, а следы неполного отчёта,
    # и считать по нему хуже, чем по справочной.
    return round(rate, 6) if 0.0001 <= rate <= 0.001 else None


@router.put("/keys")
async def save_keys(
    body: KeysIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Подключить ключи. Проверяем их сразу — иначе ошибка всплывёт на ордере."""
    if not keystore.enabled():
        raise HTTPException(503, "Торговля выключена: на сервере не задан ключ шифрования")

    probe = WeexFutures(
        Credentials(body.api_key, body.secret_key, body.passphrase), _get_session
    )
    try:
        await probe.balance()
    except WeexTradeError as exc:
        raise HTTPException(400, f"Ключи не подошли: {exc}") from exc

    row = _credential(session, student)
    if row is None:
        row = WeexCredential(student_id=student.id)
        session.add(row)
    row.api_key_enc = keystore.encrypt(body.api_key)
    row.secret_enc = keystore.encrypt(body.secret_key)
    row.passphrase_enc = keystore.encrypt(body.passphrase)
    row.key_tail = keystore.mask(body.api_key)
    row.is_active = True
    row.updated_at = utcnow()
    session.commit()
    return {"ok": True, "key_tail": row.key_tail}


@router.delete("/keys")
async def drop_keys(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    row = _credential(session, student)
    if row is None:
        raise HTTPException(404, "Ключи не подключены")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/balance")
async def balance(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    client = _require_client(session, student)
    try:
        return {"balance": await client.balance()}
    except WeexTradeError as exc:
        raise _fail(exc) from exc


@router.get("/positions")
async def positions(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    client = _require_client(session, student)
    try:
        return {"positions": await client.positions()}
    except WeexTradeError as exc:
        raise _fail(exc) from exc


# Биржа отказывает в смене плеча, пока по монете есть заявка или позиция.
# Слова в ответе у неё свои, поэтому узнаём отказ по признакам, а не по точному
# тексту: важно не сообщение, а то, что менять плечо сейчас нельзя.
_LEVERAGE_LOCKED = ("leverage", "плеч")
_LEVERAGE_BUSY = ("open order", "position", "precondition", "заяв", "позиц")


def _leverage_locked(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(w in text for w in _LEVERAGE_LOCKED) and any(w in text for w in _LEVERAGE_BUSY)


async def _live_leverage(client, symbol: str) -> int | None:
    """Какое плечо уже стоит на бирже по этой монете."""
    try:
        rows = await client.positions()
    except Exception:
        return None
    for row in rows or []:
        if str(row.get("symbol", "")).upper() != symbol.upper():
            continue
        for name in ("leverage", "isolatedLongLeverage", "longLeverage", "isolatedShortLeverage"):
            try:
                value = int(float(row.get(name)))
            except (TypeError, ValueError):
                continue
            if value > 0:
                return value
    return None


async def _ensure_leverage(client, symbol: str, leverage: int) -> None:
    """Поставить плечо, а если биржа не даёт - объяснить это словами.

    «FAILED_PRECONDITION: You cannot adjust the leverage when there are open
    orders» приходило трейдеру как есть, и выглядело это отказом в сделке по
    непонятной причине. Причина же будничная: по монете уже стоит заявка или
    позиция, и биржа держит плечо неизменным, пока они живы.

    Отказ в сделке при этом оправдан не всегда. Если на бирже стоит ровно то
    плечо, которое мы и просим, ставить его заново незачем - сделка уходит как
    задумана. А вот если оно другое, продолжать нельзя: заявка встанет с чужим
    плечом, то есть с другим риском, чем показано на графике.
    """
    try:
        await client.set_leverage(symbol, leverage)
        return
    except WeexTradeError as exc:
        if not _leverage_locked(exc):
            raise

    live = await _live_leverage(client, symbol)
    if live is not None and live == int(leverage):
        return

    raise HTTPException(
        409,
        "Биржа не меняет плечо, пока по монете есть заявка или позиция."
        + (f" Сейчас на ней плечо x{live}." if live else "")
        + f" Отмените их или откройте сделку с тем же плечом (запрошено x{int(leverage)}).",
    )


@router.post("/open")
async def open_position(
    body: OrderIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Открыть сделку: вход со стопом, следом цели.

    Стоп ставится вместе со входом одним ордером, а не отдельным запросом
    после: между двумя запросами есть окно, в котором позиция уже открыта и
    ничем не защищена.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    symbol = body.symbol.upper()
    long = body.side == "long"
    position_side = "LONG" if long else "SHORT"

    # Объём и цены приводим к шагам инструмента до отправки. Биржа отклоняет
    # ордер, если объём не кратен шагу лота: «order size must match stepSize».
    filters = await client.symbol_filters(symbol)
    quantity = floor_to_step(body.quantity, filters["step"])
    if quantity < filters["min_qty"]:
        raise HTTPException(
            422,
            f"Объём {body.quantity:g} меньше минимального на бирже "
            f"({filters['min_qty']:g} {symbol[:-4]}). Увеличьте сумму или плечо.",
        )
    entry_price = round_to_tick(body.entry, filters["tick"]) if body.entry else None
    stop_price = round_to_tick(body.stop, filters["tick"])

    # Предел позиции на этом плече, если биржа его уже называла. Проверяем до
    # отправки: отказ «position exceed max size» после нажатия - это заявка,
    # которую трейдер уже считал поставленной.
    cap = leverage_caps.cap_at(leverage_caps.caps_for(session, symbol), body.leverage)
    if cap is not None:
        used = await _exposure(client, symbol)
        if used is not None:
            note = leverage_caps.room_note(
                quantity=quantity, cap=cap, used=used, leverage=body.leverage,
                coin=symbol[:-4] or symbol, step=filters["step"],
            )
            if note:
                raise HTTPException(422, note)

    # Вход и цели — два разных шага с разной ценой ошибки.
    #
    # Сорвался вход — не открылось ничего, и об этом надо сказать отказом.
    # Сорвались цели при уже открытой позиции — сделка есть, и объявлять её
    # неудачей нельзя: трейдер решит, что позиции нет, а она стоит на бирже.
    try:
        await _ensure_leverage(client, symbol, body.leverage)

        entry_order = await client.place_order(
            symbol=symbol,
            side="BUY" if long else "SELL",
            position_side=position_side,
            quantity=_num(quantity),
            order_type="LIMIT" if entry_price else "MARKET",
            price=_num(entry_price) if entry_price else None,
            sl_trigger=_num(stop_price),
            client_order_id=body.client_order_id,
        )
    except WeexTradeError as exc:
        # Отказ по пределу называет точное число - запоминаем его, и терминал
        # всех учеников ограничит сумму заранее.
        found = max_size_in(str(exc))
        if found:
            leverage_caps.learn(session, symbol, found[1], found[0])
        raise _fail(exc) from exc

    # Цели ставятся только когда позиция уже есть.
    #
    # Сокращающий ордер нечего сокращать, пока вход висит лимиткой, и биржа
    # отвечает «cannot set reduce only, you must cancel some order». Поэтому
    # при входе по рынку лестницу ставим сразу, а при лимитном входе её выставит
    # наблюдатель — в тот момент, когда позиция появится.
    takes: list[Any] = []
    placed: list[dict[str, Any]] = []
    warning = ""
    # Доли целей неравные: первая снимает 30%, вторая 50%, последняя остаток.
    # На маленькой позиции доля не набирает минимального объёма заявки, и
    # мелкие доли копятся до первой проходящей: вместо трёх целей будет две или
    # одна, но они будут - раньше сделка оставалась с одним стопом.
    ladder = split_ladder(quantity, list(body.takes), filters["step"], filters["min_qty"])

    if ladder and not entry_price:
        for i, (price, size) in enumerate(ladder):
            try:
                order = await client.place_tp_sl(
                    symbol=symbol,
                    plan_type="TAKE_PROFIT",
                    trigger_price=_num(round_to_tick(price, filters["tick"])),
                    quantity=_num(size),
                    position_side=position_side,
                    client_algo_id=f"tp{i + 1}_{body.client_order_id or ''}"[:32],
                )
            except WeexTradeError as exc:
                # Дальше по лестнице, а не наружу: отказ по одной цели не повод
                # остаться без остальных. Цена могла уйти за первую - биржа
                # такую заявку не примет, а вторая и третья ещё впереди.
                logger.warning("Цель %d для %s не встала: %s", i + 1, symbol, exc)
                warning = f"Цель {i + 1} не встала: {exc}"
                continue
            takes.append(order)
            placed.append(
                {"price": price, "order_id": plan_order_id(order), "filled": False}
            )

    # Запись для фонового ведения: без неё переносить стоп в безубыток будет
    # некому, как только трейдер закроет вкладку.
    client_id = body.client_order_id or f"{symbol}-{int(utcnow().timestamp() * 1000)}"
    live = session.execute(
        select(LiveTrade)
        .where(LiveTrade.student_id == student.id)
        .where(LiveTrade.client_id == client_id)
    ).scalar_one_or_none()
    if live is None:
        live = LiveTrade(student_id=student.id, client_id=client_id)
        session.add(live)
    live.symbol = symbol
    live.side = body.side
    live.entry = entry_price or 0.0
    live.initial_stop = stop_price
    live.current_stop = stop_price
    # Цели сделки - те, что реально встали на бирже. Если вход лимитный, их
    # ещё нет: тогда запоминаем замысел, а сопровождение перепишет его тем, что
    # поставит само.
    live.targets_json = json.dumps([p["price"] for p in placed] if placed else body.takes)
    live.tp_orders_json = json.dumps(placed, ensure_ascii=False)
    live.qty = quantity
    live.leverage = body.leverage
    live.margin = quantity * (entry_price or 0.0) / max(1, body.leverage)
    live.takes_hit = 0
    live.status = "waiting"
    live.sl_order_id = ""
    live.updated_at = utcnow()
    session.commit()

    return {
        "entry": entry_order,
        "takes": takes,
        "watched": live.client_id,
        "warning": warning,
    }


@router.post("/close")
async def close_position(
    body: CloseIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Закрыть позицию целиком или частью — по рынку.

    По рынку, а не лимитом: трейдер нажал «зафиксировать», значит он хочет выйти
    сейчас, а не поставить заявку и ждать. Лимит на выходе означал бы, что
    позиция осталась открытой, а человек считает, что вышел.

    Объём берём с биржи, а не из терминала: часть могла уже закрыться целями, и
    приказ на исходный объём биржа отклонит целиком.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    symbol = body.symbol.upper()
    long = body.side == "long"

    try:
        positions = await client.positions()
        # Со стороной, а не просто по инструменту. При открытом шорте отмена
        # ждущей лимитки в лонг уходила закрывать... шорт: терминал видел его
        # объём и слал рыночный приказ с чужой стороной. Биржа отвечала
        # «position side invalid» - и была права, а лимитка так и висела.
        position = position_for(positions, symbol, body.side)
        # Момент входа нужен, чтобы собрать все исполнения этой сделки, а не
        # только последний ордер.
        rows = session.execute(
            select(LiveTrade)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.symbol == symbol)
            .where(LiveTrade.status.in_(("waiting", "open")))
            .order_by(LiveTrade.id.desc())
        ).scalars().all()
        # Сделку ищем по её идентификатору, а не берём последнюю: терминал
        # умеет вести несколько сразу, и «последняя» - это чужая.
        live = next((r for r in rows if r.client_id == body.trade_id), None)
        if live is None:
            # Идентификатор не назвали или он не сошёлся - берём сделку только
            # тогда, когда она по этой монете и стороне одна. Выбирать наугад
            # из нескольких значит снять защиту чужой: «первая в списке» - это
            # не та, которую закрывают.
            same = [r for r in rows if r.side == body.side]
            live = same[0] if len(same) == 1 else None
        # Если позиция ещё не отмечена набранной, берём момент отправки входа:
        # сопровождение проставляет opened_at раз в пятнадцать секунд, а закрыть
        # руками можно и раньше. Без этого в итог попадал бы только последний
        # ордер — и результат расходился с биржей в разы.
        opened_at = (live.opened_at or live.created_at) if live else None

        size = 0.0
        for name in ("total", "size", "positionAmt", "available"):
            try:
                size = abs(float(position.get(name)))  # type: ignore[union-attr]
                break
            except (TypeError, ValueError, AttributeError):
                continue

        # Снимаемая сделка ещё ждёт своего входа - это отмена заявки, а не
        # закрытие позиции.
        #
        # Позиция по этой монете и стороне может быть, но набрана она соседней
        # сделкой: две лимитки на продажу, исполнилась нижняя. Раньше здесь
        # смотрели только на объём позиции - и снятие верхней, ещё стоящей
        # заявки уходило рыночным приказом закрывать чужую открытую позицию.
        # Трейдер отменял одну, а закрывались обе.
        waiting = await _entry_resting(client, live)
        if size <= 0 or waiting:
            # Заявки снимаем всегда: вход ещё не исполнился, а с ним висят стоп
            # и цели. «Отменённая» сделка иначе откроется сама, стоило рынку
            # дойти до уровня.
            cancelled = await _cancel_trade(
                client, symbol, live, [r for r in rows if r is not live]
            )
            await _forget(session, student, symbol, live)
            return {
                "closed": 0.0,
                # Позиция соседней сделки остаётся: терминал не должен решить,
                # что закрылось всё.
                "remaining": size if waiting else 0.0,
                "note": (
                    f"заявка снята, позиция соседней сделки не тронута"
                    if waiting and size > 0
                    else f"позиции нет, снято заявок: {cancelled}"
                    if cancelled
                    else "позиции нет"
                ),
            }

        filters = await client.symbol_filters(symbol)
        quantity = floor_to_step(size * body.share, filters["step"])
        if quantity < filters["min_qty"]:
            raise HTTPException(
                422,
                f"Доля {body.share:.0%} - это {quantity:g}, меньше минимального "
                f"объёма биржи. Закройте большую часть.",
            )

        # Без reduce_only: сторону позиции биржа и так знает из positionSide, а
        # сокращающий ордер она на защищённой позиции отклоняет — «cannot set
        # reduce only». В боте заказчика закрытие идёт ровно так же, обычным
        # рыночным ордером в противоположную сторону.
        order = await client.place_order(
            symbol=symbol,
            side="SELL" if long else "BUY",
            position_side="LONG" if long else "SHORT",
            quantity=_num(quantity),
            order_type="MARKET",
            client_order_id=body.client_order_id,
        )
        order_id = _order_id(order)

        remaining = max(0.0, size - quantity)
        if remaining < filters["min_qty"]:
            # Позиции больше нет: снимаем стоп и цели. Осевшие заявки на
            # несуществующий объём откроют позицию заново, стоило бы рынку
            # дойти до их цены.
            await _cancel_trade(client, symbol, live, [r for r in rows if r is not live])
            await _forget(session, student, symbol, live)

    except WeexTradeError as exc:
        raise _fail(exc) from exc

    # Настоящий результат берём у биржи, а не считаем сами.
    #
    # Наша цифра — это цена маркировки без комиссий: она совпадает с тем, что
    # биржа показывает по открытой позиции, но не с тем, что приходит на счёт.
    # Выход по рынку идёт по встречной стороне книги, и обе ноги платят
    # комиссию. Разница видна сразу: было +37, пришло +5.
    # Цену входа и сторону передаём затем, чтобы итог можно было посчитать и
    # тогда, когда биржа не назвала его сама: в её отчёте об исполнениях поля с
    # результатом может не быть вовсе - как не было поля с безубытком.
    realized, fee, fill = await _settled(
        client,
        symbol,
        order_id,
        opened_at,
        float(live.entry) if live else 0.0,
        body.side,
    )

    # Закрытая руками сделка тоже идёт в журнал - и пишем её здесь.
    #
    # Сопровождение ведёт только те, что ещё живы: закрытую мы сами сняли с
    # ведения строкой выше, и записывать её стало некому. Так и пропадали
    # сделки, закрытые кнопкой в терминале: на бирже прибыль есть, в журнале
    # сделки нет вовсе.
    #
    # Числа те же, что вернутся на экран: результат и комиссия с исполнений
    # биржи, а не наша оценка.
    if live is not None and remaining < filters["min_qty"]:
        _journal(session, student, live, realized, fee, fill, quantity)

    return {
        "closed": quantity,
        "remaining": remaining,
        "realized": realized,
        "fee": fee,
        "fill_price": fill,
    }


def _journal(
    session,
    student: Student,
    live: LiveTrade,
    realized: float | None,
    fee: float | None,
    fill: float | None,
    quantity: float,
) -> None:
    """Записать закрытую сделку в журнал по числам биржи.

    Повторная запись обновляет прежнюю: клиент мог успеть записать свою оценку,
    и наши числа её поправят, а не заведут вторую строку.
    """
    row = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.client_id == live.client_id)
    ).scalar_one_or_none()
    if row is None:
        row = ScalpTrade(student_id=student.id, client_id=live.client_id)
        session.add(row)

    # Комиссию второй раз не вычитаем: `_settled` уже отдаёт результат за её
    # вычетом - ровно то число, что уходит на экран. Вычесть её здесь ещё раз
    # значит записать в журнал убыток, которого не было.
    pnl = float(realized or 0.0)
    row.symbol = live.symbol
    row.side = live.side
    row.entry = float(live.entry)
    row.stop = float(live.initial_stop)
    row.exit_price = fill
    row.qty = quantity or float(live.qty)
    row.margin = float(live.margin or 0) or 1.0
    row.leverage = live.leverage
    row.takes_hit = live.takes_hit
    row.targets_json = live.targets_json or "[]"
    # Закрыто рукой - так и пишем: это не сработавшая цель и не стоп, и путать
    # их в статистике незачем.
    row.outcome = "manual"
    row.pnl = pnl
    row.fee = float(fee or 0.0)
    row.opened_at = live.opened_at or live.created_at
    row.closed_at = utcnow()
    row.note = "биржа"
    row.from_exchange = True
    # Монеты начисляются здесь же, до коммита: сделка и награда за неё обязаны
    # попасть в базу одной операцией.
    award_trade_coins(session, row)
    session.commit()
    logger.info(
        "В журнал: %s %s, итог %.4f (комиссия %.4f)", live.symbol, live.side, pnl, fee or 0.0
    )


def _epoch_ms(value: datetime | None) -> int:
    """Время в миллисекундах эпохи.

    SQLite отдаёт дату без часового пояса, а `timestamp()` у наивной даты
    считает её местным временем: итог уезжал бы на разницу поясов, а у ранних
    дат на Windows и вовсе падал. Наивную считаем UTC — мы её такой и писали.
    """
    if value is None:
        return 0
    try:
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(aware.timestamp() * 1000)
    except (OverflowError, OSError, ValueError):
        return 0


async def _settled(
    client: WeexFutures,
    symbol: str,
    order_id: str,
    since: datetime | None,
    entry: float = 0.0,
    side: str = "long",
) -> tuple[float | None, float | None, float | None]:
    """Итог сделки по исполнениям с биржи: результат за вычетом комиссии.

    Считаем по всем исполнениям с момента входа, а не по одному закрывающему
    ордеру. Сделка состоит из входа, сработавших целей и выхода; спрашивать
    только последний ордер значит потерять остальное — а если биржа не успела
    его проиндексировать, то и всё сразу.

    Исполнения появляются в отчёте не мгновенно, поэтому спрашиваем несколько
    раз с нарастающей паузой, как в боте заказчика.
    """
    opened_ms = _epoch_ms(since)

    for pause in (0.0, 0.25, 0.6, 1.0):
        if pause:
            await asyncio.sleep(pause)
        try:
            fills = await client.user_trades(symbol, limit=100)
        except WeexTradeError as exc:
            logger.warning("Исполнения %s не получены: %s", symbol, exc)
            return None, None, None

        mine = []
        for f in fills:
            same_order = order_id and str(f.get("orderId") or "") == str(order_id)
            if same_order or (opened_ms and fill_time(f) >= opened_ms):
                mine.append(f)

        # Пока в отчёте нет закрывающего ордера, итог считать рано: он и есть
        # самая большая часть результата.
        if order_id and not any(str(f.get("orderId") or "") == str(order_id) for f in mine):
            continue
        if not mine:
            continue

        # Ставку инструмента передаём: комиссию биржа называет в отчёте не
        # всегда, и без неё в журнал уходил результат до её удержания.
        taker = 0.0
        try:
            taker = float((await client.symbol_filters(symbol)).get("taker_fee") or 0)
        except Exception as exc:  # noqa: BLE001 - причина в логе, итог важнее
            logger.debug("Ставка комиссии %s не получена: %s", symbol, exc)
        gross, fee, price = settle(mine, entry, side, taker)
        net = gross - fee
        # Подробности - в лог: расхождение с цифрой биржи разбирается только по
        # исполнениям, а не по итоговому числу.
        for one in mine:
            logger.info(
                "Исполнение %s %s: цена %s объём %s результат %s комиссия %s",
                symbol,
                one.get("side"),
                one.get("price"),
                one.get("qty") or one.get("size"),
                one.get("realizedPnl"),
                one.get("commission"),
            )
        logger.info(
            "Сделка %s закрыта: по бирже %.4f, комиссия %.4f, на счёт %.4f",
            symbol,
            gross,
            fee,
            net,
        )
        return round(net, 8), round(fee, 8), price

    logger.warning("Исполнения %s не появились в отчёте вовремя", symbol)
    return None, None, None


def _owned(rows: Iterable[LiveTrade]) -> tuple[set[str], list[str]]:
    """Метки и клиентские идентификаторы сделок, которые трогать нельзя."""
    marks: set[str] = set()
    prefixes: list[str] = []
    for row in rows:
        prefixes.append(row.client_id)
        marks.add(str(row.sl_order_id or ""))
        recorded = json.loads(row.tp_orders_json or "[]")
        for take in recorded:
            marks.add(str(take.get("order_id") or ""))
        marks |= {take_label(row.client_id, i) for i in range(max(len(recorded), 3))}
        marks |= {stop_label(row.client_id, hit) for hit in range(4)}
    marks.discard("")
    return marks, [p for p in prefixes if p]


async def _cancel_orphans(client: WeexFutures, symbol: str, keep: Sequence[LiveTrade]) -> int:
    """Снять заявки, у которых нет хозяина среди наших сделок.

    Сюда приходят, когда снимаемую сделку опознать не удалось. Раньше в этом
    случае снималось всё по инструменту - и открытая по той же монете позиция
    оставалась без стопа и целей, ничего об этом не сказав. Это худший исход из
    возможных, и заплатить им за уборку чужой заявки нельзя.

    Поэтому щадим всё, что принадлежит известным сделкам, а снимаем только
    ничьё: осевшая заявка без хозяина - это позиция, о которой трейдер не
    знает, рынок дойдёт до её цены и исполнит.
    """
    if not keep:
        return await _cancel_everything(client, symbol)

    marks, prefixes = _owned(keep)
    removed = 0

    def ours(order: dict[str, Any]) -> bool:
        if order_marks(order) & marks:
            return True
        mark = str(order.get("clientOrderId") or order.get("clientOid") or "")
        return any(mark.startswith(p) for p in prefixes if mark)

    try:
        for order in await client.open_orders(symbol):
            order_id = str(order.get("orderId") or order.get("id") or "")
            if not order_id or ours(order):
                continue
            try:
                await client.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Ничья заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Список заявок %s не получен: %s", symbol, exc)

    try:
        for order in await client.algo_orders(symbol):
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if not order_id or ours(order):
                continue
            try:
                await client.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Ничья условная заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Условные заявки %s не получены: %s", symbol, exc)

    logger.info("Снято ничьих заявок по %s: %d (сделок под защитой %d)", symbol, removed, len(keep))
    return removed


async def _cancel_trade(
    client: WeexFutures,
    symbol: str,
    live: LiveTrade | None,
    keep: Sequence[LiveTrade] = (),
) -> int:
    """Снять заявки одной сделки, не трогая соседние.

    Раньше снималось всё по инструменту. Пока сделка была одна, это и значило
    «её заявки». С появлением встречных позиций та же строка кода снимала стоп
    и цели соседней сделки - то есть оставляла её без защиты, ничего об этом
    не сказав.

    Свои заявки узнаём по идентификаторам: цели и стоп записаны в сделке, а
    вход помечен нашим клиентским идентификатором - им же он и отправлялся.

    Сделку не опознали - снимаем только то, у чего нет хозяина среди остальных
    наших сделок. Снять всё подряд значит оставить открытую позицию без защиты.
    """
    if live is None:
        return await _cancel_orphans(client, symbol, keep)

    mine = {str(live.sl_order_id or "")}
    for take in json.loads(live.tp_orders_json or "[]"):
        mine.add(str(take.get("order_id") or ""))
    mine.discard("")

    removed = 0
    try:
        for order in await client.open_orders(symbol):
            order_id = str(order.get("orderId") or order.get("id") or "")
            client_id = str(order.get("clientOrderId") or order.get("clientOid") or "")
            if order_id not in mine and not client_id.startswith(live.client_id):
                continue
            try:
                await client.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Список заявок %s не получен: %s", symbol, exc)

    try:
        for order in await client.algo_orders(symbol):
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if order_id not in mine:
                continue
            try:
                await client.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Условные заявки %s не получены: %s", symbol, exc)

    return removed


async def _cancel_everything(client: WeexFutures, symbol: str) -> int:
    """Снять по инструменту всё: и обычные заявки, и условные.

    Двумя ручками, а не одной: условные заявки обычная не видит и отвечает
    «ордер не найден», оставляя стоп висеть. Осевшая заявка на несуществующий
    объём — это открытая позиция, о которой трейдер не знает: рынок дойдёт до её
    цены и исполнит.
    """
    removed = 0

    try:
        for order in await client.open_orders(symbol):
            order_id = str(order.get("orderId") or order.get("id") or "")
            if not order_id:
                continue
            try:
                await client.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Список заявок %s не получен: %s", symbol, exc)

    try:
        for order in await client.algo_orders(symbol):
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if not order_id:
                continue
            try:
                await client.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Условные заявки %s не получены: %s", symbol, exc)

    logger.info("Снято заявок по %s: %d", symbol, removed)
    return removed


async def _entry_resting(client: WeexFutures, live: LiveTrade | None) -> bool:
    """Стоит ли ещё вход этой сделки в заявках биржи.

    По нашему клиентскому идентификатору с начала строки: при переносе лимитки
    к нему дописывается номер попытки, а сам он остаётся прежним.

    Биржа не ответила - верим записанному состоянию: снять заявку и не тронуть
    позицию безопаснее, чем наоборот.
    """
    if live is None:
        return False
    try:
        orders = await client.open_orders(live.symbol)
    except WeexTradeError as exc:
        logger.warning("Заявки %s не получены: %s", live.symbol, exc)
        return live.status == "waiting"
    for order in orders:
        mark = str(order.get("clientOrderId") or order.get("clientOid") or "")
        if mark and mark.startswith(live.client_id):
            return True
    return False


async def _forget(
    session, student: Student, symbol: str, live: LiveTrade | None = None
) -> None:
    """Снять сделку с ведения: позиции больше нет.

    Когда сделка известна - только её: соседняя по тому же инструменту живёт
    своей жизнью, и закрывать её записью значит потерять её из виду.
    """
    if live is not None:
        rows = [live]
    else:
        rows = session.execute(
            select(LiveTrade)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.symbol == symbol)
            .where(LiveTrade.status.in_(("waiting", "open")))
        ).scalars().all()
    for row in rows:
        row.status = "closed"
        row.closed_at = utcnow()
        row.updated_at = utcnow()
    if rows:
        session.commit()


@router.post("/breakeven")
async def move_to_breakeven(
    body: StopIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Перенести стоп в безубыток с учётом комиссии обеих ног.

    Наивный перенос на цену входа гарантирует небольшой убыток на каждом
    «безубытке»: комиссия уплачена на входе и будет уплачена на выходе.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    position = Position(
        symbol=body.symbol.upper(),
        side=body.side,
        entry=body.entry,
        quantity=body.quantity,
        stop=body.current_stop,
    )
    target = breakeven_price(position, body.mark_price)
    if target is None or not should_move_stop(position, target):
        return {"moved": False, "stop": body.current_stop}

    try:
        await client.modify_tp_sl(
            symbol=position.symbol, order_id=body.order_id, trigger_price=_num(target)
        )
    except WeexTradeError as exc:
        raise _fail(exc) from exc
    return {"moved": True, "stop": target}


def _order_id(order: Any) -> str:
    """Идентификатор ордера: биржа кладёт его в разные поля."""
    if isinstance(order, dict):
        for name in ("orderId", "order_id", "id", "clientOrderId"):
            if order.get(name):
                return str(order[name])
    return ""


def _num(value: float) -> str:
    """Число для биржи строкой, без экспоненты.

    На монетах вроде PEPE цена уходит в 1e-07, а биржа такой записи не
    понимает: ордер отклоняется с невнятной ошибкой о формате.
    """
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"
