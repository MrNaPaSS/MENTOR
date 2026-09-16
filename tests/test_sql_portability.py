"""Запросы должны исполняться и на SQLite, и на Postgres.

Календарь аналитики считал день через `strftime` - функцию, которой в Postgres
нет вовсе. На переезде ручка отвечала 500: «function strftime does not exist».
"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql, sqlite

from core.db import DayKey, MonthKey
from core.models import SignalDelivery


def _sql(expression, dialect) -> str:
    return str(expression.compile(dialect=dialect))


def test_day_and_month_speak_the_language_of_the_database():
    day = DayKey(SignalDelivery.delivered_at)
    month = MonthKey(SignalDelivery.delivered_at)

    on_sqlite = _sql(day, sqlite.dialect())
    on_postgres = _sql(day, postgresql.dialect())
    assert "strftime" in on_sqlite
    assert "to_char" in on_postgres
    assert "strftime" not in on_postgres

    assert "strftime" in _sql(month, sqlite.dialect())
    assert "to_char" in _sql(month, postgresql.dialect())


def test_no_sqlite_only_functions_are_left_in_queries():
    """Сторож на будущее: `strftime` в запросах - это отказ на Postgres."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    guilty = []
    for folder in ("backend", "core", "bot"):
        for path in (root / folder).rglob("*.py"):
            text = path.read_text(encoding="utf-8", errors="ignore")
            if "func.strftime" in text and path.name != "db.py":
                guilty.append(str(path.relative_to(root)))
    assert guilty == []
