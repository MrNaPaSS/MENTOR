"""Сбор стакана и ленты BingX: книга той биржи, на которой торгует ученик.

Проще сборщика OKX ровно на один слой: объём BingX считает в монетах, и
переводить его из контрактов не нужно - в книгу кладётся то, что пришло.
Остальное устроено так же, как у OKX, и по тем же причинам.

Что здесь своё:

* **снимок и инкременты в одном канале.** `@incrDepth` присылает сперва полную
  книгу (`action: "all"`) с номером `lastUpdateId`, дальше - изменения
  (`action: "update"`);
* **нумерация идёт вперёд, но не подряд.** Документация обещает шаг в единицу,
  живая биржа его не держит: на BTC-USDT попадаются шаги в два-три номера, и
  за минуту таких пропусков около десятка (проверено пробником 13 сентября
  2026). Пересобирать книгу на каждом значило бы держать ученика на подписи
  «стакан собирается» вместо стакана.

  Поэтому пропуск номера не считается потерей. Потерять сообщение посередине
  этот канал не может: он идёт поверх TCP, где порядок и доставка
  гарантированы, - сообщения либо приходят все подряд, либо рвётся само
  соединение, а обрыв мы и так лечим пересборкой. Значит пропуск в номерах -
  это счётчик на стороне биржи, а не наша дыра. Считаем их и держим на виду
  (`gaps`): если поведение однажды изменится, это будет видно, а не угадано;
* **поток по требованию.** Постоянно книгу держит только Binance - с неё идёт
  скринер. Здесь пара подписывается, когда её открыл хотя бы один ученик, и
  отписывается, когда ушёл последний (ТЗ мультибиржи, §10.3);
* **обрыв означает несобранную книгу.** Кадр стакана до нового снимка не уходит
  вовсе: подпись «стакан собирается» честнее цен минутной давности рядом с
  живой заявкой.

И одно, о чём надо помнить в интерфейсе, а не в коде: книга BingX обновляется
раз в 200 мс у BTC-USDT и ETH-USDT и раз в 800 мс у остальных пар - вдвое реже
Binance. На быстрых монетах это видно глазом (ТЗ BingX, §3.3 и §7).
"""

from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from backend.scalping.bingx import (
    DEPTH_CHANNEL,
    TRADES_CHANNEL,
    BingxPublicRest,
    BingxStreamClient,
)
from backend.scalping.candles import LiveCandles
from backend.scalping.clusters import ClusterHistory
from backend.scalping.ladder import detect_tick
from backend.scalping.linger import (
    Linger,
    LINGER_LIMIT_STREAM,
    LINGER_SECONDS_STREAM,
)
from backend.scalping.state import BAND_BP, MarketState
from core.bingx.futures import Instrument, load_instruments, symbol_id, symbol_of

logger = logging.getLogger("nmnh.scalping.bingx")

EXCHANGE = "bingx"

# Как часто обновляется суточная сводка. Как у Binance и OKX: цена в кадре
# стакана приходит из книги, а сводка нужна для подписи и метрик скринера.
TICKER_INTERVAL = 10.0

# Полоса, за пределами которой уровни выбрасываются, базисные пункты.
KEEP_BAND_BP = 60.0
PRUNE_INTERVAL = 30.0

# Виды сообщений книги: полный снимок и изменение.
ACTION_SNAPSHOT = "all"
ACTION_UPDATE = "update"

# Как часто напоминать в журнале о пропусках в нумерации. Каждый писать незачем
# - их десяток в минуту, - но и молчать нельзя: по этому счёту видно, если
# биржа однажды начнёт терять сообщения по-настоящему.
GAP_REPORT = 500


def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def top_symbols(tickers: list[dict], limit: int) -> list[str]:
    """Пары с наибольшим суточным оборотом в деньгах.

    Оборот BingX называет сама (`quoteVolume`); если его нет - считаем по
    объёму в монетах и цене, иначе первой в списке окажется самая дешёвая
    монета.
    """
    rows: list[tuple[float, str]] = []
    for row in tickers:
        name = str(row.get("symbol") or "").upper()
        if not name.endswith("-USDT"):
            continue
        turnover = _f(row.get("quoteVolume")) or _f(row.get("volume")) * _f(row.get("lastPrice"))
        rows.append((turnover, symbol_of(name)))
    rows.sort(reverse=True)
    return [symbol for _, symbol in rows[:limit]]


