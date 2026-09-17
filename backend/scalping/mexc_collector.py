"""Сбор стакана и ленты MEXC: книга той биржи, на которой торгует ученик.

Устроен как сборщик OKX - с тем же слоем перевода контрактов в монеты, - но
цепочка книги здесь своя и она строже всех четырёх бирж:

* **снимок берётся запросом** (`/contract/depth/{symbol}`), и у него есть номер
  `version`;
* **каждое сообщение несёт диапазон версий**, а не одну: `begin` - первая в
  нём, `end` - последняя, и она же `version`. Непрерывность проверяется по
  началу диапазона: следующее сообщение обязано начинаться там, где кончилось
  предыдущее (`begin == previous + 1`).

  Смотреть на одну `version`, как поначалу делали мы, нельзя: за минуту на
  BTC_USDT она шагает через десятки и сотни номеров - внутри сообщения. Живой
  пробник насчитал так 289 «разрывов» и девять пересборок книги на ровном
  месте (14 сентября 2026); по диапазону разрывов нет вовсе;
* **разрыв догоняется коммитами** (`/contract/depth_commits/{symbol}/1000` -
  последняя тысяча изменений по возрастанию версии), а не пересборкой книги
  снимком. Это дешевле и быстрее: ученик не видит подписи «стакан собирается»
  там, где хватило одного запроса. Не хватило коммитов - тогда снимок.

Объём биржа называет в контрактах. В книгу он кладётся **в монетах**: иначе
метрики, плиты и лента посчитают чужие деньги - у `BTC_USDT` контракт равен
0.0001 BTC, то есть числа разошлись бы в десять тысяч раз (ТЗ MEXC, §4.2).

Поток по требованию: пара подписывается, когда её открыл хотя бы один ученик, и
отписывается, когда ушёл последний. Постоянно книгу держит только Binance - с
неё идёт скринер (ТЗ мультибиржи, §10.3).
"""

from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from backend.scalping.candles import LiveCandles
from backend.scalping.clusters import ClusterHistory
from backend.scalping.ladder import detect_tick
from backend.scalping.linger import (
    Linger,
    LINGER_LIMIT_STREAM,
    LINGER_SECONDS_STREAM,
)
from backend.scalping.mexc import (
    DEPTH_CHANNEL,
    TRADES_CHANNEL,
    MexcPublicRest,
    MexcStreamClient,
)
from backend.scalping.state import BAND_BP, MarketState
from core.mexc.market import Instrument, load_instruments, symbol_id, symbol_of

logger = logging.getLogger("nmnh.scalping.mexc")

EXCHANGE = "mexc"

# Как часто обновляется суточная сводка. Как у остальных бирж: цена в кадре
# стакана приходит из книги, сводка нужна для подписи и метрик скринера.
TICKER_INTERVAL = 10.0

# Полоса, за пределами которой уровни выбрасываются, базисные пункты.
KEEP_BAND_BP = 60.0
PRUNE_INTERVAL = 30.0

# Сколько изменений просим у биржи, догоняя разрыв. Тысяча - её потолок.
COMMITS_LIMIT = 1000

# Глубина снимка. Столько же уровней отдаёт поток.
DEPTH_LIMIT = 1000

# Сколько сообщений копим, пока идёт снимок. Больше - значит снимок безнадёжно
# отстал, и копить дальше незачем: возьмём новый.
PENDING_LIMIT = 500


def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def span(row: dict) -> tuple[int, int]:
    """Диапазон версий сообщения: первая и последняя.

    Биржа называет их `begin` и `end`, а `version` повторяет `end`. Полей может
    не быть вовсе - у снимка по REST есть только `version`; тогда диапазон
    вырождается в одну версию, и правило непрерывности сходится к прежнему.
    """
    end = int(_f(row.get("end") or row.get("version"), -1))
    begin = int(_f(row.get("begin"), end))
    return begin, end


