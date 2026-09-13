"""Проверка OKX до того, как её выдадут ученикам.

Пробник, а не тест. Тесты проверяют наш перевод ответов биржи на заранее
записанных ответах; здесь мы спрашиваем **живую биржу** - потому что ошибка
адаптера видна только там, а стоит она денег ученика.

Проверяется четыре вещи, в порядке нарастания цены ошибки:

1. **справочник и цена** - без ключей. Отвечает ли биржа вообще и знает ли она
   инструмент. Тут же печатается размер контракта: в нём вся арифметика - у
   BTC-USDT-SWAP контракт равен 0.01 BTC, и ошибка здесь означает объём в сто
   раз больше задуманного;
2. **книга и лента** - публичный поток. Собирается ли стакан, сходится ли
   контрольная сумма, идут ли сделки;
3. **счёт по ключам** - баланс, номер счёта, режим позиций, ставка комиссии.
   Ключи берутся из окружения и никуда не отправляются;
4. **приватный поток** - вход подписью и снимок позиций. Пока он жив, терминал
   не опрашивает биржу вовсе, и молчащий поток означает возврат к опросу.

Торговых заявок пробник **не ставит**. Вход, стоп и частичное исполнение
проверяются руками на демо-счёте: это единственное место, где нельзя доверять
ни тестам, ни этому файлу.

Запуск из каталога проекта. Ключи - в окружении, демо-счёт отдельным флагом:

    set OKX_CHECK_KEY=...
    set OKX_CHECK_SECRET=...
    set OKX_CHECK_PASSPHRASE=...
    set OKX_DEMO=1
    python check_okx.py                 # всё, кроме ключей, если их нет
    python check_okx.py BTCUSDT ETHUSDT # другие инструменты
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - старый поток, обойдёмся как есть
    pass

import aiohttp  # noqa: E402

from backend.scalping.okx_collector import OkxCollector  # noqa: E402
from core.okx.futures import (  # noqa: E402
    Credentials,
    OkxFutures,
    WeexTradeError,
    inst_id,
    load_instruments,
    public_price,
)
from core.okx.stream import OkxPrivateStream  # noqa: E402

# Сколько ждём, пока книга соберётся и по ней пойдут обновления.
BOOK_SECONDS = 12.0
# Сколько ждём входа в приватный поток и снимка позиций.
PRIVATE_SECONDS = 15.0

OK = "  ок  "
NO = " нет  "


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def creds() -> Credentials | None:
    key = os.getenv("OKX_CHECK_KEY", "").strip()
    secret = os.getenv("OKX_CHECK_SECRET", "").strip()
    phrase = os.getenv("OKX_CHECK_PASSPHRASE", "").strip()
    if not (key and secret and phrase):
        return None
    return Credentials(key, secret, phrase)


async def check_public(session: aiohttp.ClientSession, symbols: list[str]) -> bool:
    print("\n── справочник и цена ──────────────────────────────────────────")
    try:
        specs = await load_instruments(session)
    except Exception as exc:  # noqa: BLE001 - пробник говорит, а не падает
        line(NO, f"справочник не получен: {exc}")
        return False
    line(OK, f"инструментов в справочнике: {len(specs)}")

    good = True
    for symbol in symbols:
        spec = specs.get(inst_id(symbol))
        if spec is None:
            line(NO, f"{symbol}: такого свопа на OKX нет")
            good = False
            continue
        price = await public_price(session, symbol)
        line(
            OK,
            f"{symbol} = {spec.inst_id}: контракт {spec.ct_val}, шаг лота {spec.lot_sz}, "
            f"шаг цены {spec.tick_sz}, цена {price}",
        )
        # Та же арифметика, которой считается объём заявки: монеты в контракты
        # и обратно. Расхождение здесь - это расхождение на бирже.
        coins = spec.to_coins(10)
        back = spec.to_contracts(coins)
        if abs(back - 10) > spec.lot_sz:
            line(NO, f"{symbol}: 10 контрактов -> {coins} монет -> {back} контрактов")
            good = False
    return good


async def check_book(symbol: str) -> bool:
    print("\n── книга и лента ──────────────────────────────────────────────")
    collector = OkxCollector()
    try:
        if not await collector.supports(symbol):
            line(NO, f"{symbol}: инструмента нет на бирже")
            return False
        await collector.pin(symbol)
        await asyncio.sleep(BOOK_SECONDS)

        state = collector.state.get(symbol)
        book = state.book if state else None
        if book is None or not book.ready:
            line(NO, f"{symbol}: книга не собралась за {BOOK_SECONDS:.0f} с")
            return False

        line(
            OK,
            f"книга: бид {book.best_bid}, аск {book.best_ask}, "
            f"уровней {len(book.bids)}+{len(book.asks)}",
        )
        if book.best_bid >= book.best_ask:
            line(NO, "бид не ниже аска - книга собрана неверно")
            return False

        # Лента считает окно по часам эпохи, а не по времени цикла: время
        # сделки приходит с биржи, и мерить его секундомером процесса - значит
        # получить метрики пустого окна.
        tape = state.tape.metrics(int(time.time()))
        trades = tape.trades_per_min
        line(OK if trades else NO, f"лента: сделок за минуту {trades:.0f}")
        return True
    finally:
        await collector.stop()


async def check_account(session_factory, keys: Credentials) -> bool:
    print("\n── счёт по ключам ─────────────────────────────────────────────")
    demo = os.getenv("OKX_DEMO", "").strip().lower() in ("1", "true", "yes")
    line(OK if demo else NO, f"демо-счёт: {'да' if demo else 'НЕТ, это живые деньги'}")

    client = OkxFutures(keys, session_factory)
    try:
        balance = await client.balance()
        row = balance[0] if balance else {}
        line(OK, f"баланс: {row.get('availableBalance')} из {row.get('equity')} USDT")
        line(OK, f"номер счёта: {await client.account_uid()}")
        mode = await client.position_mode()
        line(OK, f"режим позиций: {mode}")
        if mode != "long_short_mode":
            print("      односторонний режим: закрытие обязано быть сокращающим,")
            print("      и стоп ставится без стороны позиции - проверьте вход руками")
        line(OK, f"ставка тейкера: {await client.taker_fee()}")
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
    demo = os.getenv("OKX_DEMO", "").strip().lower() in ("1", "true", "yes")

    async def specs() -> dict:
        return await load_instruments(await session_factory())

    stream = OkxPrivateStream(keys, specs, demo=demo)
    stream.start()
    try:
        for _ in range(int(PRIVATE_SECONDS * 2)):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        if not stream.ready:
            line(NO, f"вход в поток не подтверждён за {PRIVATE_SECONDS:.0f} с")
            return False
        line(OK, "вход выполнен, каналы открыты")
        # Снимок позиций приходит сразу после подписки: пустой счёт - это
        # пустой список, а не молчание.
        await asyncio.sleep(3.0)
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

    good = True
    try:
        good &= await check_public(session, symbols)
        good &= await check_book(symbols[0])

        keys = creds()
        if keys is None:
            print("\nКлючей в окружении нет (OKX_CHECK_KEY и соседние) -")
            print("проверка счёта и приватного потока пропущена.")
        else:
            good &= await check_account(factory, keys)
            good &= await check_private(factory, keys)
    finally:
        await session.close()

    print("\n── что проверить руками на демо-счёте ─────────────────────────")
    print("  1. Вход лимиткой со стопом и целями: стоп появляется на бирже")
    print("     только после ПОЛНОГО исполнения лимитки - это правило OKX.")
    print("  2. Частичное исполнение: сопровождение обязано поставить стоп на")
    print("     набранный объём само (watcher._ensure_stop).")
    print("  3. Взятая цель: стоп переезжает в безубыток в ту же секунду -")
    print("     событие приходит приватным потоком, а не обходом.")
    print("  4. Закрытие позиции: биржа снимает свои защитные заявки сама")
    print("     (cxlOnClosePos), лишних висящих заявок остаться не должно.")
    print("\nИтог проверки:", "всё отвечает" if good else "есть отказы - смотрите выше")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
