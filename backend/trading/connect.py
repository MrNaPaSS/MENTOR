"""Подключение биржевого счёта: одно место на оба пути.

Путей два - ключи руками и вход биржей, - а правила у них общие, и разойтись
этим правилам нельзя: на них держатся и ребейт, и кешбэк.

* ключи проверяются **до** сохранения, запросом баланса. Иначе неверный ключ
  всплывёт в момент ордера, то есть в самый неподходящий;
* номер счёта спрашивается **у самой биржи**, а не у ученика. Названный
  человеком может оказаться чужим по ошибке, а ребейт с него уйдёт другому;
* если академия подтвердила на этой бирже другой номер - подключения нет.
  Иначе кешбэк посчитается тому, кто его не зарабатывал;
* **биржа открывается только после подтверждения академией.** Человек
  называет UID своего счёта в боте академии, владелец подтверждает - и биржа
  появляется в настройках. Пока подтверждения нет, подключить её нельзя:
  сниженная ставка и кешбэк считаются по паре «биржа и UID», и счёт, чьего
  номера мы не знаем, в эту пару не попадает.

  Уже подключённый счёт остаётся подключаемым: ключи протухают, их меняют, и
  запертая кнопка означала бы позицию, которую нечем вести.

Отказ возвращается исключением с готовым текстом для ученика: ручке остаётся
выбрать код ответа.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from core.models import ExchangeAccount, Student, utcnow
from core.binance.futures import BinanceFutures
from core.bingx.futures import BingxFutures
from core.mexc.futures import MexcFutures
from core.okx.futures import OkxFutures
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures, WeexTradeError
from core.weex.uid import clean_uid

from backend.trading.accounts import (
    access_kind,
    account_for,
    confirmed_uids,
    may_connect,
)

logger = logging.getLogger("nmnh.trading.connect")

# Клиент проверки по бирже. Тот же список, что у торговли, но здесь он нужен
# до сохранения: проверяем ровно тем клиентом, которым потом будем торговать.
PROBES: dict[str, type] = {
    "weex": WeexFutures,
    "okx": OkxFutures,
    "bingx": BingxFutures,
    "mexc": MexcFutures,
    "binance": BinanceFutures,
}


class ConnectRefused(Exception):
    """Счёт подключить нельзя. `status` - что ответить по HTTP."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def probe_for(code: str, creds: Credentials, http) -> Any:
    client = PROBES.get(code)
    if client is None:
        raise ConnectRefused(f"К бирже {code} подключиться пока нельзя", 422)
    return client(creds, http)


async def account_uid(probe: Any, student: Student, code: str) -> str:
    """Номер счёта на бирже: у самой биржи, а у WEEX - UID ученика."""
    ask = getattr(probe, "account_uid", None)
    uid = ""
    if ask is not None:
        try:
            uid = clean_uid(await ask())
        except WeexTradeError as exc:
            logger.warning("Номер счёта на %s не получен: %s", code, exc)
    if not uid and code == "weex":
        uid = clean_uid(student.weex_uid)
    return uid


# Что сказать про биржу, которая не дала ключу торговое право. Текст называет
# причину, а не только факт: ученик должен понять, что делать дальше.
NO_TRADE_RIGHT = {
    "okx": (
        "Ключ выдан только на чтение. OKX даёт право торговли, когда на счёте "
        "есть 100 USD - пополните счёт и создайте ключ заново, отметив «Trade»."
    ),
}


async def check_trading_right(probe: Any, code: str) -> None:
    """Может ли этот ключ ставить заявки. Биржа молчит - не мешаем."""
    ask = getattr(probe, "can_trade", None)
    if ask is None:
        return
    try:
        allowed = await ask()
    except WeexTradeError as exc:
        logger.warning("Права ключа на %s не получены: %s", code, exc)
        return
    if allowed is False:
        raise ConnectRefused(
            NO_TRADE_RIGHT.get(code, "Ключ выдан только на чтение: заявки им не поставить."),
            400,
        )


def check_uid(session, student: Student, code: str, uid: str) -> str:
    """Сверить счёт с подтверждённым академией. Вернуть вид доступа."""
    confirmed = confirmed_uids(session, student.id, code)
    if confirmed and uid and uid not in confirmed:
        raise ConnectRefused(
            f"Академия подтвердила на {code.upper()} другой счёт. "
            "Подключите тот, чей UID вы называли, или пришлите новый UID в бот академии.",
            409,
        )
    return access_kind(uid, confirmed)


async def connect(
    session,
    student: Student,
    code: str,
    creds: Credentials,
    http,
    *,
    auth_kind: str = "keys",
    token: str = "",
    refresh: str = "",
    expires_in: int = 0,
    uid_hint: str = "",
) -> ExchangeAccount:
    """Проверить счёт и сохранить его. Общее тело обоих путей подключения."""
    if not keystore.enabled():
        raise ConnectRefused("Торговля выключена: на сервере не задан ключ шифрования", 503)

    # Биржа без подтверждения академии не подключается вовсе - и говорим об
    # этом до проверки ключей: человеку нечего исправлять в ключах, ему нужно
    # назвать UID в боте академии.
    if not may_connect(session, student, code):
        raise ConnectRefused(
            f"Академия не подтвердила ваш счёт на {code.upper()}. "
            "Пришлите UID этого счёта в бот академии - после подтверждения биржа "
            "появится в настройках.",
            403,
        )

    probe = probe_for(code, creds, http)
    try:
        await probe.balance()
    except WeexTradeError as exc:
        raise ConnectRefused(f"Ключи не подошли: {exc}", 400) from exc

    # Баланс читается и ключом без права торговли, поэтому одной этой проверки
    # мало. OKX выдаёт торговое право не всякому ключу: пока на счёте меньше
    # ста долларов, ключ создаётся только на чтение. Раньше такой счёт
    # подключался успешно, а отказ приходил в момент заявки - там объяснять
    # его уже поздно.
    await check_trading_right(probe, code)

    uid = await account_uid(probe, student, code) or clean_uid(uid_hint)
    access = check_uid(session, student, code, uid)

    row = account_for(session, student.id, code)
    if row is None:
        row = ExchangeAccount(student_id=student.id, exchange=code)
        session.add(row)
    row.exchange_uid = uid
    row.access = access
    row.api_key_enc = keystore.encrypt(creds.api_key)
    row.secret_enc = keystore.encrypt(creds.secret_key)
    row.passphrase_enc = keystore.encrypt(creds.passphrase)
    row.key_tail = keystore.mask(creds.api_key)
    row.auth_kind = auth_kind
    # Токен входа храним рядом с ключами и так же зашифрованным: по нему счёт
    # переподключается, когда биржа отзовёт выданные ключи.
    row.oauth_token_enc = keystore.encrypt(token) if token else ""
    row.oauth_refresh_enc = keystore.encrypt(refresh) if refresh else ""
    row.oauth_expires_at = _expires(expires_in)
    row.is_active = True
    row.updated_at = utcnow()
    # Первый подключённый счёт становится активным: выбирать не из чего.
    if not (student.active_exchange or "").strip():
        student.active_exchange = code
    return row


def _expires(seconds: int) -> datetime | None:
    if seconds <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=int(seconds))