def top_symbols(tickers: list[dict], limit: int) -> list[str]:
    """Пары с наибольшим суточным оборотом в деньгах.

    Оборот MEXC называет сама (`amount24`); если его нет - считаем по объёму и
    цене, иначе первой в списке окажется самая дешёвая монета.
    """
    rows: list[tuple[float, str]] = []
    for row in tickers:
        name = str(row.get("symbol") or "").upper()
        if not name.endswith("_USDT"):
            continue
        turnover = _f(row.get("amount24")) or _f(row.get("volume24")) * _f(row.get("lastPrice"))
        rows.append((turnover, symbol_of(name)))
    rows.sort(reverse=True)
    return [symbol for _, symbol in rows[:limit]]


def levels(rows: list, contract_size: float) -> list[list[float]]:
    """Уровни биржи в наш вид, с переводом контрактов в монеты.

    Строка уровня у MEXC - `[цена, объём в контрактах, число заявок]`. Ноль
    объёма означает снятие уровня и обязан дойти нулём: иначе снятая плита
    останется в книге навсегда.
    """
    out: list[list[float]] = []
    for row in rows or []:
        try:
            price, contracts = float(row[0]), float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        size = contracts * contract_size if contracts > 0 else 0.0
        out.append([price, round(size, 10)])
    return out


