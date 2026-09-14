"""Проверка Binance до того, как её выдадут ученикам.

Пробник, а не тест. Тесты проверяют наш перевод ответов биржи на заранее
записанных ответах; здесь мы спрашиваем **живую биржу** - потому что ошибка
адаптера видна только там.

У Binance, в отличие от MEXC, есть учебный контур (`demo-fapi.binance.com`), и
это меняет порядок проверки к лучшему: заявку можно поставить по-настоящему, не
трогая денег ученика. Пробник её всё равно не ставит - вход, стоп и закрытие
проверяются руками, - но ключи учебного контура он принимает теми же
переменными, и `BINANCE_TESTNET=1` переключает всё разом.

Проверяется четыре вещи, в порядке нарастания цены ошибки:

1. **справочник и цена** - без ключей: шаги из фильтров, оба минимума - в
   монетах и в деньгах, - и цена пары;
2. **книга и лента** - их у Binance проверять нечем и незачем: рыночная
   половина биржи работает в бою с самого начала и идёт всем по умолчанию
   (`backend/scalping/binance.py`). Поэтому этого шага здесь нет;
3. **счёт по ключам** - часы, баланс, режим позиций, ставка комиссии, предел
   плеча и позиции. Ключи берутся из окружения и никуда не отправляются;
4. **приватный поток** - ключ, снимок позиций и события.

Запуск из каталога проекта:

    set BINANCE_CHECK_KEY=...
    set BINANCE_CHECK_SECRET=...
    set BINANCE_TESTNET=1
    python check_binance.py                 # всё, кроме ключей, если их нет
    python check_binance.py BTCUSDT ETHUSDT # другие пары
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - старый поток, обойдёмся как есть
    pass

import aiohttp  # noqa: E402

from core.binance.futures import (  # noqa: E402
    BinanceFutures,
    Credentials,
    WeexTradeError,
    load_instruments,
    public_price,
    symbol_id,
    sync_clock,
)
from core.binance.market import broker_mark  # noqa: E402
from core.binance.stream import BinancePrivateStream  # noqa: E402

# Сколько ждём ключа, снимка позиций и первых событий.
PRIVATE_SECONDS = 20.0

OK = "  ок  "
NO = " нет  "


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def testnet() -> bool:
    return os.getenv("BINANCE_TESTNET", "").strip().lower() in ("1", "true", "yes")


def creds() -> Credentials | None:
    key = os.getenv("BINANCE_CHECK_KEY", "").strip()
    secret = os.getenv("BINANCE_CHECK_SECRET", "").strip()
    if not (key and secret):
        return None
    # Пароля ключа у Binance нет вовсе - подпись считается секретом.
    return Credentials(key, secret, "")


async def check_public(session: aiohttp.ClientSession, symbols: list[str], base: str) -> bool:
    print("\n── справочник и минимумы ──────────────────────────────────────")
    try:
        specs = await load_instruments(session, base)
    except Exception as exc:  # noqa: BLE001 - пробник говорит, а не падает
        line(NO, f"справочник не получен: {exc}")
        return False
    line(OK, f"пар в справочнике: {len(specs)}")

    good = True
    for symbol in symbols:
        spec = specs.get(symbol_id(symbol))
        if spec is None:
            line(NO, f"{symbol}: такой пары на Binance нет или она вне торгов")
            good = False
            continue
        price = await public_price(session, symbol)
        line(
            OK,
            f"{symbol}: шаг объёма {spec.step}, шаг цены {spec.tick}, "
            f"минимум {spec.min_qty} монет и {spec.min_notional} USDT, цена {price}",
        )
        if spec.step <= 0 or spec.min_qty <= 0:
            line(NO, f"{symbol}: биржа не назвала шаг или минимум - объём считать нечем")
            good = False
        if price and spec.min_qty:
            # Во что обойдётся проверочная сделка: минимальный объём по текущей
            # цене. На BTC это заметные деньги - тем важнее учебный контур.
            line(OK, f"{symbol}: минимальная заявка - около {spec.min_qty * price:.2f} USDT позиции")
    return good


async def check_account(session_factory, keys: Credentials) -> bool:
    print("\n── счёт по ключам ─────────────────────────────────────────────")
    line(
        OK if testnet() else NO,
        f"контур: {'учебный (demo-fapi)' if testnet() else 'БОЕВОЙ, это живые деньги'}",
    )
    mark = broker_mark()
    line(
        OK if mark.enabled else NO,
        f"метка брокера: {mark.prefix if mark.enabled else 'нет (BINANCE_BROKER_ID не задан)'}",
    )
    if not mark.enabled:
        print("      это ожидаемо: статус Link у Binance закрыт порогами")
        print("      (docs/integrations/broker-applications.md, §6)")

    client = BinanceFutures(keys, session_factory, testnet=testnet())
    try:
        skew = await sync_clock(await session_factory(), client.base_url, force=True)
        line(
            OK if abs(skew) < 2000 else NO,
            f"часы против биржи: {skew:+.0f} мс"
            + ("" if abs(skew) < 2000 else " - поправку клиент вносит сам, но часы стоит сверить"),
        )
        balance = await client.balance()
        row = balance[0] if balance else {}
        line(
            OK if row else NO,
            f"баланс: {row.get('availableBalance')} из {row.get('equity')} "
            f"{row.get('marginCoin') or client.margin_coin}",
        )
        mode = await client.position_mode()
        line(OK, f"режим позиций: {mode}")
        if mode != "long_short_mode":
            print("      односторонний режим: продажа сверх лонга разворачивает позицию,")
            print("      и закрытие обязано быть сокращающим - проверьте вход руками")
        line(OK, f"ставка тейкера: {await client.taker_fee()}")
        leverage = await client.max_leverage("BTCUSDT")
        line(
            OK if leverage else NO,
            f"предел плеча BTCUSDT: {leverage or 'биржа не сказала'}",
        )
        positions = await client.positions()
        line(OK, f"открытых позиций: {len(positions)}")
        for one in positions:
            print(f"      {one['symbol']} {one['side']} {one['size']} по {one['averageOpenPrice']}")
        return True
    except WeexTradeError as exc:
        line(NO, f"биржа отказала: {exc}")
        return False


async def check_private(session_factory, keys: Credentials) -> bool:
    print("\n── приватный поток ────────────────────────────────────────────")
    client = BinanceFutures(keys, session_factory, testnet=testnet())
    stream = BinancePrivateStream(keys, client.positions, testnet=testnet())
    stream.start()
    try:
        for _ in range(int(PRIVATE_SECONDS * 2)):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        if not stream.ready:
            line(NO, f"поток не ожил за {PRIVATE_SECONDS:.0f} с (ключ, адрес или снимок)")
            return False
        line(OK, "ключ получен, соединение живо, снимок позиций взят")
        rows = stream.positions()
        line(OK, f"позиций в потоке: {len(rows)}")
        for one in rows:
            print(f"      {one['symbol']} {one['side']} {one['size']}")
        return True
    finally:
        await stream.stop()


async def main() -> int:
    symbols = [s.upper() for s in sys.argv[1:]] or ["BTCUSDT"]
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    from core.binance.market import BASE_URL, TESTNET_URL

    base = TESTNET_URL if testnet() else BASE_URL
    good = True
    try:
        good &= await check_public(session, symbols, base)

        keys = creds()
        if keys is None:
            print("\nКлючей в окружении нет (BINANCE_CHECK_KEY и BINANCE_CHECK_SECRET) -")
            print("проверка счёта и приватного потока пропущена.")
        else:
            good &= await check_account(factory, keys)
            good &= await check_private(factory, keys)
    finally:
        await session.close()

    print("\n" + ("Всё сошлось." if good else "Есть расхождения - смотрите строки [ нет ]."))
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
