"""Баланс ученика по его собственным ключам биржи.

Пока ключей нет, баланс известен только по UID: партнёрская ручка отдаёт то,
что WEEX показывает наставнику про его реферала. Это оценка со стороны - она
приходит с задержкой и обновляется не тогда, когда ученик торгует, а тогда,
когда до неё дойдёт сборщик.

Ключи ученика дают ту же цифру, что он видит у себя в приложении биржи, и
спрашивать после них кого-то ещё незачем. Поэтому порядок такой: есть ключи -
баланс по ключам; нет - по UID, как и раньше.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select

from core.models import Student, WeexCredential
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures

logger = logging.getLogger("nmnh.trading")

# Имена, под которыми биржа кладёт остаток. Разные ручки называют его
# по-разному, а ошибиться здесь значит показать ученику ноль на живом счёте.
_AMOUNT_FIELDS = (
    "availableBalance",
    "available",
    "balance",
    "usdtEquity",
    "accountEquity",
    "equity",
)


def usdt_from(payload: Any) -> Decimal | None:
    """Остаток в USDT из ответа биржи. `None` - разобрать не вышло.

    Приходит то списком монет, то одним объектом: разбираем так же, как это
    делает окно подключения ключей в терминале.
    """
    rows = payload if isinstance(payload, list) else [payload]
    for row in rows:
        if not isinstance(row, dict):
            continue
        coin = str(
            row.get("marginCoin") or row.get("asset") or row.get("coin") or "USDT"
        ).upper()
        if coin != "USDT":
            continue
        for name in _AMOUNT_FIELDS:
            if name not in row:
                continue
            try:
                value = Decimal(str(row[name]))
            except (InvalidOperation, TypeError, ValueError):
                continue
            if value >= 0:
                return value
    return None


def has_keys(session, student: Student) -> bool:
    """Подключены ли у ученика рабочие ключи биржи."""
    if not keystore.enabled():
        return False
    row = session.execute(
        select(WeexCredential).where(WeexCredential.student_id == student.id)
    ).scalar_one_or_none()
    return row is not None and bool(row.is_active)


async def balance_by_keys(session, student: Student) -> Decimal | None:
    """Баланс по ключам ученика. `None` - ключей нет или биржа не ответила.

    Молчим отказом, а не исключением: баланс - это цифра в углу экрана, и
    ронять из-за неё профиль нельзя. Причина уходит в журнал сервера.
    """
    if not keystore.enabled():
        return None
    row = session.execute(
        select(WeexCredential).where(WeexCredential.student_id == student.id)
    ).scalar_one_or_none()
    if row is None or not row.is_active:
        return None

    # Импорт внутри: сессию с проверкой сертификата держит торговый роутер, а он
    # тянет за собой FastAPI. На уровне модуля это связало бы сборщик балансов с
    # веб-частью без нужды.
    from backend.api.trading import _get_session

    try:
        client = WeexFutures(
            Credentials(
                api_key=keystore.decrypt(row.api_key_enc),
                secret_key=keystore.decrypt(row.secret_enc),
                passphrase=keystore.decrypt(row.passphrase_enc),
            ),
            _get_session,
        )
        return usdt_from(await client.balance())
    except Exception as exc:  # noqa: BLE001 - причина в журнале, баланс не критичен
        logger.warning("Баланс по ключам ученика %s не получен: %s", student.id, exc)
        return None


# Сколько исполнений просим у биржи за раз. Больше сотни она отдаёт не всегда,
# поэтому при отказе пробуем сотню - лучше неполный отчёт, чем никакого.
_FILLS_WANTED = 500
_FILLS_FALLBACK = 100

# Имена полей исполнения: цена, объём и время. У каждой биржи свои, а по ним
# считается оборот, который потом видит ученик в календаре.
_PRICE_FIELDS = ("price", "fillPrice", "avgPrice", "dealPrice")
_SIZE_FIELDS = ("qty", "size", "amount", "fillQty", "dealSize", "baseVolume")
_TIME_FIELDS = ("time", "ctime", "cTime", "createTime", "timestamp", "ts", "fillTime")


def _first(row: dict[str, Any], names: tuple[str, ...]) -> float | None:
    for name in names:
        value = row.get(name)
        if value in (None, ""):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def turnover_on(fills: list[dict[str, Any]], day: str) -> float:
    """Оборот за календарный день по исполнениям: сумма цены на объём.

    День задаётся строкой `ГГГГ-ММ-ДД` в UTC - в ней же сборщик хранит снимки.
    """
    from datetime import datetime, timezone

    total = 0.0
    for row in fills:
        at = _first(row, _TIME_FIELDS)
        price = _first(row, _PRICE_FIELDS)
        size = _first(row, _SIZE_FIELDS)
        if not at or not price or not size:
            continue
        # Время приходит в миллисекундах: секунды дали бы 1970 год и день мимо.
        when = datetime.fromtimestamp(at / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        if when == day:
            total += abs(price) * abs(size)
    return total


async def futures_volume_by_keys(
    session, student: Student, day: str
) -> tuple[float, bool] | None:
    """Оборот фьючерсов за день по ключам ученика.

    Возвращает оборот и признак того, что отчёт полон. `None` - ключей нет или
    биржа не ответила.

    Про полноту отдельно. Лента исполнений приходит пачкой последних сделок, и
    диапазона дат у неё нет: если пачка пришла целиком заполненной, за её краем
    могли остаться сделки того же дня. Такой оборот занижен, и выдавать его за
    точный нельзя - в календаре это цифра, по которой ученик судит о своей
    работе. Решение, что с этим делать, принимает вызывающий: у него есть
    партнёрская ручка по UID, а она считает оборот целиком.

    Спота здесь нет вовсе: ключи заведены под фьючерсы, и другого счёта этот
    клиент не видит.
    """
    if not keystore.enabled():
        return None
    row = session.execute(
        select(WeexCredential).where(WeexCredential.student_id == student.id)
    ).scalar_one_or_none()
    if row is None or not row.is_active:
        return None

    from backend.api.trading import _get_session

    try:
        client = WeexFutures(
            Credentials(
                api_key=keystore.decrypt(row.api_key_enc),
                secret_key=keystore.decrypt(row.secret_enc),
                passphrase=keystore.decrypt(row.passphrase_enc),
            ),
            _get_session,
        )
        wanted = _FILLS_WANTED
        try:
            fills = await client.user_trades(limit=wanted)
        except Exception:  # noqa: BLE001 - сотня точно поддерживается
            wanted = _FILLS_FALLBACK
            fills = await client.user_trades(limit=wanted)
    except Exception as exc:  # noqa: BLE001 - причина в журнале, оборот не критичен
        logger.warning("Оборот по ключам ученика %s не получен: %s", student.id, exc)
        return None

    whole = len(fills) < wanted
    return turnover_on(fills, day), whole


# Оборот по журналу терминала.
#
# Биржа считает оборот сама, но добраться до её цифры удаётся не всегда: лента
# исполнений приходит без диапазона дат, а партнёрская ручка знает только тех,
# у кого заведён UID. У ученика без UID и с молчащими ключами оборот оставался
# нулём, и вместе с ним обнулялось всё, что на него опирается: дни торговли,
# стрик активности, объём месяца и путь трейдера.
#
# Журнал знает про закрытые сделки всё: сколько взяли и по какой цене вошли и
# вышли. Это не заменяет отчёт биржи - в журнал попадает только то, что вёл
# терминал, - но своё считает точно и не зависит ни от чьего ответа.


def trade_volume(qty: float, entry: float, exit_price: float | None) -> float:
    """Оборот одной сделки: вход плюс выход.

    Обе ноги, а не одна: биржа считает оборотом каждое исполнение, а круг из
    входа и выхода - это два исполнения. Выхода может не быть, если отчёт по
    сделке ещё не пришёл, - тогда считаем то, что известно.
    """
    if qty <= 0:
        return 0.0
    turn = qty * entry
    if exit_price:
        turn += qty * exit_price
    return turn
