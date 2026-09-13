"""Проверка BingX до того, как её выдадут ученикам.

Пробник, а не тест. Тесты проверяют наш перевод ответов биржи на заранее
записанных ответах; здесь мы спрашиваем **живую биржу** - потому что ошибка
адаптера видна только там, а стоит она денег ученика.

Проверяется четыре вещи, в порядке нарастания цены ошибки:

1. **справочник и цена** - без ключей. Отвечает ли биржа, знает ли она пару, и
   что она говорит о ней: точности (из них считаются шаги), оба минимума -
   в монетах и в деньгах, - и три признака, каждый из которых означает отказ,
   непонятный ученику: `brokerState`, `apiStateOpen`, `apiStateClose`;
2. **книга и лента** - публичный поток. Собирается ли стакан, живёт ли он
   минуту без пересборок, идут ли сделки. Отдельно печатаются пропуски в
   нумерации: биржа их допускает, и это не беда - бедой была бы пересборка.
   Тут же книга потока сверяется с глубиной по REST: объём в потоке биржа
   считает в монетах, но документация этого прямо не говорит, а метрики
   стакана считают деньги как цену на объём;
3. **счёт по ключам** - баланс, номер счёта, режим позиций, ставка комиссии.
   Ключи берутся из окружения и никуда не отправляются;
4. **приватный поток** - ключ, снимок позиций и события. Пока он жив, терминал
   не опрашивает биржу вовсе, и молчащий поток означает возврат к опросу.

Торговых заявок пробник **не ставит**. Вход, стоп и частичное исполнение
проверяются руками на демо-контуре (VST): это единственное место, где нельзя
доверять ни тестам, ни этому файлу (ТЗ BingX, §5).

Запуск из каталога проекта. Ключи - в окружении, демо-контур отдельным флагом:

    set BINGX_CHECK_KEY=...
    set BINGX_CHECK_SECRET=...
    set BINGX_DEMO=1
    python check_bingx.py                 # всё, кроме ключей, если их нет
    python check_bingx.py BTCUSDT ETHUSDT # другие пары
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

from backend.scalping.bingx_collector import BingxCollector  # noqa: E402
from core.bingx.futures import (  # noqa: E402
    BingxFutures,
    Credentials,
    WeexTradeError,
    load_instruments,
    public_price,
    source_key,
    symbol_id,
    sync_clock,
)
from core.bingx.stream import BingxPrivateStream  # noqa: E402

# Сколько ждём, пока книга соберётся, и сколько потом смотрим за цепочкой.
BOOK_SECONDS = 12.0
CHAIN_SECONDS = 60.0
# Сколько ждём ключа, снимка позиций и первых событий.
PRIVATE_SECONDS = 20.0

OK = "  ок  "
NO = " нет  "


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def demo() -> bool:
    return os.getenv("BINGX_DEMO", "").strip().lower() in ("1", "true", "yes")


def creds() -> Credentials | None:
    key = os.getenv("BINGX_CHECK_KEY", "").strip()
    secret = os.getenv("BINGX_CHECK_SECRET", "").strip()
    if not (key and secret):
        return None
    # Пароля ключа у BingX нет вовсе - подпись считается секретом.
    return Credentials(key, secret, "")


async def check_public(session: aiohttp.ClientSession, symbols: list[str]) -> bool:
    print("\n── справочник и минимумы ──────────────────────────────────────")
    try:
        specs = await load_instruments(session)
    except Exception as exc:  # noqa: BLE001 - пробник говорит, а не падает
        line(NO, f"справочник не получен: {exc}")
        return False
    line(OK, f"пар в справочнике: {len(specs)}")

    good = True
    for symbol in symbols:
        spec = specs.get(symbol_id(symbol))
        if spec is None:
            line(NO, f"{symbol}: такой пары на BingX нет или она вне торгов")
            good = False
            continue
        price = await public_price(session, symbol)
        line(
            OK,
            f"{symbol} = {spec.symbol}: шаг объёма {spec.step}, шаг цены {spec.tick}, "
            f"минимум {spec.min_qty} монет и {spec.min_notional} USDT, цена {price}",
        )
        if spec.broker_closed:
            line(NO, f"{symbol}: пара закрыта для брокерских счетов (brokerState)")
            good = False
        if not (spec.api_open and spec.api_close):
            line(
                NO,
                f"{symbol}: по API открытие {'да' if spec.api_open else 'НЕТ'}, "
                f"закрытие {'да' if spec.api_close else 'НЕТ'}",
            )
            good = False
        if spec.min_qty <= 0 or spec.step <= 0:
            line(NO, f"{symbol}: биржа не назвала шаг или минимум - объём считать нечем")
            good = False
    return good


async def check_book(symbol: str) -> bool:
    print("\n── книга и лента ──────────────────────────────────────────────")
    collector = BingxCollector()
    try:
        if not await collector.supports(symbol):
            line(NO, f"{symbol}: пары нет на бирже")
            return False
        await collector.pin(symbol)

        # Ждём первый снимок.
        for _ in range(int(BOOK_SECONDS * 2)):
            await asyncio.sleep(0.5)
            state = collector.state.get(symbol)
            if state is not None and state.book.ready:
                break

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

        # Объём в книге потока против глубины по REST. Документация называет
        # обе меры («bids» и «bidsCoin»), и какая из них приходит в поток,
        # видно только здесь. Ошибка тут - это плита на экране, которой нет.
        await _compare_depth(collector, symbol, book)

        # Цепочка за минуту. Пересборка - это книга, которую пришлось собирать
        # заново; пропуск в номерах - нормальное поведение биржи, и его мы
        # считаем отдельно, чтобы видеть, сколько его сегодня.
        gaps_before, resyncs_before = collector.gaps, collector.resyncs
        started = book.last_update_id
        broken = False
        until = time.monotonic() + CHAIN_SECONDS
        while time.monotonic() < until:
            await asyncio.sleep(0.5)
            fresh = collector.state.get(symbol)
            if fresh is None:
                break
            broken = broken or not fresh.book.ready

        gaps = collector.gaps - gaps_before
        resyncs = collector.resyncs - resyncs_before
        seen = collector.state.get(symbol).book.last_update_id
        line(
            OK if not (broken or resyncs) else NO,
            f"цепочка за {CHAIN_SECONDS:.0f} с: пересборок {resyncs}, "
            f"пропусков в нумерации {gaps}, номер прошёл {started} -> {seen}",
        )

        tape = state.tape.metrics(int(time.time()))
        trades = tape.trades_per_min
        line(OK if trades else NO, f"лента: сделок за минуту {trades:.0f}")
        return not (broken or resyncs)
    finally:
        await collector.stop()


async def _compare_depth(collector: BingxCollector, symbol: str, book) -> None:
    """Сверить лучший уровень потока с глубиной по REST."""
    try:
        depth = await collector.rest.depth(symbol_id(symbol), 5)
    except Exception as exc:  # noqa: BLE001
        line(NO, f"глубина по REST не получена: {exc}")
        return
    rows = depth.get("bids") or []
    coins = depth.get("bidsCoin") or []
    if not rows:
        line(NO, "глубина по REST пуста - сверить объём не с чем")
        return
    try:
        rest_size = float(rows[0][1])
        rest_coins = float(coins[0][1]) if coins else None
    except (TypeError, ValueError, IndexError):
        line(NO, "глубина по REST пришла в неожиданном виде")
        return
    stream_size = book.bids.get(book.best_bid, 0.0)
    line(
        OK,
        f"объём лучшего бида: в потоке {stream_size}, по REST {rest_size}"
        + (f", в монетах {rest_coins}" if rest_coins is not None else ""),
    )
    if rest_coins and rest_size and abs(rest_size - rest_coins) > max(rest_coins, 1.0) * 0.01:
        print("      биржа считает bids и bidsCoin по-разному - сверьте, в чём")
        print("      приходит объём в потоке: метрики стакана считают монеты")


async def check_account(session_factory, keys: Credentials) -> bool:
    print("\n── счёт по ключам ─────────────────────────────────────────────")
    line(OK if demo() else NO, f"демо-контур: {'да' if demo() else 'НЕТ, это живые деньги'}")
    mark = source_key()
    line(OK if mark else NO, f"метка брокера: {mark or 'нет (X-SOURCE-KEY не задан)'}")

    client = BingxFutures(keys, session_factory, demo=demo())
    try:
        # Часы: расхождение больше пяти секунд биржа не прощает вовсе, и это
        # первое, что стоит увидеть при отказах «timestamp is invalid».
        skew = await sync_clock(await session_factory(), client.base_url, force=True)
        line(
            OK if abs(skew) < 2000 else NO,
            f"часы против биржи: {skew:+.0f} мс"
            + ("" if abs(skew) < 2000 else " - поправку клиент вносит сам, но часы стоит сверить"),
        )
        balance = await client.balance()
        row = balance[0] if balance else {}
        line(
            OK,
            f"баланс: {row.get('availableBalance')} из {row.get('equity')} "
            f"{row.get('marginCoin') or client.margin_coin}",
        )
        line(OK, f"номер счёта: {await client.account_uid()}")
        mode = await client.position_mode()
        line(OK, f"режим позиций: {mode}")
        if mode != "long_short_mode":
            print("      односторонний режим: продажа сверх лонга разворачивает позицию,")
            print("      и закрытие обязано быть сокращающим - проверьте вход руками")
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
    client = BingxFutures(keys, session_factory, demo=demo())
    stream = BingxPrivateStream(keys, client.positions, demo=demo())
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

    good = True
    try:
        good &= await check_public(session, symbols)
        good &= await check_book(symbols[0])

        keys = creds()
        if keys is None:
            print("\nКлючей в окружении нет (BINGX_CHECK_KEY и BINGX_CHECK_SECRET) -")
            print("проверка счёта и приватного потока пропущена.")
        else:
            good &= await check_account(factory, keys)
            good &= await check_private(factory, keys)
    finally:
        await session.close()

    print("\n── что проверить руками на демо-контуре ───────────────────────")
    print("  1. Вход лимиткой с приложенными стопом и целями: заявки появились")
    print("     на бирже - и стоп, и лестница.")
    print("  2. ЧАСТИЧНОЕ исполнение: есть ли защита на набранный объём, или")
    print("     она ждёт полного, как у OKX. Сейчас адаптер считает, что ждёт")
    print("     (stop_waits_full_fill), и сопровождение ставит стоп само.")
    print("  3. Взятая цель: стоп переезжает в безубыток сразу - событием")
    print("     потока, а не следующим обходом.")
    print("  4. Закрытие позиции: снимает ли биржа оставшуюся защиту сама, или")
    print("     висящие заявки остаются на нас.")
    print("  5. Номера заявок и o.ti: сопровождение узнало свои стоп и цели -")
    print("     метки у условных заявок нет, и опознать их можно только так.")
    print("\nИтог проверки:", "всё отвечает" if good else "есть отказы - смотрите выше")
    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
