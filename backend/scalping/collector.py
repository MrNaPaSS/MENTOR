"""Сборщик рыночных данных для скальпинга.

Держит в памяти топ инструментов по обороту и раздаёт их состояние скринеру и
стакану. Один процесс — один поток к бирже; клиенты в бирже не ходят вовсе.

По каждому инструменту собирается полная книга заявок: снимок по REST плюс
поток изменений. Готового среза верхних уровней не хватает — биржа отдаёт в нём
двадцать уровней, а на инструментах с мелким шагом цены это полоса шириной
меньше базисного пункта (замер по BTC: двадцать уровней укладываются в три
доллара). Плит, ради которых раздел и делается, в такой полосе не видно.

Расход лимита запросов при тридцати инструментах: снимки — 300 весов на полный
пересмотр состава раз в пять минут, суточная сводка — 40 весов раз в десять
секунд. При лимите 2400 в минуту это около десятой части. Поток изменений
лимита не расходует совсем.
"""

from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from backend.scalping.binance import BinanceRest, StreamClient
from backend.scalping.state import BAND_BP, MarketState

logger = logging.getLogger("nmnh.scalping")

DEFAULT_TOP_N = 30
TICKER_INTERVAL = 10.0      # обновление суточной сводки, секунды
ROTATE_INTERVAL = 300.0     # пересмотр состава топа, секунды
PRUNE_INTERVAL = 30.0       # чистка книг от далёких уровней, секунды

SNAPSHOT_LIMIT = 500        # уровней в снимке инструмента из списка
SNAPSHOT_LIMIT_PINNED = 1000  # для инструмента, открытого в стакане

# Полоса, за пределами которой уровни выбрасываются. Шире рабочей полосы метрик
# (25 б.п.) — стакану нужен запас для прокрутки, — но ненамного: поток приносит
# уровни за проценты от цены и снятия по ним не присылает, поэтому без чистки
# книга росла на 180 уровней за двадцать секунд наблюдения.
KEEP_BAND_BP = 60.0

QUOTE_SUFFIX = "USDT"


def top_symbols(tickers: list[dict], limit: int) -> list[str]:
    """Отобрать инструменты с наибольшим суточным оборотом.

    Берём только пары к USDT: остальное либо неликвидно, либо считается в
    другой валюте и несопоставимо по обороту.
    """
    rows: list[tuple[float, str]] = []
    for t in tickers:
        symbol = str(t.get("symbol") or "")
        if not symbol.endswith(QUOTE_SUFFIX):
            continue
        try:
            volume = float(t.get("quoteVolume") or 0)
        except (TypeError, ValueError):
            continue
        rows.append((volume, symbol))
    rows.sort(reverse=True)
    return [s for _, s in rows[:limit]]


