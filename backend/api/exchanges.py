"""Биржи ученика: витрина условий, выбор активной и вход биржей.

Три вопроса в одном месте, потому что ученик задаёт их подряд:

* **где торговать** - витрина: какие биржи мы поддерживаем, где идёт своя
  книга, где ниже комиссия, где счёт подключается входом, а где ключами
  (`core/venues.py`);
* **чем я уже владею** - его счета: подключён ли, через академию он или свой,
  какая биржа активна, какие номера подтвердила академия;
* **как подключиться без ключей** - вход биржей: адрес входа и обмен кода
  (`core/oauth.py`).

Ключи руками остаются на прежней ручке `/api/trading/keys` - её знает
терминал; здесь она повторена под адресом из ТЗ (§6), чтобы оба пути
подключения лежали рядом.

Витрина не врёт про условия. Пока биржа не подтвердила ставку для академии и
долю кешбэка, в ответе стоит `null`, и терминал пишет «условия уточняются»:
обещание скидки, которой нет, ученик запомнит, а оговорку - нет.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from core import oauth, venues
from core.exchanges import KEY_EXCHANGES, exchange_code, title_of
from core.models import AcademyUid, LiveTrade, Student, iso
from core.weex import keys as keystore
from core.weex.futures import Credentials

from backend.api.trading import _get_session
from backend.deps import get_current_student, get_session
from backend.security import TokenError, decode_token, encode_token
from backend.trading.accounts import (
    account_for,
    accounts_of,
    live_by_exchange,
    may_connect,
    switch_refusal,
)
from backend.trading.connect import ConnectRefused, connect

logger = logging.getLogger("nmnh.api.exchanges")

router = APIRouter(prefix="/api/exchanges", tags=["exchanges"])


class KeysIn(BaseModel):
    api_key: str
    secret_key: str
    passphrase: str = ""


class ActiveIn(BaseModel):
    exchange: str


class OauthStartIn(BaseModel):
    # Куда вернуть ученика после биржи. Пусто - адрес из настроек сервера.
    redirect: str = ""


class OauthFinishIn(BaseModel):
    code: str
    state: str


# ── витрина ─────────────────────────────────────────────────────────────────


@router.get("")
async def listing(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
) -> dict:
    """Биржи, условия и состояние счетов этого ученика.

    Одним ответом, а не тремя: витрина без своих счетов - реклама, счета без
    условий - список кодов.
    """
    rows = {row.exchange: row for row in accounts_of(session, student.id)}
    live = live_by_exchange(session, student.id)
    confirmed: dict[str, list[str]] = {}
    for uid_row in session.execute(
        select(AcademyUid).where(AcademyUid.student_id == student.id)
    ).scalars():
        confirmed.setdefault(uid_row.exchange, []).append(uid_row.uid)

    out = []
    for one in venues.VENUES:
        row = rows.get(one.code)
        out.append(
            {
                **venues.as_dict(one),
                # Ключи этой биржи терминал принимает уже сегодня.
                "keys_supported": one.code in KEY_EXCHANGES,
                # А вот открыта ли она этому ученику - решает подтверждение
                # академии: пока счёт не назван в боте и не подтверждён,
                # подключать нечего (backend/trading/accounts.py, may_connect).
                "may_connect": one.code in KEY_EXCHANGES
                and may_connect(session, student, one.code),
                # Вход биржей включён на этом сервере: без брокерского ID и
                # адресов входа кнопка бессмысленна.
                "oauth_ready": one.oauth and oauth.enabled(one.code),
                "connected": bool(row and row.is_active),
                "key_tail": row.key_tail if row else "",
                "auth_kind": row.auth_kind if row else "",
                "access": row.access if row else "",
                "uid": row.exchange_uid if row else "",
                "updated_at": iso(row.updated_at) if row else None,
                # Номера, подтверждённые академией: по ним считается кешбэк.
                "academy_uids": sorted(confirmed.get(one.code, [])),
                # Сделок терминала, идущих на этой бирже прямо сейчас.
                "live": live.get(one.code, 0),
            }
        )
    return {
        "active": (student.active_exchange or "").strip().lower(),
        "vault": keystore.enabled(),
        # Пока хоть одна сделка идёт, активную биржу менять нельзя: счёт
        # переключился бы под открытой позицией.
        "live_total": sum(live.values()),
        "venues": out,
    }


# ── активная биржа ──────────────────────────────────────────────────────────


@router.post("/active")
async def set_active(
    body: ActiveIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
) -> dict:
    """Сменить биржу, на которую уходят новые сделки.

    Подключение биржи активную не меняет: счета живут рядом, и старый
    остаётся подключённым (`backend/trading/connect.py`). Меняется она только
    здесь и только руками.

    Пока идёт хоть одна сделка терминала - отказ; почему именно, написано у
    самого правила (`backend/trading/accounts.py`, `switch_refusal`).
    """
    code = exchange_code(body.exchange)
    row = account_for(session, student.id, code) if code else None
    if row is None or not row.is_active:
        raise HTTPException(409, "Сначала подключите счёт этой биржи")

    refusal = switch_refusal(session, student, code)
    if refusal:
        raise HTTPException(409, refusal)

    student.active_exchange = code
    session.commit()
    return {"ok": True, "exchange": code, "title": title_of(code)}


@router.delete("/{code}")
async def disconnect(
    code: str,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
) -> dict:
    """Отключить счёт биржи. Пока на ней идут сделки терминала - нельзя."""
    venue = exchange_code(code)
    row = account_for(session, student.id, venue) if venue else None
    if row is None:
        raise HTTPException(404, "Счёт этой биржи не подключён")

    live = live_by_exchange(session, student.id).get(row.exchange, 0)
    if live:
        raise HTTPException(
            409,
            f"На {row.exchange.upper()} идут сделки терминала ({live}): "
            "без ключа их некому сопровождать. Закройте их и отключите счёт.",
        )
    if (student.active_exchange or "") == row.exchange:
        student.active_exchange = ""
    session.delete(row)
    session.commit()
    return {"ok": True}


# ── ключи руками ────────────────────────────────────────────────────────────


@router.post("/{code}/keys")
async def save_keys(
    code: str,
    body: KeysIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
) -> dict:
    """Подключить счёт ключами. Проверка та же, что и у входа биржей."""
    venue = exchange_code(code)
    if not venue:
        raise HTTPException(422, f"К бирже {code} подключиться пока нельзя")
    creds = Credentials(body.api_key.strip(), body.secret_key.strip(), body.passphrase.strip())
    try:
        row = await connect(session, student, venue, creds, _get_session)
    except ConnectRefused as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    session.commit()
    return {"ok": True, "exchange": venue, "key_tail": row.key_tail, "access": row.access}


# ── вход биржей ─────────────────────────────────────────────────────────────


@router.post("/{code}/oauth/start")
async def oauth_start(
    code: str,
    body: OauthStartIn,
    request: Request,
    student: Student = Depends(get_current_student),
) -> dict:
    """Адрес входа на бирже и подписанное состояние к нему.

    Состояние - подписанный токен, а не строка в базе: вход длится минуты, а
    лишняя таблица пережила бы и сервер, и смысл.
    """
    venue = exchange_code(code) or (code or "").strip().lower()
    one = oauth.provider(venue)
    if not one.configured:
        raise HTTPException(
            503,
            f"Вход через {venue.upper()} ещё не включён: брокерский ID у этой биржи "
            "не получен. Подключите счёт ключами - это работает уже сейчас.",
        )

    verifier = oauth.new_verifier()
    now = int(time.time())
    state = encode_token(
        {
            "sub": str(student.id),
            "type": "oauth",
            "exchange": venue,
            "verifier": verifier,
            "iat": now,
            "exp": now + oauth.STATE_TTL,
        },
        request.app.state.config.jwt_secret,
    )
    return {
        "url": oauth.authorize_url(one, state, verifier),
        "state": state,
        "expires_in": oauth.STATE_TTL,
        "redirect": body.redirect or one.redirect_uri,
    }


@router.post("/{code}/oauth/finish")
async def oauth_finish(
    code: str,
    body: OauthFinishIn,
    request: Request,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
) -> dict:
    """Обменять код биржи на доступ и сохранить счёт.

    Состояние проверяется целиком: подпись, срок, ученик и биржа. Чужое
    состояние означало бы, что счёт одного человека привязывается к другому.
    """
    venue = exchange_code(code) or (code or "").strip().lower()
    one = oauth.provider(venue)
    if not one.configured:
        raise HTTPException(503, f"Вход через {venue.upper()} ещё не включён")

    try:
        payload = decode_token(body.state, request.app.state.config.jwt_secret)
    except TokenError as exc:
        raise HTTPException(400, "Вход просрочен или испорчен - начните заново") from exc
    if payload.get("type") != "oauth" or str(payload.get("sub")) != str(student.id):
        raise HTTPException(403, "Это состояние входа принадлежит другому входу")
    if payload.get("exchange") != venue:
        raise HTTPException(400, "Состояние входа от другой биржи")

    try:
        answer = await oauth.exchange(
            one, body.code.strip(), str(payload.get("verifier") or ""), await _get_session()
        )
    except oauth.OauthError as exc:
        raise HTTPException(400, str(exc)) from exc

    grant = oauth.read_grant(answer)
    if not grant.tradable:
        # Токен без ключей торговли - это половина связки: торговать им нельзя,
        # и делать вид, что счёт подключён, нельзя тоже.
        logger.warning("Биржа %s вернула вход без ключей торговли", venue)
        raise HTTPException(
            501,
            f"{venue.upper()} вернула вход, но не ключи торговли. "
            "Способ подключения уточняется у биржи - пока подключите счёт ключами.",
        )

    creds = Credentials(grant.api_key, grant.secret_key, grant.passphrase)
    try:
        row = await connect(
            session,
            student,
            venue,
            creds,
            _get_session,
            auth_kind="oauth",
            token=grant.access_token,
            refresh=grant.refresh_token,
            expires_in=grant.expires_in,
            uid_hint=grant.uid,
        )
    except ConnectRefused as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    session.commit()
    return {
        "ok": True,
        "exchange": venue,
        "key_tail": row.key_tail,
        "access": row.access,
        "auth_kind": row.auth_kind,
    }
