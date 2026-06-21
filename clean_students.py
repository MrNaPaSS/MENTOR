"""Массовая очистка учеников перед публичным запуском.

Удаляет ВСЕХ учеников, КРОМЕ указанных (по weex_uid и/или tg_id), вместе со
связанными записями (доставки сигналов, дневные снимки баланса, монеты-транзакции).

БЕЗОПАСНОСТЬ:
- По умолчанию это DRY-RUN: ничего не удаляет, только печатает, кого оставит и кого удалит.
- Реальное удаление — только с флагом --apply.
- Кого оставить — обязательно укажи хотя бы один --keep-uid или --keep-tg,
  иначе скрипт откажется работать (чтобы не снести всех случайно).

Запуск на проде (на удалённом столе, из папки проекта, с тем же .env):
    python clean_students.py --keep-uid 12345678            # посмотреть (dry-run)
    python clean_students.py --keep-uid 12345678 --apply    # выполнить
    python clean_students.py --keep-tg 111111111 --apply    # оставить по Telegram ID
Можно указывать несколько: --keep-uid A --keep-uid B --keep-tg C
"""

from __future__ import annotations

import argparse

from sqlalchemy import delete as sql_delete, select

from core.db import init_engine, SessionLocal
from core.models import BalanceSnapshot, CoinTransaction, SignalDelivery, Student


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-uid", action="append", default=[], help="weex_uid ученика, которого оставить")
    ap.add_argument("--keep-tg", action="append", default=[], help="tg_id ученика, которого оставить")
    ap.add_argument("--apply", action="store_true", help="реально удалить (без флага — только показать)")
    args = ap.parse_args()

    keep_uids = {str(u).strip() for u in args.keep_uid if str(u).strip()}
    keep_tgs = {str(t).strip() for t in args.keep_tg if str(t).strip()}

    if not keep_uids and not keep_tgs:
        print("[STOP] Не указан ни один --keep-uid / --keep-tg. Отказываюсь удалять всех. "
              "Укажи, кого оставить.")
        return

    init_engine()
    with SessionLocal() as session:
        students = session.execute(select(Student)).scalars().all()

        def is_kept(s: Student) -> bool:
            uid = (s.weex_uid or "").strip()
            tg = str(s.tg_id) if s.tg_id is not None else ""
            return uid in keep_uids or tg in keep_tgs

        kept = [s for s in students if is_kept(s)]
        to_delete = [s for s in students if not is_kept(s)]

        print(f"Всего учеников: {len(students)}")
        print(f"\n[KEEP] ОСТАВИТЬ ({len(kept)}):")
        for s in kept:
            print(f"   id={s.id} uid={s.weex_uid} tg={s.tg_id} @{s.username}")
        print(f"\n[DELETE] УДАЛИТЬ ({len(to_delete)}):")
        for s in to_delete:
            print(f"   id={s.id} uid={s.weex_uid} tg={s.tg_id} @{s.username}")

        if not kept:
            print("\n[STOP] Внимание: под условие 'оставить' не попал НИ ОДИН ученик. "
                  "Проверь --keep-uid/--keep-tg. Прерываю.")
            return

        if not to_delete:
            print("\nНечего удалять — выходим.")
            return

        if not args.apply:
            print("\n— DRY-RUN. Реального удаления не было. Добавь --apply, чтобы выполнить.")
            return

        ids = [s.id for s in to_delete]
        session.execute(sql_delete(SignalDelivery).where(SignalDelivery.student_id.in_(ids)))
        session.execute(sql_delete(BalanceSnapshot).where(BalanceSnapshot.student_id.in_(ids)))
        session.execute(sql_delete(CoinTransaction).where(CoinTransaction.student_id.in_(ids)))
        session.execute(sql_delete(Student).where(Student.id.in_(ids)))
        session.commit()
        print(f"\n[OK] Удалено учеников: {len(ids)}. Оставлено: {len(kept)}.")


if __name__ == "__main__":
    main()
