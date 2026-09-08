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
