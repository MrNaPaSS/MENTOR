"""Свести две записи одного ученика в одну.

Записи разошлись по одной причине: бот академии до переделки приписывал к
номеру счёта «PO», а платформа искала ученика точным совпадением строки. Тот же
человек приходил вторым номером - и получал второй кабинет: пустую историю,
свои монеты и отдельный журнал. Причина закрыта (`backend/api/coins.py`,
`find_or_create_student` ищет по всем написаниям), но разошедшееся надо свести
руками - само оно не срастётся.

Кто остаётся: запись с Telegram. Через него человек входит в кабинет, и
оставить надо ту, которой он пользуется. Обе с Telegram - это не дубль, а два
разных человека с одним номером счёта: такое сводить нельзя, и скрипт их только
покажет.

Что переносится: всё, что помечено учеником, - сделки, журнал, монеты, награды,
счета бирж, подтверждения академии, сообщения чата, сертификаты, начисления
кешбэка. Там, где на ученика может быть только одна строка (рабочее место,
ключи), лишняя удаляется: у целевой записи она уже своя.

Запуск из каталога проекта. Сперва **сухой прогон** - он ничего не меняет:

    python merge_students.py                # что будет сделано
    python merge_students.py --apply        # сделать

Перед `--apply` скопируйте файл базы: `copy nmnh.sqlite3 nmnh.sqlite3.bak`.
"""

from __future__ import annotations

import sys
from collections import defaultdict

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - старый поток, обойдёмся как есть
    pass

from sqlalchemy import select, text  # noqa: E402

from core.db import SessionLocal, get_engine, init_engine  # noqa: E402
from core.models import Student  # noqa: E402
from core.weex.uid import clean_uid  # noqa: E402

# Куда смотреть, чтобы ничего не забыть: таблица и её столбец с учеником.
#
# Список не собирается из моделей на лету намеренно: перенос чужой истории в
# чужой кабинет - не то место, где уместна догадливость. Новая таблица с
# `student_id` должна попасть сюда руками, и это видно в обзоре кода.
MOVE = (
    "signal_deliveries",
    "broadcast_reactions",
    "broadcast_comments",
    "balance_snapshots",
    "coin_transactions",
    "shop_orders",
    "scalp_trades",
    "chat_messages",
    "exchange_accounts",
    "academy_uids",
    "live_trades",
    "entitlements",
    "journal_exports",
    "certificates",
    "cashback_accruals",
)

# По строке на ученика: переносить нечего, лишнюю убираем.
DROP_IF_TAKEN = ("scalp_workspaces", "weex_credentials")

# Где у таблицы есть уникальность вместе с учеником - и чем она задана.
#
# Перенести строку поверх занятой пары нельзя: база откажет, и вместе с ней
# упадёт всё сведение. Поэтому такие строки у лишней записи сначала удаляются -
# у целевой они уже есть, и это те же самые данные: то же начисление, тот же
# счёт биржи, то же право на инструмент.
CONFLICT_KEYS = {
    "signal_deliveries": ("signal_id",),
    "broadcast_reactions": ("broadcast_id", "kind"),
    "balance_snapshots": ("date",),
    "coin_transactions": ("ref",),
    "scalp_trades": ("client_id",),
    "exchange_accounts": ("exchange",),
    "academy_uids": ("exchange", "uid"),
    "live_trades": ("client_id",),
    "entitlements": ("feature",),
    "certificates": ("level",),
}


def pairs(session) -> list[tuple[Student, Student]]:
    """Пары «лишняя запись - та, что остаётся». Обе с Telegram не сводим."""
    by_uid: dict[str, list[Student]] = defaultdict(list)
    for one in session.execute(select(Student)).scalars():
        digits = clean_uid(one.weex_uid)
        if digits:
            by_uid[digits].append(one)

    out: list[tuple[Student, Student]] = []
    for uid, rows in sorted(by_uid.items()):
        if len(rows) < 2:
            continue
        with_tg = [r for r in rows if r.tg_id is not None]
        without = [r for r in rows if r.tg_id is None]
        if len(with_tg) > 1:
            who = ", ".join(f"id={r.id} tg={r.tg_id} @{r.username or '-'}" for r in with_tg)
            print(f"  ! {uid}: два кабинета с Telegram - {who}")
            print("    Свести нельзя: это либо два человека на одном счёте, либо")
            print("    два Telegram у одного. Разбирать руками.")
            continue
        if not with_tg:
            print(f"  ! {uid}: ни у одной записи нет Telegram - сводить некуда")
            continue
        keep = with_tg[0]
        for extra in without:
            out.append((extra, keep))
    return out


