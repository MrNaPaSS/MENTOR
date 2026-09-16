"""Перенос базы из SQLite в Postgres, таблица за таблицей.

Порядок и подводные камни описаны в `docs/architecture/database.md`, §4. Здесь
сделано ровно то, что там написано: схема на приёмнике, копия данных в порядке
внешних ключей, поправка последовательностей и сверка числа строк.

Ничего не выдумываем и не чиним по дороге: строки переносятся как есть. Правка
данных на переезде - это две разные ошибки в одном шаге, и разобрать потом,
какая из них чья, будет нечем.

Запуск из каталога проекта:

    python migrate_to_postgres.py --to postgresql+psycopg://user:pass@host/nmnh
    python migrate_to_postgres.py --to ... --apply

Без `--apply` только показывает, что будет перенесено. Источник по умолчанию -
`DATABASE_URL` из окружения.
"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import Integer, func, inspect as sa_inspect, select, text

# Адрес нынешней базы лежит в `.env`, как и у сервера: без этого скрипт просил
# бы `--from` там, где ответ уже записан рядом.
try:  # pragma: no cover - без python-dotenv просто читаем окружение
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from core.db import Base, make_engine

# Регистрация моделей: без импорта в метаданных нет ни одной таблицы.
from core import models  # noqa: F401

BATCH = 500


def row_count(conn, table) -> int:
    return int(conn.execute(select(func.count()).select_from(table)).scalar_one())


def copy_table(source, target, table, apply: bool, ready: set[str]) -> tuple[int, int]:
    """Перенести одну таблицу. Возвращает «сколько было» и «сколько стало».

    `ready` - таблицы, которые на приёмнике уже есть. В показе схему там никто
    не создавал, и считать строки в несуществующей таблице нечего: это ноль, а
    не ошибка.
    """
    with source.connect() as src:
        have = row_count(src, table)
        rows = [dict(row) for row in src.execute(select(table)).mappings()] if have else []

    already = 0
    if table.name in ready:
        with target.connect() as dst:
            already = row_count(dst, table)

    if not apply or not rows:
        return have, already

    with target.begin() as dst:
        for start in range(0, len(rows), BATCH):
            dst.execute(table.insert(), rows[start : start + BATCH])

    with target.connect() as dst:
        return have, row_count(dst, table)


def fix_sequences(target, tables) -> list[str]:
    """Продолжить нумерацию с последнего перенесённого ключа.

    После вставки с готовыми идентификаторами Postgres не знает, где
    продолжать, и первая же новая запись падает с «duplicate key».
    """
    if target.dialect.name != "postgresql":
        return []
    fixed: list[str] = []
    with target.begin() as conn:
        for table in tables:
            keys = [c for c in table.primary_key.columns if c.autoincrement is not False]
            if len(keys) != 1:
                continue
            # Только числовой ключ: у части таблиц он строка (`chart_shots`),
            # и последовательности за ним не стоит вовсе.
            if not isinstance(keys[0].type, Integer):
                continue
            name = keys[0].name
            conn.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence(:t, :c), "
                    "COALESCE((SELECT MAX(" + name + ") FROM " + table.name + "), 1))"
                ),
                {"t": table.name, "c": name},
            )
            fixed.append(table.name)
    return fixed


def migrate(
    source_url: str, target_url: str, apply: bool, only: str = "", sequences_only: bool = False
) -> int:
    source = make_engine(source_url)
    target = make_engine(target_url)

    tables = [t for t in Base.metadata.sorted_tables if not only or t.name == only]
    if not tables:
        print(f"Таблицы {only} нет в схеме")
        return 1

    # Доделать только нумерацию: данные уже перенесены, а шаг с
    # последовательностями оборвался. Повторять перенос ради него нельзя -
    # приёмник больше не пуст.
    if sequences_only:
        fixed = fix_sequences(target, tables)
        print(f"Последовательности продолжены: {len(fixed)} таблиц")
        return 0

    if apply:
        Base.metadata.create_all(target)

    print(f"Источник:  {source_url}")
    print(f"Приёмник:  {target_url}")
    print("Режим:     " + ("перенос" if apply else "только показать"))
    print()

    # Непустой приёмник проверяем до записи, а не после: перенос в базу, где
    # уже есть строки, кладёт наши ключи поверх чужих, и разбирать это потом
    # будет нечем.
    ready = set(sa_inspect(target).get_table_names())

    if apply:
        with target.connect() as dst:
            busy_now = [t.name for t in tables if t.name in ready and row_count(dst, t) > 0]
        if busy_now:
            print(
                "На приёмнике уже есть строки: "
                + ", ".join(busy_now)
                + ".\nПеренос делается в пустую базу: очистите её и повторите."
            )
            return 1

    busy: list[str] = []
    moved: list[tuple[str, int, int]] = []
    for table in tables:
        have, became = copy_table(source, target, table, apply, ready)
        if apply and became != have:
            busy.append(table.name)
        moved.append((table.name, have, became))

    width = max(len(name) for name, _, _ in moved)
    for name, have, became in moved:
        mark = "" if not apply or became == have else "  <-- расходится"
        print(f"{name.ljust(width)}  было {have:>7}  стало {became:>7}{mark}")

    if apply:
        fixed = fix_sequences(target, tables)
        if fixed:
            print(f"\nПоследовательности продолжены: {len(fixed)} таблиц")

    if busy:
        print(
            "\nЭти таблицы перенеслись не целиком: "
            + ", ".join(busy)
            + ".\nСверьте их вручную, прежде чем переключать сервер."
        )
        return 1

    if not apply:
        print("\nЭто был показ. Повторите с --apply, чтобы перенести.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Перенос базы из SQLite в Postgres")
    parser.add_argument("--from", dest="source", default=os.getenv("DATABASE_URL", ""))
    parser.add_argument("--to", dest="target", required=True)
    parser.add_argument("--only", default="", help="перенести одну таблицу")
    parser.add_argument("--apply", action="store_true", help="записать, а не показать")
    parser.add_argument(
        "--sequences",
        action="store_true",
        help="только продолжить нумерацию на приёмнике, данные не трогать",
    )
    args = parser.parse_args(argv)

    if not args.source:
        print("Источник не задан: --from или DATABASE_URL")
        return 2
    return migrate(args.source, args.target, args.apply, args.only, args.sequences)


if __name__ == "__main__":
    sys.exit(main())
