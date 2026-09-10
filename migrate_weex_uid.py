"""Привести опознаватели учеников к цифрам.

UID у WEEX - число, но в базу он попадал так, как его скопировал ученик: с
буквенным префиксом из приложения биржи, с пробелом, с дефисами. Ученик №26 с
записью ``PO6067083524`` остался без баланса и оборота: партнёрская ручка
отвечала на такой ``userId`` отказом, а в выгрузке оборотов он лежит числом.

Код теперь чистит опознаватель на входе и ищет ученика в любом написании, так
что и без этой чистки всё работает. Но пока в базе лежат две записи одного
формата и разного вида, отчёты сверять неудобно - этот скрипт наводит порядок.

Запуск из каталога проекта:

    python migrate_weex_uid.py           # только показать, что изменится
    python migrate_weex_uid.py --apply   # записать
"""

from __future__ import annotations

import sys

from sqlalchemy import select

from core.db import SessionLocal
from core.models import Student
from core.weex.uid import clean_uid


def main() -> None:
    apply = "--apply" in sys.argv

    with SessionLocal() as session:
        students = session.execute(
            select(Student).where(Student.weex_uid.isnot(None))
        ).scalars().all()

        # Кто уже занимает чистое написание: сливать двух учеников в один
        # опознаватель нельзя - это разные люди с разными счетами.
        taken = {str(s.weex_uid): s.id for s in students}

        changed = 0
        for student in students:
            raw = str(student.weex_uid)
            digits = clean_uid(raw)

            if not digits:
                print(f"ученик {student.id}: {raw!r} - цифр нет вовсе, пропускаем")
                continue
            if digits == raw:
                continue

            owner = taken.get(digits)
            if owner is not None and owner != student.id:
                print(
                    f"ученик {student.id}: {raw!r} -> {digits!r} занято учеником "
                    f"{owner}, пропускаем - разбирать руками"
                )
                continue

            print(f"ученик {student.id}: {raw!r} -> {digits!r}")
            changed += 1
            if apply:
                student.weex_uid = digits
                taken[digits] = student.id

        if apply:
            session.commit()
            print(f"\nЗаписано: {changed}")
        else:
            print(f"\nИзменится записей: {changed}. Для записи запустите с --apply")


if __name__ == "__main__":
    main()
