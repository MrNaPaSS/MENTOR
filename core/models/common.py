"""Общее для всех моделей: тип ключа, время, суммы в минимальных единицах.

Вынесено из `core/models/__init__.py` не ради порядка, а ради импорта: схему
подписки держит отдельный файл (`subscription.py`), и он не может брать эти
вещи из `__init__`, который сам его и подключает - импорт пошёл бы по кругу.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, Integer

# BigInteger PK, который на SQLite становится INTEGER (иначе нет автоинкремента).
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    """Время строкой, всегда с меткой пояса.

    Колонки объявлены `DateTime(timezone=True)`, но SQLite пояс не хранит и
    отдаёт время голым. Голую строку браузер читает как своё местное: событие,
    случившееся минуту назад, показывается на два часа раньше - ровно на
    разницу с UTC, - и «зашёл только что» превращается в «2 часа назад».

    С PostgreSQL метка приходит сама, и эта проверка ничего не меняет.
    """
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