def count_rows(session, table: str, student_id: int) -> int:
    return session.execute(
        text(f"SELECT COUNT(*) FROM {table} WHERE student_id = :sid"), {"sid": student_id}
    ).scalar_one()


def merge(session, extra: Student, keep: Student, apply: bool) -> None:
    print(f"\n{extra.weex_uid} : id={extra.id} -> id={keep.id} (tg={keep.tg_id})")
    tables = set(existing_tables(session))

    for table in MOVE:
        if table not in tables:
            continue
        rows = count_rows(session, table, extra.id)
        if not rows:
            continue
        print(f"  {table}: переносим {rows}")
        if apply:
            drop_taken(session, table, extra.id, keep.id)
            session.execute(
                text(f"UPDATE {table} SET student_id = :keep WHERE student_id = :extra"),
                {"keep": keep.id, "extra": extra.id},
            )

    for table in DROP_IF_TAKEN:
        if table not in tables:
            continue
        rows = count_rows(session, table, extra.id)
        if not rows:
            continue
        mine = count_rows(session, table, keep.id)
        if mine:
            print(f"  {table}: удаляем лишнюю строку ({rows})")
            if apply:
                session.execute(
                    text(f"DELETE FROM {table} WHERE student_id = :sid"), {"sid": extra.id}
                )
        else:
            print(f"  {table}: переносим {rows}")
            if apply:
                session.execute(
                    text(f"UPDATE {table} SET student_id = :keep WHERE student_id = :extra"),
                    {"keep": keep.id, "extra": extra.id},
                )

    # Номер счёта у целевой записи мог быть записан иначе - оставляем как есть:
    # найдётся он теперь по любому написанию.
    print(f"  students: удаляем запись id={extra.id}")
    if apply:
        session.execute(text("DELETE FROM students WHERE id = :sid"), {"sid": extra.id})
        # Переносим строки запросами, минуя ORM: она о них не знает и держит в
        # памяти уже удалённую запись. Забываем всё, что помним, - следующий
        # вопрос уйдёт в базу.
        session.expire_all()


def drop_taken(session, table: str, extra_id: int, keep_id: int) -> None:
    """Убрать у лишней записи то, что у целевой уже занято уникальной парой."""
    keys = CONFLICT_KEYS.get(table)
    if not keys:
        return
    same = " AND ".join(f"other.{key} = {table}.{key}" for key in keys)
    removed = session.execute(
        text(
            f"DELETE FROM {table} WHERE student_id = :extra AND EXISTS ("
            f"SELECT 1 FROM {table} AS other WHERE other.student_id = :keep AND {same})"
        ),
        {"extra": extra_id, "keep": keep_id},
    ).rowcount
    if removed:
        print(f"    из них {removed} уже есть у целевой записи - убираем")


def existing_tables(session) -> list[str]:
    from sqlalchemy import inspect

    return inspect(session.get_bind()).get_table_names()


def main() -> int:
    apply = "--apply" in sys.argv
    init_engine()
    get_engine()

    with SessionLocal() as session:
        print("Ищем разошедшиеся записи одного ученика...")
        found = pairs(session)
        if not found:
            print("Сводить нечего.")
            return 0

        for extra, keep in found:
            merge(session, extra, keep, apply)

        if apply:
            session.commit()
            print(f"\nСведено пар: {len(found)}. Проверьте: python check_student_links.py")
        else:
            session.rollback()
            print(f"\nСухой прогон. Пар к сведению: {len(found)}.")
            print("Скопируйте базу и запустите с --apply, чтобы применить.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