class ScalpingCollector:
    """Фоновый сбор данных: поток биржи, состояние в памяти, состав топа."""

    def __init__(
        self,
        state: MarketState | None = None,
        top_n: int = DEFAULT_TOP_N,
        ticker_interval: float = TICKER_INTERVAL,
        rotate_interval: float = ROTATE_INTERVAL,
    ):
        self.state = state or MarketState()
        self.top_n = top_n
        self.ticker_interval = ticker_interval
        self.rotate_interval = rotate_interval

        self._session: aiohttp.ClientSession | None = None
        self.rest = BinanceRest(self._get_session)
        self.stream = StreamClient(self._on_message)

        self._tracked: set[str] = set()             # инструменты под наблюдением
        self._pinned: dict[str, int] = {}           # символ → сколько клиентов смотрят стакан
        self._buffers: dict[str, list[dict]] = {}   # события во время пересборки книги
        self._resyncing: set[str] = set()
        self._task: asyncio.Task | None = None

    @property
    def tracked(self) -> frozenset[str]:
        return frozenset(self._tracked)

    # ── жизненный цикл ──────────────────────────────────────────────────────

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="scalping-collector")
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

    async def _loop(self) -> None:
        """Суточная сводка обновляется часто, состав топа — редко.

        Состав нельзя пересматривать на каждом обновлении: инструменты на
        границе топа менялись бы местами каждые десять секунд, и подписки
        дёргались бы впустую.
        """
        last_rotate = 0.0
        last_prune = 0.0
        while True:
            try:
                now = time.monotonic()
                tickers = await self.rest.tickers_24h()
                if tickers:
                    if not self._tracked or now - last_rotate >= self.rotate_interval:
                        await self._rotate(tickers)
                        last_rotate = now
                    self._apply_tickers(tickers)
                if now - last_prune >= PRUNE_INTERVAL:
                    self._prune_books()
                    last_prune = now
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Сбой цикла сбора: %s", exc)
            await asyncio.sleep(self.ticker_interval)

    def _prune_books(self) -> None:
        """Выбросить далёкие уровни: без чистки книги растут неограниченно."""
        removed = sum(s.book.prune(KEEP_BAND_BP) for s in self.state.values())
        if removed:
            logger.debug("Из книг убрано далёких уровней: %d", removed)

    # ── состав наблюдаемых инструментов ─────────────────────────────────────

    async def _rotate(self, tickers: list[dict]) -> None:
        """Пересобрать список наблюдаемых инструментов и подписки под него."""
        wanted = set(top_symbols(tickers, self.top_n))
        # Открытый у кого-то стакан из наблюдения не убираем, даже если
        # инструмент вылетел из топа: у клиента он сейчас на экране.
        wanted |= set(self._pinned)

        for symbol in sorted(wanted - self._tracked):
            await self._track(symbol)
        for symbol in sorted(self._tracked - wanted):
            await self._untrack(symbol)

    async def _track(self, symbol: str) -> None:
        """Взять инструмент под наблюдение: подписка и первичный снимок."""
        self._tracked.add(symbol)
        self.state.ensure(symbol)
        # Буфер заводим до подписки: события приходят раньше, чем ответит REST,
        # и без буфера в книге осталась бы дыра длиной в запрос.
        self._resyncing.add(symbol)
        self._buffers[symbol] = []
        await self.stream.subscribe(self._streams(symbol))
        await self._resync(symbol)

    async def _untrack(self, symbol: str) -> None:
        self._tracked.discard(symbol)
        await self.stream.unsubscribe(self._streams(symbol))
        self.state.drop(symbol)

    def _apply_tickers(self, tickers: list[dict]) -> None:
        """Разложить суточную сводку по наблюдаемым инструментам."""
        for t in tickers:
            state = self.state.get(str(t.get("symbol") or ""))
            if state is None:
                continue
            state.last_price = _f(t.get("lastPrice"))
            state.change_pct = _f(t.get("priceChangePercent"))
            state.quote_volume = _f(t.get("quoteVolume"))
            state.trade_count = int(_f(t.get("count")))

    @staticmethod
    def _streams(symbol: str) -> set[str]:
        s = symbol.lower()
        return {f"{s}@depth@100ms", f"{s}@trade"}

    # ── инструмент, открытый в стакане ──────────────────────────────────────

    async def pin(self, symbol: str) -> None:
        """Удержать инструмент под наблюдением, даже если он вне топа."""
        sym = symbol.upper()
        self._pinned[sym] = self._pinned.get(sym, 0) + 1
        if sym not in self._tracked:
            await self._track(sym)

    async def unpin(self, symbol: str) -> None:
        """Последний клиент ушёл — инструмент снова живёт по правилам топа."""
        sym = symbol.upper()
        left = self._pinned.get(sym, 0) - 1
        if left > 0:
            self._pinned[sym] = left
        else:
            self._pinned.pop(sym, None)

    # ── синхронизация книги ─────────────────────────────────────────────────

    async def _resync(self, symbol: str) -> None:
        """Пересобрать книгу со снимка, не потеряв события во время запроса."""
        self._resyncing.add(symbol)
        self._buffers.setdefault(symbol, [])
        try:
            state = self.state.ensure(symbol)
            state.book.reset()
            limit = SNAPSHOT_LIMIT_PINNED if symbol in self._pinned else SNAPSHOT_LIMIT
            snapshot = await self.rest.depth(symbol, limit)
            if not snapshot:
                logger.warning("Снимок стакана %s не получен", symbol)
                return
            state.book.apply_snapshot(
                snapshot.get("bids") or [],
                snapshot.get("asks") or [],
                int(snapshot.get("lastUpdateId") or 0),
            )
            for event in self._buffers.get(symbol, []):
                # Разрыв внутри буфера чинить нечем — следующее событие потока
                # придёт через 100 мс и запустит пересборку заново.
                if not state.book.apply_diff(event):
                    break
        finally:
            self._buffers.pop(symbol, None)
            self._resyncing.discard(symbol)

    def _schedule_resync(self, symbol: str) -> None:
        if symbol in self._resyncing:
            return
        logger.info("Стакан %s рассинхронизирован — пересобираем", symbol)
        self._resyncing.add(symbol)   # помечаем сразу, чтобы события буферизовались
        self._buffers[symbol] = []
        asyncio.create_task(self._resync(symbol), name=f"resync-{symbol}")

    # ── приём событий потока ────────────────────────────────────────────────

    def _on_message(self, stream: str, data: dict) -> None:
        symbol = str(data.get("s") or "").upper()
        if not symbol:
            return
        state = self.state.get(symbol)
        if state is None:
            return

        if stream.endswith("@trade"):
            state.tape.add(
                int(data.get("T") or 0),
                _f(data.get("p")),
                _f(data.get("q")),
                # m=true — покупатель стоял лимитом, значит по рынку бил продавец.
                not bool(data.get("m", True)),
            )
        elif "@depth@" in stream:
            if symbol in self._resyncing:
                self._buffers.setdefault(symbol, []).append(data)
            elif state.book.apply_diff(data):
                state.update_book_ratio(BAND_BP)
            else:
                self._schedule_resync(symbol)


def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
