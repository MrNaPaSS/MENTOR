"""Кому какие биржи открыты - и почему именно такой ответ.

Биржа появляется в настройках ученика только после того, как академия
подтвердила его счёт на ней (`backend/trading/accounts.py`, `may_connect`). У
правила два исключения: WEEX у тех, кто через неё и пришёл (их номер лежит в
записи ученика), и уже подключённый счёт.

Этот пробник печатает картину по базе: сколько подтверждений по каждой бирже,
скольким ученикам какая биржа открыта и у кого счёт уже подключён. Нужен, чтобы
не гадать после обновления сервера, что увидят люди.

Ничего не меняет - только читает.

    python check_exchange_access.py          # сводка по биржам
    python check_exchange_access.py --кто    # и построчно по ученикам
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

from sqlalchemy import select  # noqa: E402

from backend.trading.accounts import may_connect  # noqa: E402
from core.db import SessionLocal, init_engine  # noqa: E402
from core.exchanges import KEY_EXCHANGES  # noqa: E402
from core.models import AcademyUid, ExchangeAccount, Student  # noqa: E402


def main() -> int:
    by_name = "--кто" in sys.argv or "--who" in sys.argv
    # Адрес базы - из окружения, как у сервера: смотрим ровно ту базу, с
    # которой он и работает.
    init_engine()

    with SessionLocal() as session:
        students = session.execute(select(Student)).scalars().all()
        uids = session.execute(select(AcademyUid)).scalars().all()
        accounts = session.execute(select(ExchangeAccount)).scalars().all()

        print(f"\nучеников в базе: {len(students)}")

        print("\n── подтверждения академии ─────────────────────────────────────")
        if not uids:
            print("  ни одного: academy_uids пуста")
        for code in sorted({row.exchange for row in uids}):
            rows = [row for row in uids if row.exchange == code]
            people = len({row.student_id for row in rows})
            print(f"  {code:<8} счетов {len(rows):<4} у {people} учеников")

        print("\n── подключённые счета ─────────────────────────────────────────")
        if not accounts:
            print("  ни одного")
        for code in sorted({row.exchange for row in accounts}):
            rows = [row for row in accounts if row.exchange == code]
            live = [row for row in rows if row.is_active]
            print(f"  {code:<8} записей {len(rows):<4} из них подключено {len(live)}")

        print("\n── кому какая биржа открыта ───────────────────────────────────")
        opened: dict[str, int] = {code: 0 for code in KEY_EXCHANGES}
        only_weex = 0
        nothing = 0
        for student in students:
            mine = [code for code in KEY_EXCHANGES if may_connect(session, student, code)]
            for code in mine:
                opened[code] += 1
            if mine == ["weex"]:
                only_weex += 1
            if not mine:
                nothing += 1
            if by_name:
                who = student.card_name or student.username or f"#{student.id}"
                print(f"  {who:<24} {', '.join(mine) if mine else 'ничего'}")

        for code in KEY_EXCHANGES:
            print(f"  {code:<8} открыта {opened[code]} ученикам")
        print(f"\n  только WEEX: {only_weex}")
        print(f"  ни одной биржи: {nothing}")

        if nothing:
            print(
                "\n  Ученики без единой биржи - это те, у кого нет ни WEEX-UID, ни\n"
                "  подтверждений академии. Им терминал торговать не даст, и это\n"
                "  правило, а не поломка: счёт называют в боте академии."
            )

        closed = [code for code in KEY_EXCHANGES if not opened[code]]
        if closed:
            print(
                f"\n  Никому не открыты: {', '.join(closed)}.\n"
                "  Значит по этим биржам академия ещё не присылала подтверждений -\n"
                "  адаптер готов, а счетов, которые он мог бы вести, пока нет."
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
