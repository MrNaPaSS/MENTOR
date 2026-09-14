"""Счета ученика на биржах: где лежат ключи и какой клиент ими торгует.

Одно место на весь сервер. Раньше ключи и клиент WEEX доставались в пяти
местах подряд - торговые ручки, сопровождение, баланс, оборот, пересчёт, - и
вторая биржа означала бы пять одинаковых развилок, одна из которых однажды
разошлась бы с остальными.

Два правила, на которых держится мультибиржа:

* **Новая сделка** уходит на активную биржу ученика: ту, что он выбрал, а если
  не выбирал - на первую подключённую.
* **Идущая сделка** ведётся на той бирже, где открыта (`LiveTrade.exchange`),
  что бы ни было выбрано сейчас. Сменил ученик активную биржу посреди сделки -
  стоп его позиции всё равно переставится там, где позиция стоит.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
from sqlalchemy import select

from core.exchanges import KEY_EXCHANGES, KEYS_EXCHANGE
from core.models import AcademyUid, ExchangeAccount, LiveTrade, Student
from core.binance.futures import BinanceFutures
from core.bingx.futures import BingxFutures
from core.mexc.futures import MexcFutures
from core.okx.futures import OkxFutures
from core.weex.uid import clean_uid
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures

SessionFactory = Callable[[], Awaitable[aiohttp.ClientSession]]

# Код биржи -> торговый клиент. Новая биржа - новая строка здесь и адаптер.
CLIENTS: dict[str, type] = {
    "weex": WeexFutures,
    "okx": OkxFutures,
    "bingx": BingxFutures,
    "mexc": MexcFutures,
    "binance": BinanceFutures,
}


def trade_exchange(code: str | None) -> str:
    """Биржа сделки. Пусто - записана до мультибиржи, значит WEEX."""
    return (code or "").strip().lower() or KEYS_EXCHANGE


def _order(row: ExchangeAccount) -> int:
    return KEY_EXCHANGES.index(row.exchange) if row.exchange in KEY_EXCHANGES else len(KEY_EXCHANGES)


def accounts_of(session, student_id: int, *, connected_only: bool = False) -> list[ExchangeAccount]:
    """Счета ученика в порядке бирж интерфейса."""
    query = select(ExchangeAccount).where(ExchangeAccount.student_id == student_id)
    if connected_only:
        query = query.where(ExchangeAccount.is_active.is_(True))
    return sorted(session.execute(query).scalars().all(), key=_order)


def account_for(session, student_id: int, exchange: str | None) -> ExchangeAccount | None:
    """Счёт ученика на этой бирже, подключён он или нет."""
    return session.execute(
        select(ExchangeAccount)
        .where(ExchangeAccount.student_id == student_id)
        .where(ExchangeAccount.exchange == trade_exchange(exchange))
    ).scalar_one_or_none()


def active_account(session, student: Student) -> ExchangeAccount | None:
    """Счёт, на который уходят новые сделки.

    Выбранная биржа, если ключи на ней подключены; иначе первая подключённая.
    Выбор, оставшийся от отключённого счёта, молча не держим: терминал без
    счёта при подключённом соседнем выглядел бы сломанным.
    """
    connected = accounts_of(session, student.id, connected_only=True)
    chosen = (getattr(student, "active_exchange", "") or "").strip().lower()
    for row in connected:
        if row.exchange == chosen:
            return row
    return connected[0] if connected else None


def credentials(row: ExchangeAccount) -> Credentials:
    return Credentials(
        api_key=keystore.decrypt(row.api_key_enc),
        secret_key=keystore.decrypt(row.secret_enc),
        passphrase=keystore.decrypt(row.passphrase_enc),
    )


def client_class(exchange: str) -> type:
    return CLIENTS[trade_exchange(exchange)]


def client_for(row: ExchangeAccount, session_factory: SessionFactory) -> Any:
    """Торговый клиент биржи этого счёта."""
    return client_class(row.exchange)(credentials(row), session_factory)


def keyed_students():
    """Подзапрос: ученики, у которых подключён хоть один счёт."""
    return select(ExchangeAccount.student_id).where(ExchangeAccount.is_active.is_(True))


# ── подтверждение академией ──────────────────────────────────────────────────


def confirmed_uids(session, student_id: int, exchange: str) -> set[str]:
    """Счета ученика на этой бирже, подтверждённые академией. Только цифры.

    Пустое множество значит не «нет доступа», а «академия про эту биржу ничего
    не говорила»: такой счёт подключается как свой, с ограничениями.
    """
    rows = session.execute(
        select(AcademyUid.uid)
        .where(AcademyUid.student_id == student_id)
        .where(AcademyUid.exchange == trade_exchange(exchange))
    ).scalars()
    return {clean_uid(uid) for uid in rows if clean_uid(uid)}


def academy_confirmed(session, student: Student, exchange: str) -> bool:
    """Подтвердила ли академия счёт этого ученика на этой бирже.

    По этому признаку биржа вообще появляется в настройках. Правило простое:
    человек называет UID своего счёта в боте академии, владелец подтверждает -
    и только тогда биржу можно подключить. Без подтверждения мы не знаем, чей
    это счёт, а от ответа зависят деньги: сниженная ставка и кешбэк считаются
    по паре «биржа и UID».

    Одно исключение - WEEX у тех, кто через неё и пришёл. Их номер лежит в
    записи ученика (`weex_uid`) с тех пор, когда отдельной таблицы
    подтверждений ещё не было: академия проверила его руками при выдаче
    доступа в кабинет. Требовать подтверждение заново значило бы отобрать
    торговлю у всех, кто уже торгует.
    """
    code = trade_exchange(exchange)
    if confirmed_uids(session, student.id, code):
        return True
    return code == KEYS_EXCHANGE and bool(clean_uid(student.weex_uid))


def may_connect(session, student: Student, exchange: str) -> bool:
    """Можно ли подключить ключи этой биржи.

    Уже подключённый счёт остаётся подключаемым и без подтверждения: ключи
    биржи протухают, их меняют, и запертая кнопка означала бы позицию, которую
    нечем вести. Отбирать доступ у того, кто уже торгует, это правило не
    должно - оно закрывает новые биржи, а не открытые сделки.
    """
    code = trade_exchange(exchange)
    if academy_confirmed(session, student, code):
        return True
    row = account_for(session, student.id, code)
    return bool(row and row.is_active)


# Сколько сделка может молчать, оставаясь живой.
#
# Сопровождение отмечает каждую сделку на обходе, а обход идёт каждые
# несколько секунд (`backend/trading/watcher.py`, `_touch`). Молчание дольше
# четверти часа значит, что до сделки никто не доходит: счёт биржи отключили,
# ключи протухли, запись осталась от старой позиции. Такая строка - брошенная,
# и держать из-за неё человека нельзя.
LIVE_SILENCE = timedelta(minutes=15)


def live_by_exchange(session, student_id: int, *, fresh_only: bool = False) -> dict[str, int]:
    """Сколько сделок терминала идёт на каждой бирже.

    Живая сделка - это выставленный на бирже стоп, цели и сопровождение на
    сервере. Пока она идёт, биржу нельзя ни отключить (некому вести), ни
    сменить активную.

    `fresh_only` оставляет только те, которые сопровождение видело недавно.
    Для отключения счёта это неверно - там важна любая запись, даже брошенная:
    ключ ещё может понадобиться, чтобы её закрыть. А вот держать смену биржи
    из-за записи, до которой никто не доходит, значит запереть человека
    навсегда.
    """
    counts: dict[str, int] = {}
    for trade in live_trades(session, student_id, fresh_only=fresh_only):
        code = (trade.exchange or "weex").strip().lower()
        counts[code] = counts.get(code, 0) + 1
    return counts


def live_trades(session, student_id: int, *, fresh_only: bool = False) -> list[LiveTrade]:
    """Сами записи, а не их число: отказ должен называть, что именно держит.

    «Идут сделки терминала (WEEX - 1)» не говорит человеку ничего: какая
    монета, вошла она или ещё ждёт лимитку - по этому тексту не понять, и
    искать нечего. Поэтому наружу отдаём записи, а счётчики считаем из них.
    """
    rows = session.execute(
        select(LiveTrade)
        .where(LiveTrade.student_id == student_id)
        .where(LiveTrade.status.in_(("waiting", "open")))
        .order_by(LiveTrade.id)
    ).scalars()
    edge = datetime.now(timezone.utc) - LIVE_SILENCE
    return [trade for trade in rows if not (fresh_only and _silent_since(trade) < edge)]


def _silent_since(trade: LiveTrade) -> datetime:
    """Когда сопровождение последний раз видело сделку."""
    seen = trade.updated_at or trade.created_at
    if seen is None:
        return datetime.now(timezone.utc)
    return seen if seen.tzinfo else seen.replace(tzinfo=timezone.utc)


def switch_refusal(session, student: Student, code: str) -> str:
    """Почему нельзя сделать эту биржу активной. Пусто - можно.

    Технически переключение идущей сделке не мешает: она ведётся и
    закрывается на своей бирже. Мешает оно человеку - позиция остаётся на
    одной бирже, а следующая заявка уходит на другую, и через минуту он не
    понимает, где торгует. Дешевле запретить, чем потом объяснять.

    Повторный выбор той же биржи переключением не считается: менять нечего.

    Держит любая живая сделка, на какой бы бирже она ни шла (решение
    владельца): счёт не меняют, пока по нему что-то открыто, и разбираться,
    какая именно биржа занята, человеку в этот момент некогда.

    Брошенные записи при этом не считаются - за ними никто не следит, и
    запирать из-за них нельзя (`live_by_exchange`, `fresh_only`).
    """
    if code == (student.active_exchange or "").strip().lower():
        return ""
    live = live_trades(session, student.id, fresh_only=True)
    if not live:
        return ""

    # Называем сделки поимённо: монету, биржу и состояние. Человек по этому
    # тексту идёт в терминал и закрывает то, что держит, а не гадает, откуда
    # взялась единица в скобках.
    parts = []
    for trade in live:
        where = (trade.exchange or "weex").strip().upper()
        state = "в позиции" if trade.status == "open" else "ждёт входа"
        parts.append(f"{where} {trade.symbol.upper()} ({state})")

    return (
        f"Идут сделки терминала: {', '.join(parts)}. Пока они открыты, биржу не "
        "сменить: закройте их или дождитесь цели."
    )


def access_kind(uid: str | None, confirmed: set[str]) -> str:
    """Как подключён счёт: `academy` или `own`.

    Номер счёта неизвестен - считаем своим: обещать скидку и кешбэк тому, чей
    счёт мы не опознали, нельзя.
    """
    clean = clean_uid(uid)
    return "academy" if clean and clean in confirmed else "own"
