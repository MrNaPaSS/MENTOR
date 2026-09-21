"""Плата за финансирование: что биржа говорит о ней по открытой позиции.

Зачем. Журнал сходился с биржей на коротких сделках и расходился на долгих.
Разбор сделки TAOUSDT 19-21 сентября показал разницу 25.24 при результате
1287.80 и комиссии 47.38 - то есть ни в расчёте, ни в комиссии её нет. Позиция
висела 34 часа, расчёт финансирования идёт каждые четыре, и на списание выходит
2.9 USDT, или 0.0039% от позиции: это ровно тот порядок, в котором биржи и
берут плату за финансирование.

Во всём торговом коде её нет: поля `cumFundingFee`, `cumOpenFee` и
`cumCloseFee` встречаются только в тестах. Прежде чем вычитать её из результата
сделки, надо увидеть своими глазами, как биржа её называет и с каким знаком
отдаёт, - на закрытой позиции не спросишь, она исчезает вместе с позицией.

Пробник печатает открытые позиции учеников целиком, всеми полями как есть.
Ничего не меняет и никуда не пишет - только читает.

    python check_funding.py            # все ученики с подключёнными ключами
    python check_funding.py 26         # только ученик с этим номером

Запускать там же, где работает сервер, и с тем же `.env`: без
`WEEX_KEYS_SECRET` ключи учеников не расшифровать.
"""

from __future__ import annotations

import asyncio
import ssl
import sys

import aiohttp
import certifi
from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - на старой консоли останется как было
    pass

from sqlalchemy import select  # noqa: E402

from backend.trading.accounts import client_for  # noqa: E402
from core.db import SessionLocal, init_engine  # noqa: E402
from core.models import ExchangeAccount  # noqa: E402
from core.weex import keys as keystore  # noqa: E402

# Поля, ради которых всё затевалось: удержанное биржей по позиции.
MONEY_FIELDS = (
    "cumFundingFee",
    "cumOpenFee",
    "cumCloseFee",
    "cumOpenValue",
    "cumOpenSize",
    "cumCloseValue",
    "cumCloseSize",
    "unrealizePnl",
    "size",
    "leverage",
    "side",
)


async def main() -> int:
    only = _student_from_args()

    init_engine()
    session = SessionLocal()
    try:
        if not keystore.enabled():
            print("WEEX_KEYS_SECRET не задан - ключи учеников не расшифровать.")
            print("Запускать нужно там же, где работает бекенд, и с тем же .env.")
            return 1

        query = select(ExchangeAccount).where(ExchangeAccount.is_active.is_(True))
        if only is not None:
            query = query.where(ExchangeAccount.student_id == only)
        accounts = list(session.execute(query).scalars())
        if not accounts:
            print("Подключённых счетов не нашлось.")
            return 0

        print(f"Счетов к опросу: {len(accounts)}")
        print()

        # Корни из certifi: на Windows Python до системного хранилища не
        # достаёт, и запрос падает с «unable to get local issuer certificate».
        # Проверку не отключаем - здесь ходят ключи от денег ученика.
        context = ssl.create_default_context(cafile=certifi.where())
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=context)
        ) as http:

            async def http_session() -> aiohttp.ClientSession:
                return http

            for row in accounts:
                await _one(row, http_session)

        return 0
    finally:
        session.close()


async def _one(row: ExchangeAccount, http_session) -> None:
    head = f"ученик {row.student_id}, {row.exchange}"
    try:
        client = client_for(row, http_session)
        positions = await client.positions()
    except Exception as exc:  # noqa: BLE001 - один счёт не мешает другим
        print(f"{head}: не дозвонились - {exc}")
        return

    live = [p for p in positions if _size(p) > 0]
    if not live:
        print(f"{head}: открытых позиций нет")
        return

    for one in live:
        print(f"{head}: {one.get('symbol') or one.get('instId') or '?'}")
        # Сначала то, ради чего пришли, - потом всё остальное, чтобы ничего не
        # потерять: имена полей у бирж разные, и нужное может оказаться не там,
        # где мы его ждём.
        for name in MONEY_FIELDS:
            if name in one:
                print(f"    {name:16} = {one[name]}")
        rest = sorted(k for k in one if k not in MONEY_FIELDS)
        if rest:
            print(f"    прочие поля: {', '.join(rest)}")
        missing = [name for name in MONEY_FIELDS if name not in one]
        if missing:
            print(f"    НЕТ полей: {', '.join(missing)}")
        print()


def _size(position: dict) -> float:
    for name in ("size", "positionAmt", "pos", "holdVol"):
        try:
            value = abs(float(position.get(name) or 0))
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


def _student_from_args() -> int | None:
    for arg in sys.argv[1:]:
        if arg.isdigit():
            return int(arg)
    return None


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