class MexcCollector:
    """Книга и лента MEXC по тем парам, что открыты у учеников."""

    exchange = EXCHANGE

    def __init__(self, state: MarketState | None = None, ticker_interval: float = TICKER_INTERVAL):
        self.state = state or MarketState()
        self.ticker_interval = ticker_interval

        self._session: aiohttp.ClientSession | None = None
        self.rest = MexcPublicRest(self._get_session)
        self.stream = MexcStreamClient(self._on_message)
        self.stream.on_reset = self._forget_books

        self._pinned: dict[str, int] = {}        # символ -> сколько клиентов смотрят
        self._specs: dict[str, Instrument] = {}  # BTC_USDT -> свойства пары
        # Закрытая монета отпускается не сразу: вернутся внутри срока -
        # своя лента цела и профиль крупной свечи собран нами.
        self._linger = Linger(
            self._forget, delay=LINGER_SECONDS_STREAM, limit=LINGER_LIMIT_STREAM
        )
        self._task: asyncio.Task | None = None
        # Сообщения, пришедшие, пока снимок ещё едет: применим их следом, иначе
        # книга начнётся с дыры длиной в запрос.
        self._pending: dict[str, list[dict]] = {}
        self._syncing: set[str] = set()
        # Разрывы цепочки и то, чем их залечили. Не отладка: по этим числам
        # видно, живёт ли книга и не дороже ли она, чем должна быть.
        self.gaps = 0
        self.commits = 0
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
            self._task = asyncio.create_task(self._loop(), name="mexc-collector")
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
                logger.warning("Сбой цикла сбора MEXC: %s", exc)
            await asyncio.sleep(self.ticker_interval)

    async def _apply_tickers(self) -> None:
        rows = await self.rest.tickers()
        for row in rows:
            name = str(row.get("symbol") or "").upper()
            state = self.state.get(symbol_of(name))
            if state is None:
                continue
            last = _f(row.get("lastPrice"))
            state.last_price = last
            # Суточное изменение биржа даёт долей единицы, а терминал считает
            # процентами.
            state.change_pct = _f(row.get("riseFallRate")) * 100
            state.quote_volume = _f(row.get("amount24")) or _f(row.get("volume24")) * last

    # ── справочник пар ──────────────────────────────────────────────────────

    async def specs(self) -> dict[str, Instrument]:
        """Свойства пар. Кэш живёт в самом клиенте MEXC, здесь - ссылка."""
        try:
            self._specs = await load_instruments(await self._get_session())
        except Exception as exc:  # noqa: BLE001 - сеть; отдаём что есть
            logger.warning("Справочник MEXC не получен: %s", exc)
        return self._specs

    async def supports(self, symbol: str) -> bool:
        """Есть ли такая пара на бирже.

        Спрашивается до подписки: наборы монет у бирж разные, и ученик,
        открывший монету, которой на MEXC нет, должен увидеть подпись, а не
        пустой стакан.
        """
        specs = await self.specs()
        return symbol_id(symbol) in specs

    def listed_symbols(self) -> frozenset[str]:
        """Монеты биржи из уже загруженного справочника, без запроса к ней."""
        return frozenset(symbol_of(name) for name in self._specs)

    def _contract_size(self, symbol: str) -> float:
        """Размер контракта пары. Не знаем - единица: лучше не соврать в разы."""
        spec = self._specs.get(symbol_id(symbol))
        return spec.contract_size if spec else 1.0

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
        # Снимок берём сразу: канал его не присылает, а до него применять
        # нечего.
        self._resync(sym)

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
        self._pending.pop(symbol, None)
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
        self._pending.clear()
        for state in self.state.values():
            state.book.reset()
        # Доживающие монеты тоже: их ленту мы пишем, и книга нужна целой.
        for symbol in list(self._pinned) + list(self._linger.symbols):
            self._resync(symbol)

    # ── приём событий потока ────────────────────────────────────────────────

    def _on_message(self, inst: str, channel: str, row: dict) -> None:
        symbol = symbol_of(inst)
        state = self.state.get(symbol)
        if state is None:
            return
        if channel.startswith(TRADES_CHANNEL):
            self._on_trade(state, symbol, row)
        elif channel.startswith(DEPTH_CHANNEL):
            self._on_book(state, symbol, row)

    def _on_trade(self, state, symbol: str, row: dict) -> None:
        """Сделка из ленты. Поля короткие: `p` цена, `v` объём, `T` сторона."""
        ts = int(_f(row.get("t") or row.get("time")))
        price = _f(row.get("p"))
        contracts = _f(row.get("v"))
        if price <= 0 or contracts <= 0:
            return
        qty = round(contracts * self._contract_size(symbol), 10)
        # `T`: 1 - покупка по рынку, 2 - продажа.
        is_buy = int(_f(row.get("T"), 1)) == 1
        state.tape.add(ts, price, qty, is_buy)
        if state.candles is not None:
            state.candles.add(ts, price, qty)
        if state.clusters is not None:
            if state.clusters.tick <= 0:
                state.clusters.ensure_tick(detect_tick(state.book))
            state.clusters.add(ts, price, qty, is_buy)

    def _on_book(self, state, symbol: str, row: dict) -> None:
        """Изменение книги. Применяется, только если продолжает цепочку версий."""
        begin, end = span(row)
        if not state.book.ready:
            # Снимок ещё не пришёл: копим изменения, чтобы применить их следом
            # и не начать книгу с дыры длиной в запрос.
            self._hold(symbol, row)
            return

        previous = state.book.last_update_id
        if end >= 0 and end <= previous:
            # Диапазон целиком старше нашего - изменение уже учтено снимком.
            return
        if begin >= 0 and previous >= 0 and begin > previous + 1:
            # Настоящий разрыв: между нашей версией и началом этого сообщения
            # есть номера, которых мы не видели. Догоняем коммитами -
            # пересобирать книгу снимком дороже, а ученик в это время смотрит
            # на подпись «стакан собирается».
            self.gaps += 1
            self._catch_up(symbol, previous)
            self._hold(symbol, row)
            return

        self._apply(state, symbol, row, end, previous)

    def _apply(self, state, symbol: str, row: dict, version: int, previous: int) -> None:
        size = self._contract_size(symbol)
        applied = state.book.apply_diff(
            {
                "U": previous,
                "u": version,
                "pu": previous,
                "b": levels(row.get("bids"), size),
                "a": levels(row.get("asks"), size),
            }
        )
        if not applied:
            self._resync(symbol)
            return
        state.update_book_ratio(BAND_BP)

    def _hold(self, symbol: str, row: dict) -> None:
        """Придержать изменение до снимка. Переполнилось - снимок безнадёжно стар."""
        rows = self._pending.setdefault(symbol, [])
        rows.append(row)
        if len(rows) > PENDING_LIMIT:
            self._pending[symbol] = rows[-PENDING_LIMIT:]

    def _drain(self, symbol: str) -> None:
        """Применить придержанные изменения поверх свежего снимка."""
        state = self.state.get(symbol)
        rows = self._pending.pop(symbol, [])
        if state is None or not state.book.ready:
            return
        for row in sorted(rows, key=lambda one: _f(one.get("version"))):
            begin, end = span(row)
            previous = state.book.last_update_id
            if end >= 0 and end <= previous:
                continue
            if begin >= 0 and previous >= 0 and begin > previous + 1:
                # Между снимком и этим изменением всё ещё дыра: дальше применять
                # нечего, книгу догонит следующий круг коммитов.
                self.gaps += 1
                return
            self._apply(state, symbol, row, end, previous)

    # ── восстановление цепочки ──────────────────────────────────────────────

    def _catch_up(self, symbol: str, previous: int) -> None:
        """Догнать пропущенные изменения коммитами, а не пересборкой книги."""
        if symbol in self._syncing:
            return
        self._syncing.add(symbol)
        asyncio.create_task(self._catch_up_task(symbol, previous), name=f"mexc-commits-{symbol}")

    async def _catch_up_task(self, symbol: str, previous: int) -> None:
        try:
            rows = await self.rest.depth_commits(symbol_id(symbol), COMMITS_LIMIT)
            state = self.state.get(symbol)
            if state is None or not state.book.ready:
                return
            applied = 0
            for row in sorted(rows, key=lambda one: _f(one.get("version"))):
                begin, end = span(row)
                current = state.book.last_update_id
                if end <= current:
                    continue
                if begin > current + 1:
                    # Коммитов не хватило: дыра шире тысячи изменений - тогда
                    # честнее собрать книгу заново.
                    await self._snapshot(symbol)
                    return
                self._apply(state, symbol, row, end, current)
                applied += 1
            if applied:
                self.commits += 1
                logger.debug("Книга MEXC %s догнана коммитами: %d изменений", symbol, applied)
            else:
                await self._snapshot(symbol)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Коммиты книги MEXC %s не получены: %s", symbol, exc)
            await self._snapshot(symbol)
        finally:
            self._syncing.discard(symbol)
            self._drain(symbol)

    def _resync(self, symbol: str) -> None:
        """Собрать книгу заново снимком."""
        if symbol in self._syncing:
            return
        self._syncing.add(symbol)

        async def again() -> None:
            try:
                await self._snapshot(symbol)
            finally:
                self._syncing.discard(symbol)
                self._drain(symbol)

        asyncio.create_task(again(), name=f"mexc-resync-{symbol}")

    async def _snapshot(self, symbol: str) -> None:
        """Снимок книги запросом. У него есть номер - с него идёт цепочка."""
        self.resyncs += 1
        data = await self.rest.depth(symbol_id(symbol), DEPTH_LIMIT)
        state = self.state.get(symbol)
        if state is None:
            return
        version = int(_f(data.get("version"), -1))
        if version < 0:
            logger.warning("Снимок книги MEXC %s пришёл без номера версии", symbol)
            return
        size = self._contract_size(symbol)
        state.book.apply_snapshot(
            levels(data.get("bids"), size), levels(data.get("asks"), size), version
        )
        # Снимок и поток идут одной нумерацией биржи: следующее сообщение
        # продолжает его обычным порядком, и накрывать снимок ему не нужно.
        state.book.synced = True
        state.update_book_ratio(BAND_BP)