def levels(rows: list) -> list[list[float]]:
    """Уровни биржи в наш вид. Объём BingX уже в монетах - переводить нечего."""
    out: list[list[float]] = []
    for row in rows or []:
        try:
            price, size = float(row[0]), float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        # Ноль означает снятие уровня и должен дойти нулём.
        out.append([price, size if size > 0 else 0.0])
    return out


class BingxCollector:
    """Книга и лента BingX по тем парам, что открыты у учеников."""

    exchange = EXCHANGE

    def __init__(self, state: MarketState | None = None, ticker_interval: float = TICKER_INTERVAL):
        self.state = state or MarketState()
        self.ticker_interval = ticker_interval

        self._session: aiohttp.ClientSession | None = None
        self.rest = BingxPublicRest(self._get_session)
        self.stream = BingxStreamClient(self._on_message)
        self.stream.on_reset = self._forget_books

        self._pinned: dict[str, int] = {}        # символ -> сколько клиентов смотрят
        self._specs: dict[str, Instrument] = {}  # BTC-USDT -> свойства пары
        # Закрытая монета отпускается не сразу: вернутся внутри срока -
        # своя лента цела и профиль крупной свечи собран нами.
        self._linger = Linger(
            self._forget, delay=LINGER_SECONDS_STREAM, limit=LINGER_LIMIT_STREAM
        )
        self._task: asyncio.Task | None = None
        # Пропуски в нумерации биржи и пересборки книги. Не отладка: по первому
        # видно, как биржа ведёт себя сегодня, по второму - живёт ли книга.
        self.gaps = 0
        self.resyncs = 0

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
            self._task = asyncio.create_task(self._loop(), name="bingx-collector")
        self.stream.start()

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._linger.clear()
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
                logger.warning("Сбой цикла сбора BingX: %s", exc)
            await asyncio.sleep(self.ticker_interval)

    async def _apply_tickers(self) -> None:
        rows = await self.rest.tickers()
        for row in rows:
            state = self.state.get(symbol_of(str(row.get("symbol") or "")))
            if state is None:
                continue
            last = _f(row.get("lastPrice"))
            state.last_price = last
            state.change_pct = _f(row.get("priceChangePercent"))
            state.quote_volume = _f(row.get("quoteVolume")) or _f(row.get("volume")) * last
            # Числа сделок за сутки BingX не отдаёт - оставляем ноль, а не врём.

    # ── справочник пар ──────────────────────────────────────────────────────

    async def specs(self) -> dict[str, Instrument]:
        """Свойства пар. Кэш живёт в самом клиенте BingX, здесь - ссылка."""
        try:
            self._specs = await load_instruments(await self._get_session())
        except Exception as exc:  # noqa: BLE001 - сеть; отдаём что есть
            logger.warning("Справочник BingX не получен: %s", exc)
        return self._specs

    async def supports(self, symbol: str) -> bool:
        """Есть ли такая пара на бирже.

        Спрашивается до подписки: наборы монет у бирж разные, и ученик,
        открывший монету, которой на BingX нет, должен увидеть подпись, а не
        пустой стакан.
        """
        specs = await self.specs()
        return symbol_id(symbol) in specs

    def listed_symbols(self) -> frozenset[str]:
        """Монеты биржи из уже загруженного справочника, без запроса к ней."""
        return frozenset(symbol_of(name) for name in self._specs)

    # ── пара, открытая в стакане ────────────────────────────────────────────

    async def pin(self, symbol: str) -> None:
        """Открыть поток по паре и держать, пока на неё смотрят."""
        sym = symbol.upper()
        # Монета могла доживать срок после прошлого ухода: поток открыт,
        # история цела - забираем как есть.
        self._linger.keep(sym)
        self._pinned[sym] = self._pinned.get(sym, 0) + 1
        if self._pinned[sym] > 1:
            return

        await self.specs()
        state = self.state.ensure(sym)
        if state.candles is None:
            state.candles = LiveCandles()
        if state.clusters is None:
            state.clusters = ClusterHistory(tick=detect_tick(state.book))
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
        # Не отписываемся сразу: своя лента должна пережить уход, иначе
        # крупную свечу придётся выпрашивать у биржи кусками
        # (backend/scalping/linger.py).
        await self._linger.part(sym)

    async def _forget(self, symbol: str) -> None:
        """Срок вышел: поток закрываем, состояние выбрасываем."""
        await self.stream.unsubscribe(self._args(symbol))
        self.state.drop(symbol)

    @staticmethod
    def _args(symbol: str) -> set[tuple[str, str]]:
        inst = symbol_id(symbol)
        return {(inst, DEPTH_CHANNEL), (inst, TRADES_CHANNEL)}

    def _forget_books(self) -> None:
        """Соединение оборвалось: всё собранное устарело.

        Книга помечается несобранной, и кадр стакана до нового снимка не уходит
        вовсе - лучше подпись «стакан собирается», чем цены минутной давности
        рядом с живой заявкой (ТЗ источников, §4.2).
        """
        for state in self.state.values():
            state.book.reset()

    # ── приём событий потока ────────────────────────────────────────────────

    def _on_message(self, inst: str, channel: str, row: dict) -> None:
        symbol = symbol_of(inst)
        state = self.state.get(symbol)
        if state is None:
            return
        if channel.startswith(TRADES_CHANNEL):
            self._on_trade(state, row)
        elif channel.startswith(DEPTH_CHANNEL) or channel.startswith("depth"):
            self._on_book(state, symbol, row)

    def _on_trade(self, state, row: dict) -> None:
        ts = int(_f(row.get("T") or row.get("time")))
        price = _f(row.get("p") or row.get("price"))
        qty = _f(row.get("q") or row.get("qty"))
        if price <= 0 or qty <= 0:
            return
        # `m` - покупатель был мейкером, то есть по рынку продавали.
        is_buy = not bool(row.get("m"))
        state.tape.add(ts, price, qty, is_buy)
        if state.candles is not None:
            state.candles.add(ts, price, qty)
        if state.clusters is not None:
            if state.clusters.tick <= 0:
                state.clusters.ensure_tick(detect_tick(state.book))
            state.clusters.add(ts, price, qty, is_buy)

    def _on_book(self, state, symbol: str, row: dict) -> None:
        bids, asks = row.get("bids") or [], row.get("asks") or []
        action = str(row.get("action") or "").lower()
        update_id = int(_f(row.get("lastUpdateId"), -1))

        if action == ACTION_SNAPSHOT or not state.book.ready:
            if action != ACTION_SNAPSHOT and not bids and not asks:
                return
            state.book.apply_snapshot(levels(bids), levels(asks), update_id)
            # Снимок пришёл тем же каналом и той же цепочкой, что и дальнейшие
            # изменения, - следующее сообщение продолжает его обычным порядком.
            state.book.synced = True
            state.update_book_ratio(BAND_BP)
            return

        previous = state.book.last_update_id
        if update_id >= 0 and update_id <= previous:
            # Тот же номер или старее - сообщение повторное, книга уже его
            # знает. Пересобирать её из-за дубля значит оставить ученика без
            # стакана на ровном месте.
            return
        if update_id >= 0 and previous >= 0 and update_id != previous + 1:
            # Номер шагнул вперёд больше чем на единицу. Это не потеря
            # сообщения (её этот канал не допускает - см. шапку), а пропуск в
            # нумерации на стороне биржи. Применяем и считаем.
            self.gaps += 1
            if self.gaps % GAP_REPORT == 0:
                logger.info(
                    "Книга BingX: пропусков в нумерации %d, последний %s после %s",
                    self.gaps,
                    update_id,
                    previous,
                )

        applied = state.book.apply_diff(
            {
                "U": previous,
                "u": update_id,
                "pu": previous,
                "b": levels(bids),
                "a": levels(asks),
            }
        )
        if not applied:
            self._resubscribe(symbol)
            return

        state.update_book_ratio(BAND_BP)

    def _resubscribe(self, symbol: str) -> None:
        """Собрать книгу заново: отписка и подписка, снимок придёт сам."""
        self.resyncs += 1
        state = self.state.get(symbol)
        if state is not None:
            state.book.reset()
        args = self._args(symbol)

        async def again() -> None:
            await self.stream.unsubscribe(args)
            await self.stream.subscribe(args)

        asyncio.create_task(again(), name=f"bingx-resync-{symbol}")
