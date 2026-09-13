"""Сбор стакана и ленты OKX: книга той биржи, на которой торгует ученик.

Устроен проще сборщика Binance и по другой причине: книгу целиком присылает
сам канал, поэтому REST-снимков, их бюджета веса и буферов событий здесь нет.
Зато есть два своих правила, которых у Binance не было.

**Монеты вместо контрактов.** OKX считает объём свопа в контрактах: у
BTC-USDT-SWAP контракт равен 0.01 BTC. Метрики стакана и лестница считают
деньги как цену на объём, и без перевода плита на бирже выглядела бы у нас в
сто раз крупнее. Переводим на входе, по ``ctVal`` из справочника инструментов.

**Поток по требованию.** Постоянно книгу держит только Binance - с неё идёт
скринер. Здесь инструмент подписывается, когда его открыл хотя бы один ученик,
и отписывается, когда ушёл последний (ТЗ мультибиржи, §10.3): девять бирж на
пятьдесят монет - это девятьсот потоков, и так делать нельзя.

Целостность книги проверяется контрольной суммой биржи. Она считается по тем
строкам, которые биржа прислала, поэтому рядом с книгой в монетах живёт её
теневая копия в исходных строках (`RawBook`): перевод в монеты и обратно
чисел не сохраняет, и сумма не сошлась бы никогда.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

import aiohttp

from backend.scalping.candles import LiveCandles
from backend.scalping.clusters import ClusterHistory
from backend.scalping.ladder import detect_tick
from backend.scalping.okx import (
    BOOKS_CHANNEL,
    TRADES_CHANNEL,
    OkxPublicRest,
    OkxStreamClient,
    checksum,
)
from backend.scalping.state import BAND_BP, MarketState
from core.okx.futures import Instrument, inst_id, load_instruments, symbol_of

logger = logging.getLogger("nmnh.scalping.okx")

EXCHANGE = "okx"

# Как часто обновляется суточная сводка. Как у Binance: цена в кадре стакана
# приходит из книги, а сводка нужна для подписи и скринерных метрик.
TICKER_INTERVAL = 10.0

# Полоса, за пределами которой уровни выбрасываются, базисные пункты. Та же,
# что у Binance: стакану нужен запас для прокрутки, но не вся книга.
KEEP_BAND_BP = 60.0
PRUNE_INTERVAL = 30.0

# Сколько уровней участвует в контрольной сумме по правилам биржи.
CHECKSUM_DEPTH = 25


def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass
class RawBook:
    """Книга в том виде, в каком её прислала биржа: строки, не числа.

    Нужна ровно для одного - проверить контрольную сумму. Биржа считает её по
    своим строкам, а наша рабочая книга хранит монеты (контракты, умноженные
    на размер контракта), и обратного перевода, совпадающего до знака, не
    существует.
    """

    bids: dict[float, tuple[str, str]] = field(default_factory=dict)
    asks: dict[float, tuple[str, str]] = field(default_factory=dict)

    def reset(self) -> None:
        self.bids.clear()
        self.asks.clear()

    def apply(self, bids: list, asks: list) -> None:
        _merge_raw(self.bids, bids)
        _merge_raw(self.asks, asks)

    def top(self, side: str, depth: int = CHECKSUM_DEPTH) -> list[tuple[str, str]]:
        source = self.bids if side == "bid" else self.asks
        prices = sorted(source, reverse=(side == "bid"))[:depth]
        return [source[price] for price in prices]

    def matches(self, expected: int) -> bool:
        return checksum(self.top("bid"), self.top("ask")) == expected


def _merge_raw(target: dict[float, tuple[str, str]], rows: list) -> None:
    """Применить изменения к теневой книге. Нулевой объём - снятие уровня."""
    for row in rows or []:
        try:
            price_text, size_text = str(row[0]), str(row[1])
            price, size = float(price_text), float(size_text)
        except (TypeError, ValueError, IndexError):
            continue
        if size <= 0:
            target.pop(price, None)
        else:
            target[price] = (price_text, size_text)


def top_symbols(tickers: list[dict], limit: int) -> list[str]:
    """Свопы с наибольшим суточным оборотом в деньгах.

    OKX отдаёт объём в монетах (``volCcy24h``), а не в деньгах: умножаем на
    цену, иначе первым в списке окажется самый дешёвый инструмент.
    """
    rows: list[tuple[float, str]] = []
    for row in tickers:
        name = str(row.get("instId") or "")
        if not name.endswith("-USDT-SWAP"):
            continue
        turnover = _f(row.get("volCcy24h")) * _f(row.get("last"))
        rows.append((turnover, symbol_of(name)))
    rows.sort(reverse=True)
    return [symbol for _, symbol in rows[:limit]]


class OkxCollector:
    """Книга и лента OKX по тем инструментам, что открыты у учеников."""

    exchange = EXCHANGE

    def __init__(self, state: MarketState | None = None, ticker_interval: float = TICKER_INTERVAL):
        self.state = state or MarketState()
        self.ticker_interval = ticker_interval

        self._session: aiohttp.ClientSession | None = None
        self.rest = OkxPublicRest(self._get_session)
        self.stream = OkxStreamClient(self._on_message)
        self.stream.on_reset = self._forget_books

        self._pinned: dict[str, int] = {}          # символ -> сколько клиентов смотрят
        self._raw: dict[str, RawBook] = {}         # символ -> книга строками биржи
        self._specs: dict[str, Instrument] = {}    # instId -> свойства свопа
        self._specs_at = 0.0
        self._task: asyncio.Task | None = None

    @property
    def tracked(self) -> frozenset[str]:
        return frozenset(self._pinned)

    @property
    def connected(self) -> bool:
        return self.stream.connected

    # ── жизненный цикл ──────────────────────────────────────────────────────

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="okx-collector")
        self.stream.start()

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self.stream.stop()
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    async def _loop(self) -> None:
        """Суточная сводка и чистка книг. Книгу ведёт поток, а не этот цикл."""
        last_prune = 0.0
        while True:
            try:
                if self._pinned:
                    await self._apply_tickers()
                now = time.monotonic()
                if now - last_prune >= PRUNE_INTERVAL:
                    for state in self.state.values():
                        state.book.prune(KEEP_BAND_BP)
                    last_prune = now
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Сбой цикла сбора OKX: %s", exc)
            await asyncio.sleep(self.ticker_interval)

    async def _apply_tickers(self) -> None:
        rows = await self.rest.tickers()
        for row in rows:
            state = self.state.get(symbol_of(str(row.get("instId") or "")))
            if state is None:
                continue
            last = _f(row.get("last"))
            open24 = _f(row.get("open24h"))
            state.last_price = last
            state.change_pct = ((last - open24) / open24 * 100) if open24 > 0 else 0.0
            state.quote_volume = _f(row.get("volCcy24h")) * last
            # Числа сделок за сутки OKX не отдаёт - оставляем ноль, а не врём.

    # ── справочник инструментов ─────────────────────────────────────────────

    async def specs(self) -> dict[str, Instrument]:
        """Свойства свопов. Кэш живёт в самом клиенте OKX, здесь - ссылка."""
        try:
            self._specs = await load_instruments(await self._get_session())
        except Exception as exc:  # noqa: BLE001 - сеть; отдаём что есть
            logger.warning("Справочник OKX не получен: %s", exc)
        return self._specs

    async def supports(self, symbol: str) -> bool:
        """Есть ли такой инструмент на бирже.

        Спрашивается до подписки: наборы монет у бирж разные, и ученик,
        открывший монету, которой на OKX нет, должен увидеть подпись, а не
        пустой стакан (ТЗ мультибиржи, §4.4).
        """
        specs = await self.specs()
        return inst_id(symbol) in specs

    def listed_symbols(self) -> frozenset[str]:
        """Монеты биржи из уже загруженного справочника, без запроса к ней.

        Нужно скринеру: список монет приходит с Binance, а торгует ученик на
        своей бирже, и монету, которой у неё нет, честнее пометить в списке, а
        не показывать пустой стакан после нажатия. Справочник ещё не пришёл -
        пусто: пометить весь список чужим хуже, чем не пометить ничего.
        """
        return frozenset(symbol_of(inst) for inst in self._specs)

    def _spec(self, inst: str) -> Instrument | None:
        return self._specs.get(inst)

    # ── инструмент, открытый в стакане ──────────────────────────────────────

    async def pin(self, symbol: str) -> None:
        """Открыть поток по инструменту и держать, пока на него смотрят."""
        sym = symbol.upper()
        self._pinned[sym] = self._pinned.get(sym, 0) + 1
        if self._pinned[sym] > 1:
            return

        await self.specs()
        state = self.state.ensure(sym)
        if state.candles is None:
            state.candles = LiveCandles()
        if state.clusters is None:
            state.clusters = ClusterHistory(tick=detect_tick(state.book))
        self._raw[sym] = RawBook()
        self.start()
        await self.stream.subscribe(self._args(sym))

    async def unpin(self, symbol: str) -> None:
        """Последний ушёл - поток закрываем: держать его ради никого незачем."""
        sym = symbol.upper()
        left = self._pinned.get(sym, 0) - 1
        if left > 0:
            self._pinned[sym] = left
            return
        self._pinned.pop(sym, None)
        await self.stream.unsubscribe(self._args(sym))
        self._raw.pop(sym, None)
        self.state.drop(sym)

    @staticmethod
    def _args(symbol: str) -> set[tuple[str, str]]:
        inst = inst_id(symbol)
        return {(BOOKS_CHANNEL, inst), (TRADES_CHANNEL, inst)}

    def _forget_books(self) -> None:
        """Соединение оборвалось: всё собранное устарело.

        Книга помечается несобранной, и кадр стакана до нового снимка не
        уходит вовсе - лучше подпись «стакан собирается», чем цены минутной
        давности рядом с живой заявкой (ТЗ источников, §4.2).
        """
        for state in self.state.values():
            state.book.reset()
        for raw in self._raw.values():
            raw.reset()

    # ── приём событий потока ────────────────────────────────────────────────

    def _on_message(self, channel: str, inst: str, action: str, row: dict) -> None:
        symbol = symbol_of(inst)
        state = self.state.get(symbol)
        if state is None:
            return
        spec = self._spec(inst)
        if spec is None:
            # Справочник не успел приехать - объём в монеты не перевести, а
            # класть контракты в книгу нельзя: метрики посчитают чужие деньги.
            return

        if channel == TRADES_CHANNEL:
            self._on_trade(state, spec, row)
        elif channel == BOOKS_CHANNEL:
            self._on_book(state, spec, symbol, action, row)

    def _on_trade(self, state, spec: Instrument, row: dict) -> None:
        ts = int(_f(row.get("ts")))
        price = _f(row.get("px"))
        qty = spec.to_coins(_f(row.get("sz")))
        if price <= 0 or qty <= 0:
            return
        # У OKX сторона названа стороной тейкера: buy - по рынку покупали.
        is_buy = str(row.get("side") or "").lower() == "buy"
        state.tape.add(ts, price, qty, is_buy)
        if state.candles is not None:
            state.candles.add(ts, price, qty)
        if state.clusters is not None:
            if state.clusters.tick <= 0:
                state.clusters.ensure_tick(detect_tick(state.book))
            state.clusters.add(ts, price, qty, is_buy)

    def _on_book(self, state, spec: Instrument, symbol: str, action: str, row: dict) -> None:
        raw = self._raw.get(symbol)
        if raw is None:
            return
        bids, asks = row.get("bids") or [], row.get("asks") or []
        seq = int(_f(row.get("seqId"), -1))
        prev = int(_f(row.get("prevSeqId"), -1))

        if action == "snapshot" or not state.book.ready:
            raw.reset()
            raw.apply(bids, asks)
            state.book.apply_snapshot(_coins(bids, spec), _coins(asks, spec), seq)
            # У Binance снимок берётся отдельным запросом и в цепочке событий
            # не участвует, поэтому первое событие после него книга проверяет
            # особым правилом. Здесь снимок пришёл тем же каналом и той же
            # цепочкой - следующее сообщение продолжает его обычным порядком.
            state.book.synced = True
            state.update_book_ratio(BAND_BP)
            return

        if prev != state.book.last_update_id:
            # Между этим и прошлым сообщением потерялось ещё одно: книга
            # разошлась с биржей. Чинится переподпиской - снимок придёт с ней.
            logger.info("Книга OKX %s разошлась (%s != %s) - переподписка", symbol, prev, seq)
            self._resubscribe(symbol)
            return

        raw.apply(bids, asks)
        applied = state.book.apply_diff(
            {"U": prev, "u": seq, "pu": prev, "b": _coins(bids, spec), "a": _coins(asks, spec)}
        )
        if not applied:
            self._resubscribe(symbol)
            return

        expected = row.get("checksum")
        if expected is not None and not raw.matches(int(_f(expected))):
            logger.info("Контрольная сумма книги OKX %s не сошлась - переподписка", symbol)
            self._resubscribe(symbol)
            return

        state.update_book_ratio(BAND_BP)

    def _resubscribe(self, symbol: str) -> None:
        """Собрать книгу заново: отписка и подписка, снимок придёт сам."""
        state = self.state.get(symbol)
        if state is not None:
            state.book.reset()
        raw = self._raw.get(symbol)
        if raw is not None:
            raw.reset()
        args = self._args(symbol)

        async def again() -> None:
            await self.stream.unsubscribe(args)
            await self.stream.subscribe(args)

        asyncio.create_task(again(), name=f"okx-resync-{symbol}")


def _coins(rows: list, spec: Instrument) -> list[list[float]]:
    """Уровни биржи в монетах: цена как есть, объём из контрактов."""
    out: list[list[float]] = []
    for row in rows or []:
        try:
            price, size = float(row[0]), float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        # Ноль означает снятие уровня и должен дойти нулём: перевод его не меняет.
        out.append([price, spec.to_coins(size) if size > 0 else 0.0])
    return out
