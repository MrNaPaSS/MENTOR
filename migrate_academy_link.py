"""Миграция: учёт входов учеников + защита монет от двойного начисления.

Что делает:
  1. Добавляет в ``students`` колонки created_via, first_login_at,
     last_login_at, login_count.
  2. Убирает дубли в ``coin_transactions`` по паре (student_id, ref),
     оставляя самую раннюю запись, и вешает на пару уникальный индекс.

Запуск:  python migrate_academy_link.py

Скрипт идемпотентен — повторный запуск ничего не сломает. Работает и на
SQLite, и на PostgreSQL: адрес базы берётся из DATABASE_URL, как у приложения.
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import inspect, text

from core.db import make_engine


NEW_COLUMNS = {
    "created_via": "VARCHAR(16) DEFAULT 'bot'",
    "first_login_at": "TIMESTAMP",
    "last_login_at": "TIMESTAMP",
    "login_count": "INTEGER DEFAULT 0",
}


def add_missing_columns(conn, inspector) -> list[str]:
    existing = {c["name"] for c in inspector.get_columns("students")}
    added: list[str] = []
    for name, ddl in NEW_COLUMNS.items():
        if name in existing:
            continue
        conn.execute(text(f"ALTER TABLE students ADD COLUMN {name} {ddl}"))
        added.append(name)
    return added


def dedupe_coin_transactions(conn) -> int:
    """Оставить по одной записи на пару (student_id, ref) — самую раннюю.

    Дубли могли появиться до уникального индекса: /coins/sync проверял наличие
    ref в Python, и два параллельных запроса проходили проверку одновременно.
    """
    rows = conn.execute(text("""
        SELECT student_id, ref, COUNT(*) AS n
        FROM coin_transactions
        GROUP BY student_id, ref
        HAVING COUNT(*) > 1
    """)).fetchall()

    removed = 0
    for student_id, ref, _ in rows:
        keep = conn.execute(
            text("""
                SELECT id FROM coin_transactions
                WHERE student_id = :sid AND ref = :ref
                ORDER BY created_at, id
                LIMIT 1
            """),
            {"sid": student_id, "ref": ref},
        ).scalar()
        result = conn.execute(
            text("""
                DELETE FROM coin_transactions
                WHERE student_id = :sid AND ref = :ref AND id <> :keep
            """),
            {"sid": student_id, "ref": ref, "keep": keep},
        )
        removed += result.rowcount or 0

    # Баланс в students.coins пересчитываем по факту — иначе он останется
    # завышенным на сумму удалённых дублей.
    if removed:
        conn.execute(text("""
            UPDATE students SET coins = COALESCE((
                SELECT SUM(amount) FROM coin_transactions
                WHERE coin_transactions.student_id = students.id
            ), 0)
        """))
    return removed


def create_unique_index(conn, inspector) -> bool:
    names = {ix["name"] for ix in inspector.get_indexes("coin_transactions")}
    if "uq_coin_tx_student_ref" in names:
        return False
    conn.execute(text(
        "CREATE UNIQUE INDEX uq_coin_tx_student_ref "
        "ON coin_transactions (student_id, ref)"
    ))
    return True


def main() -> int:
    url = os.getenv("DATABASE_URL", "sqlite:///nmnh_dev.sqlite3")
    print(f"База: {url}")
    engine = make_engine(url)

    with engine.begin() as conn:
        inspector = inspect(conn)
        if "students" not in inspector.get_table_names():
            print("Таблицы students нет — база пустая, миграция не нужна.")
            return 0

        added = add_missing_columns(conn, inspector)
        print(f"Колонки добавлены: {', '.join(added) if added else 'уже были'}")

        removed = dedupe_coin_transactions(conn)
        print(f"Дублей начислений удалено: {removed}")

        # Индексы читаем заново: состав таблицы мог измениться выше.
        created = create_unique_index(conn, inspect(conn))
        print(f"Уникальный индекс: {'создан' if created else 'уже был'}")

    print("Готово.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
