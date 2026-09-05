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

import logging
from typing import Any

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.deps import get_current_student, get_session
from core.models import Student, WeexCredential, utcnow
from core.trading.position import Position, breakeven_price, should_move_stop
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures, WeexTradeError

router = APIRouter(prefix="/api/trading", tags=["trading"])
logger = logging.getLogger("nmnh.trading")

# Одна сессия на процесс: соединения живут дольше запроса, и заводить их по
# числу учеников значит исчерпать сокеты на первом же десятке.
_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
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
    """Отказ биржи наружу отдаём как есть: трейдеру нужно знать причину."""
    logger.warning("WEEX отказал: %s (код %s)", exc, exc.code)
    return HTTPException(502, f"Биржа: {exc}")


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
        "updated_at": row.updated_at.isoformat() if row else None,
    }


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

    try:
        await client.set_leverage(symbol, body.leverage)

        entry_order = await client.place_order(
            symbol=symbol,
            side="BUY" if long else "SELL",
            position_side=position_side,
            quantity=_num(body.quantity),
            order_type="LIMIT" if body.entry else "MARKET",
            price=_num(body.entry) if body.entry else None,
            sl_trigger=_num(body.stop),
            client_order_id=body.client_order_id,
        )

        # Цели — отдельными сокращающими ордерами, равными долями. Ставятся
        # после входа: пока позиции нет, сокращать нечего.
        takes: list[Any] = []
        if body.takes:
            share = body.quantity / len(body.takes)
            for i, price in enumerate(body.takes):
                takes.append(
                    await client.place_order(
                        symbol=symbol,
                        side="SELL" if long else "BUY",
                        position_side=position_side,
                        quantity=_num(share),
                        order_type="LIMIT",
                        price=_num(price),
                        reduce_only=True,
                        time_in_force="GTC",
                        client_order_id=f"{body.client_order_id}_tp{i + 1}"
                        if body.client_order_id
                        else None,
                    )
                )
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    return {"entry": entry_order, "takes": takes}


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


def _num(value: float) -> str:
    """Число для биржи строкой, без экспоненты.

    На монетах вроде PEPE цена уходит в 1e-07, а биржа такой записи не
    понимает: ордер отклоняется с невнятной ошибкой о формате.
    """
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"
