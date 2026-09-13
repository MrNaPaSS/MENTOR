"""Не склеились ли записи учеников: один человек - один кабинет.

Пробник, а не тест. Ничего не чинит и никуда не ходит: читает базу и печатает
места, где связка «Telegram - счёт на бирже» выглядит неправдой.

Повод завести его - вопрос от команды бота академии: не могло ли выйти так, что
чей-то Telegram оказался привязан к чужому счёту. По коду такого пути нет
(поиск по пустому номеру ничего не находит, а ручка выдачи пароля пустой номер
вовсе не принимала), но «по коду нет» и «в базе нет» - разные утверждения, и
второе проверяется только так.

Что ищем:

* **один счёт у двух учеников** - самое дорогое: кешбэк и ребейт считаются по
  номеру счёта, и две записи на один номер означают, что деньги уйдут не тому;
* **пустая строка вместо пустоты** в номере счёта: искать по ней нельзя, и
  запись с ней ведёт себя не как «номера нет», а как «номер такой»;
* **счёт биржи, которого академия не подтверждала**, помеченный как заведённый
  через академию, и наоборот - подтверждённый, но помеченный своим;
* **ученики без Telegram**: паролем от бота они не войдут.

Запуск из каталога проекта:

    python check_student_links.py
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict

# Консоль Windows по умолчанию не в UTF-8, и русский вывод превращается в кашу
# ровно тогда, когда его читают - при разборе находок.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - старый поток, обойдёмся как есть
    pass

from dotenv import load_dotenv

load_dotenv(override=True)

from sqlalchemy import select  # noqa: E402

from core.db import SessionLocal, init_engine  # noqa: E402
from core.models import AcademyUid, ExchangeAccount, Student  # noqa: E402
from core.weex.uid import clean_uid  # noqa: E402


def main() -> int:
    init_engine()
    problems = 0
    with SessionLocal() as session:
        students = list(session.execute(select(Student)).scalars())
        accounts = list(session.execute(select(ExchangeAccount)).scalars())
        confirmed: dict[tuple[int, str], set[str]] = defaultdict(set)
        for row in session.execute(select(AcademyUid)).scalars():
            confirmed[(row.student_id, row.exchange)].add(clean_uid(row.uid))

    print(f"Учеников: {len(students)}, счетов на биржах: {len(accounts)}")

    # ── один счёт у двух учеников ───────────────────────────────────────────
    by_uid: dict[str, list[Student]] = defaultdict(list)
    for one in students:
        digits = clean_uid(one.weex_uid)
        if digits:
            by_uid[digits].append(one)
    shared = {uid: rows for uid, rows in by_uid.items() if len(rows) > 1}
    if shared:
        problems += len(shared)
        print("\nОдин номер счёта у нескольких учеников:")
        for uid, rows in sorted(shared.items()):
            who = ", ".join(f"id={s.id} tg={s.tg_id} @{s.username or '-'}" for s in rows)
            print(f"  {uid}: {who}")
    else:
        print("Одинаковых номеров счёта у разных учеников нет.")

    # ── пустая строка вместо пустоты ────────────────────────────────────────
    blanks = [s for s in students if s.weex_uid is not None and not s.weex_uid.strip()]
    if blanks:
        problems += len(blanks)
        print("\nНомер счёта записан пустой строкой (должно быть пусто):")
        for one in blanks:
            print(f"  id={one.id} tg={one.tg_id} @{one.username or '-'}")

    # ── счета бирж против подтверждений академии ────────────────────────────
    wrong = []
    for row in accounts:
        uids = confirmed.get((row.student_id, row.exchange), set())
        digits = clean_uid(row.exchange_uid)
        should = "academy" if digits and digits in uids else "own"
        if (row.access or "own") != should:
            wrong.append((row, should))
    if wrong:
        problems += len(wrong)
        print("\nОтметка доступа расходится с подтверждениями академии:")
        for row, should in wrong:
            print(
                f"  ученик {row.student_id}, {row.exchange}: счёт {row.exchange_uid or '-'}"
                f" помечен {row.access!r}, а должен {should!r}"
            )
    else:
        print("Отметки доступа совпадают с подтверждениями академии.")

    # ── ученики без Telegram ────────────────────────────────────────────────
    no_tg = [s for s in students if s.tg_id is None]
    if no_tg:
        print(f"\nУчеников без Telegram: {len(no_tg)} - паролем от бота они не войдут.")
        for one in no_tg[:20]:
            print(f"  id={one.id} счёт {one.weex_uid or '-'} @{one.username or '-'}")
        if len(no_tg) > 20:
            print(f"  ... и ещё {len(no_tg) - 20}")

    print(f"\nБаза: {os.getenv('DATABASE_URL', 'sqlite:///nmnh_dev.sqlite3')}")
    print("Находок, требующих внимания:", problems)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
