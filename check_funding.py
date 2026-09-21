"""Что биржа записала по сделке: плата за финансирование и её же итог.

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

Пробник делает две вещи, и обе только читают:

* печатает открытые позиции учеников целиком, всеми полями как есть;
* спрашивает историю начислений (`/capi/v3/account/income`). Живой прогон 21
  сентября показал: ручка отвечает, но пустым списком при любых параметрах и
  любым способом передачи. Записей по счёту она не отдаёт, и рассчитывать на
  неё нельзя.

**Что нашлось вместо неё.** Всё нужное биржа держит в самой позиции, пока та
жива: `cumFundingFee` - накопленная плата за финансирование (бывает обоих
знаков: +273.05 по лонгу TRX, -98.22 по лонгу TAO), `cumOpenFee` и
`cumCloseFee` - удержанные комиссии, `cumOpenValue`/`cumOpenSize` и
`cumCloseValue`/`cumCloseSize` - средние цены и объёмы обеих ног. Сверка по
живой сделке сошлась до копейки: `cumOpenFee` = 11.99997014 при 11.9999 в
истории ордера.

Значит снимать их надо с позиции по ходу сделки - после закрытия она исчезает
вместе со своими числами.

    python check_funding.py            # все ученики с подключёнными ключами
    python check_funding.py 26         # только ученик с этим номером
    python check_funding.py 26 TAOUSDT # и спросить историю по этой монете

Запускать там же, где работает сервер, и с тем же `.env`: без
`WEEX_KEYS_SECRET` ключи учеников не расшифровать.
"""

from __future__ import annotations

import asyncio
import ssl
import sys
import time

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


# Ручка истории начислений и наборы параметров, которыми её пробуем.
#
# Имя пути проверено: без подписи он отвечает 401, как и остальные приватные
# ручки, а несуществующие - 404. Чего он ждёт в параметрах, биржа нигде не
# пишет, поэтому идём от общего к частному: сперва без всего, потом с окном
# времени, потом с монетой. Первый непустой ответ и покажет правду.
INCOME_PATH = "/capi/v3/account/income"

# Сколько суток истории просить. Трёх хватает на любую сделку, которую держат.
INCOME_DAYS = 3


async def main() -> int:
    only = _student_from_args()
    symbol = _symbol_from_args()

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
                await _one(row, http_session, symbol)

        return 0
    finally:
        session.close()


async def _one(row: ExchangeAccount, http_session, symbol: str | None) -> None:
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
    else:
        _show_positions(head, live)

    # История начислений - разведка по одной WEEX: у остальных бирж и путь
    # другой, и клиент подписывает запросы иначе. Шуметь их отказами незачем.
    if str(row.exchange or "").lower() == "weex":
        await _income(head, client, symbol)


def _show_positions(head: str, live: list[dict]) -> None:

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


async def _income(head: str, client, symbol: str | None) -> None:
    """История начислений: то, что биржа записала по счёту своими словами."""
    now = int(time.time() * 1000)
    since = now - INCOME_DAYS * 24 * 3600 * 1000

    tries: list[tuple[str, dict]] = [
        ("без параметров", {}),
        ("окно времени", {"startTime": since, "endTime": now, "limit": 100}),
    ]
    if symbol:
        tries.append(
            ("монета и окно", {"symbol": symbol.upper(), "startTime": since, "endTime": now, "limit": 100})
        )

    print(f"{head}: история начислений")
    for what, params in tries:
        # И телом, и строкой запроса: какой из двух способов ждёт биржа,
        # заранее не известно, а отказ она объясняет по-разному.
        for how in ("тело", "строка"):
            try:
                answer = await client._request(
                    "POST",
                    INCOME_PATH,
                    data=params if how == "тело" and params else None,
                    params=params if how == "строка" and params else None,
                )
            except Exception as exc:  # noqa: BLE001 - отказ тоже ответ
                print(f"    {what} ({how}): {exc}")
                continue

            rows = answer if isinstance(answer, list) else (answer or {}).get("data") or []
            print(f"    {what} ({how}): записей {len(rows)}")
            for one in rows[:12]:
                print(f"        {one}")
            if rows:
                kinds = sorted({str(one.get("incomeType") or one.get("type") or "?") for one in rows if isinstance(one, dict)})
                print(f"        типы записей: {', '.join(kinds)}")
                return
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


def _symbol_from_args() -> str | None:
    for arg in sys.argv[1:]:
        if not arg.isdigit() and arg.isalnum():
            return arg
    return None


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
