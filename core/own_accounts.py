"""Счета, подключённые без партнёрской программы.

Обычно в терминал попадают рефералы академии, и сервер узнаёт их по
партнёрскому отчёту биржи. Некоторым владелец открывает доступ руками: счёт
заведён не по ссылке академии, работает по своим API-ключам, и в партнёрском
отчёте его нет и не будет. Сборщик баланса каждый час искал такой UID в отчёте,
не находил и писал предупреждение - о том, что так и задумано.

Список по умолчанию здесь; переменная OWN_ACCOUNT_UIDS (через запятую) его
заменяет целиком, пустая строка - счетов без партнёрки нет.
"""

from __future__ import annotations

import os

from core.weex.uid import clean_uid

DEFAULT_OWN_ACCOUNT_UIDS = ("9100443713", "6067083524")


def own_account_uids() -> frozenset[str]:
    """UID счетов без партнёрки - цифрами, без префиксов."""
    raw = os.getenv("OWN_ACCOUNT_UIDS")
    items = DEFAULT_OWN_ACCOUNT_UIDS if raw is None else raw.split(",")
    return frozenset(uid for uid in (clean_uid(item) for item in items) if uid)


def is_own_account(uid: str | int | None) -> bool:
    """Счёт подключён без партнёрки: искать его в партнёрском отчёте незачем."""
    clean = clean_uid(uid)
    return bool(clean) and clean in own_account_uids()
