"""Что биржа знает об опознавателе ученика.

Пробник, а не тест. Ходит в живую партнёрскую программу настоящими ключами и
печатает, что она отвечает на UID в том виде, в каком он лежит в базе, и на
него же цифрами. По этим двум ответам видно, чей это отказ - наш или биржи.

Запуск из каталога проекта (нужен .env с ключами WEEX):

    python check_student_uid.py            # все ученики с UID
    python check_student_uid.py 26         # только этот ученик
    python check_student_uid.py PO6067083524   # или прямо опознаватель
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv(override=True)

from sqlalchemy import select  # noqa: E402

from core.db import SessionLocal  # noqa: E402
from core.models import Student  # noqa: E402
from core.weex.real import RealWeexClient  # noqa: E402
from core.weex.uid import clean_uid, looks_like_uid  # noqa: E402


def _client() -> RealWeexClient:
    return RealWeexClient(
        api_key=os.getenv("WEEX_API_KEY"),
        secret=os.getenv("WEEX_SECRET_KEY"),
        passphrase=os.getenv("WEEX_PASSPHRASE"),
        affiliate_key=os.getenv("WEEX_AFFILIATE_KEY"),
        affiliate_secret=os.getenv("WEEX_AFFILIATE_SECRET"),
        affiliate_passphrase=os.getenv("WEEX_AFFILIATE_PASSPHRASE"),
    )


def _targets(argument: str | None) -> list[tuple[str, str]]:
    """Кого проверяем: (кто, опознаватель как записан)."""
    if argument and not argument.isdigit():
        return [("ввод", argument)]

    with SessionLocal() as session:
        rows = session.execute(
            select(Student).where(Student.weex_uid.isnot(None))
        ).scalars().all()

    if argument and argument.isdigit():
        # Число - это либо номер ученика, либо сам опознаватель.
        by_id = [r for r in rows if str(r.id) == argument]
        if by_id:
            return [(f"ученик {r.id}", str(r.weex_uid)) for r in by_id]
        return [("ввод", argument)]

    return [(f"ученик {r.id}", str(r.weex_uid)) for r in rows]


async def main() -> None:
    argument = sys.argv[1] if len(sys.argv) > 1 else None
    targets = _targets(argument)
    if not targets:
        print("Некого проверять: учеников с UID нет.")
        return

    client = _client()

    # Кого партнёрская программа вообще видит за последние сутки: по этому
    # списку сверяется, есть ли ученик среди рефералов.
    now = int(time.time() * 1000)
    try:
        rows = await client.get_channel_trade_asset(now - 86_400_000, now, page=1)
    except Exception as exc:  # noqa: BLE001
        rows = []
        print(f"Выгрузка оборотов не пришла: {exc}")
    known = {clean_uid(row.get("uid")) for row in rows if clean_uid(row.get("uid"))}
    print(f"В суточной выгрузке партнёрки {len(known)} UID\n")

    for who, raw in targets:
        digits = clean_uid(raw)
        print(f"{who}: записано {raw!r} -> цифрами {digits!r}")
        if not looks_like_uid(raw):
            print("  на опознаватель не похоже, биржу не спрашиваем\n")
            continue

        assets = await client.get_agency_assert(digits)
        print(f"  getAssert: {assets if assets else 'пусто (биржа отказала)'}")
        print(f"  в выгрузке оборотов: {'да' if digits in known else 'нет'}\n")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
