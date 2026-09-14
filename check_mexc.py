"""Проверка MEXC до того, как её выдадут ученикам.

Пробник, а не тест. Тесты проверяют наш перевод ответов биржи на заранее
записанных ответах; здесь мы спрашиваем **живую биржу** - потому что ошибка
адаптера видна только там, а стоит она денег ученика.

Учебного контура у MEXC нет вовсе: ни песочницы, ни учебных денег, как VST у
BingX. Поэтому порядок такой (ТЗ MEXC, §5):

1. **справочник и цена** - без ключей. Отвечает ли биржа, знает ли она пару, и
   что она говорит о ней: размер контракта (из него считается весь объём), шаг
   и минимум в контрактах, шаг цены, ставки;
2. **книга и лента** - публичный поток. Собирается ли стакан по снимку,
   продолжает ли поток его нумерацию подряд, догоняются ли разрывы коммитами.
   Отдельно печатается объём лучшего бида: в потоке он в контрактах, а в книге
   обязан быть в монетах - это место, где ошибка видна плитой, которой нет;
3. **счёт по ключам** - часы, баланс, режим позиций, ставка комиссии, позиции.
   Ключи берутся из окружения и никуда не отправляются;
4. **приватный поток** - вход подписью, снимок позиций, события.

Торговых заявок пробник **не ставит**. Вход, перенос стопа и закрытие
проверяются руками на живом счёте объёмом в один контракт: у BTC это около
восьми долларов позиции и 0.13 USDT маржи при плече 20.

Запуск из каталога проекта:

    set MEXC_CHECK_KEY=...
    set MEXC_CHECK_SECRET=...
    python check_mexc.py                 # всё, кроме ключей, если их нет
    python check_mexc.py BTCUSDT ETHUSDT # другие пары
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

from backend.scalping.mexc_collector import MexcCollector  # noqa: E402
from core.mexc.futures import (  # noqa: E402
    Credentials,
    MexcFutures,
    WeexTradeError,
    load_instruments,
    public_price,
    symbol_id,
    sync_clock,
)
from core.mexc.stream import MexcPrivateStream  # noqa: E402

# Сколько ждём, пока книга соберётся, и сколько потом смотрим за цепочкой.
BOOK_SECONDS = 12.0
CHAIN_SECONDS = 60.0
# Сколько ждём входа в приватный поток и снимка позиций.
PRIVATE_SECONDS = 20.0

OK = "  ок  "
NO = " нет  "


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def creds() -> Credentials | None:
    key = os.getenv("MEXC_CHECK_KEY", "").strip()
    secret = os.getenv("MEXC_CHECK_SECRET", "").strip()
    if not (key and secret):
        return None
    # Пароля ключа у MEXC нет вовсе - подпись считается секретом.
    return Credentials(key, secret, "")


async def check_public(session: aiohttp.ClientSession, symbols: list[str]) -> bool:
    print("\n── справочник и контракты ─────────────────────────────────────")
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
            line(NO, f"{symbol}: такой пары на MEXC нет, она вне торгов или в зоне оценки")
            good = False
            continue
        price = await public_price(session, symbol)
        line(
            OK,
            f"{symbol} = {spec.symbol}: контракт {spec.contract_size} монеты, "
            f"шаг {spec.vol_unit} контракта, минимум {spec.min_vol} "
            f"({spec.to_coins(spec.min_vol)} монет), шаг цены {spec.price_unit}, цена {price}",
        )
        line(
            OK,
            f"{symbol}: ставки тейкер {spec.taker}, мейкер {spec.maker}, "
            f"плечо до {spec.max_leverage}",
        )
        if spec.contract_size <= 0 or spec.min_vol <= 0:
            line(NO, f"{symbol}: биржа не назвала контракт или минимум - объём считать нечем")
            good = False
        if price:
            # Во что обойдётся проверочная сделка: один контракт по текущей цене.
            one = spec.to_coins(spec.min_vol) * price
            line(OK, f"{symbol}: минимальная заявка - около {one:.2f} USDT позиции")
    return good


async def check_book(symbol: str) -> bool:
    print("\n── книга и лента ──────────────────────────────────────────────")
    collector = MexcCollector()
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

        await _show_size(collector, symbol, book)

        # Цепочка за минуту. Здесь видно главное: держит ли биржа обещание
        # нумеровать изменения подряд, и хватает ли коммитов на разрывы.
        gaps_before = collector.gaps
        commits_before = collector.commits
        resyncs_before = collector.resyncs
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
        commits = collector.commits - commits_before
        resyncs = collector.resyncs - resyncs_before
        seen = collector.state.get(symbol).book.last_update_id
        line(
            OK if not broken and resyncs <= 1 else NO,
            f"цепочка за {CHAIN_SECONDS:.0f} с: разрывов {gaps}, догнано коммитами {commits}, "
            f"пересборок снимком {resyncs}, номер прошёл {started} -> {seen}",
        )
        if gaps:
            print("      разрывы в нумерации есть - смотрите, чем они закрываются:")
            print("      коммитами это дёшево, пересборкой снимком - дорого")

        tape = state.tape.metrics(int(time.time()))
        line(OK if tape.trades_per_min else NO, f"лента: сделок за минуту {tape.trades_per_min:.0f}")
        return not broken and resyncs <= 1
    finally:
        await collector.stop()


async def _show_size(collector: MexcCollector, symbol: str, book) -> None:
    """Показать объём лучшего бида до перевода и после.

    В потоке и в снимке он приходит в контрактах, а в книге обязан лежать в
    монетах: у BTC разница в десять тысяч раз, и заметить её надо здесь, а не
    по жалобе ученика на плиту, которой нет.
    """
    try:
        depth = await collector.rest.depth(symbol_id(symbol), 5)
    except Exception as exc:  # noqa: BLE001
        line(NO, f"глубина по REST не получена: {exc}")
        return
    rows = depth.get("bids") or []
    if not rows:
        line(NO, "глубина по REST пуста - сверить объём не с чем")
        return
    try:
        contracts = float(rows[0][1])
    except (TypeError, ValueError, IndexError):
        line(NO, "глубина по REST пришла в неожиданном виде")
        return
    size = collector._contract_size(symbol)
    line(
        OK,
        f"объём лучшего бида: {contracts} контрактов по {size} = "
        f"{round(contracts * size, 10)} монет; в книге {book.bids.get(book.best_bid, 0.0)}",
    )


async def check_account(session_factory, keys: Credentials) -> bool:
    print("\n── счёт по ключам ─────────────────────────────────────────────")
    line(NO, "учебного контура у MEXC нет: это живые деньги")

    client = MexcFutures(keys, session_factory)
    try:
        # Окно годности у биржи десять секунд - расхождение часов съедает его
        # быстрее, чем кажется, и это первое, что стоит увидеть при отказах.
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
            print("      односторонний режим: сторона заявки у MEXC - число от 1 до 4,")
            print("      и закрытие обязано адресоваться номером позиции")
        line(OK, f"ставка тейкера: {await client.taker_fee()}")
        positions = await client.positions()
        line(OK, f"открытых позиций: {len(positions)}")
        for one in positions:
            print(
                f"      {one['symbol']} {one['side']} {one['size']} "
                f"по {one['averageOpenPrice']} (позиция {one['positionId']})"
            )
        return True
    except WeexTradeError as exc:
        line(NO, f"биржа отказала: {exc}")
        return False


async def check_private(session_factory, keys: Credentials) -> bool:
    print("\n── приватный поток ────────────────────────────────────────────")
    client = MexcFutures(keys, session_factory)
    stream = MexcPrivateStream(keys, client.positions)
    stream.start()
    try:
        for _ in range(int(PRIVATE_SECONDS * 2)):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        if not stream.ready:
            line(NO, f"поток не ожил за {PRIVATE_SECONDS:.0f} с (вход, адрес или снимок)")
            return False
        line(OK, "вход принят, соединение живо, снимок позиций взят")
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
            print("\nКлючей в окружении нет (MEXC_CHECK_KEY и MEXC_CHECK_SECRET) -")
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
