"""Стакан OKX: контракты в монеты, цепочка обновлений, контрольная сумма.

Сети нет: поток подменён, справочник инструментов подставлен руками. Проверяем
то, на чём легко потерять деньги ученика: объём свопа OKX считается в
контрактах, и без перевода плита на экране была бы в сто раз крупнее.
"""

from __future__ import annotations

import pytest

from dataclasses import dataclass

from backend.scalping.market_hub import MarketHub
from backend.scalping.okx_collector import OkxCollector, top_symbols
from core.okx.futures import Instrument

BTC = Instrument(
    inst_id="BTC-USDT-SWAP",
    ct_val=0.01,      # контракт - сотая биткойна
    lot_sz=0.1,
    min_sz=0.1,
    tick_sz=0.1,
    max_leverage=100,
    max_limit_sz=100000,
)


class FakeStream:
    """Запоминает подписки вместо соединения с биржей."""

    def __init__(self) -> None:
        self.args: set[tuple[str, str]] = set()
        self.started = False
        self.on_reset = None

    def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def subscribe(self, args) -> None:
        self.args |= args

    async def unsubscribe(self, args) -> None:
        self.args -= args

    @property
    def connected(self) -> bool:
        return self.started


class FakeRest:
    def __init__(self, tickers: list[dict] | None = None) -> None:
        self._tickers = tickers or []

    async def tickers(self) -> list[dict]:
        return self._tickers


def make_collector(tickers: list[dict] | None = None) -> OkxCollector:
    collector = OkxCollector()
    collector.stream = FakeStream()  # type: ignore[assignment]
    collector.rest = FakeRest(tickers)  # type: ignore[assignment]
    collector._specs = {"BTC-USDT-SWAP": BTC}  # справочник уже приехал
    return collector


def snapshot(seq: int = 100) -> dict:
    return {
        "bids": [["99.9", "10"], ["99.8", "20"]],
        "asks": [["100.1", "10"], ["100.2", "5"]],
        "seqId": seq,
        "prevSeqId": -1,
    }


async def test_snapshot_translates_contracts_to_coins():
    """Десять контрактов BTC - это 0.1 монеты, а не десять."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")

    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot())
    book = collector.state.get("BTCUSDT").book
    assert book.ready
    assert book.bids[99.9] == pytest.approx(0.1)
    assert book.asks[100.1] == pytest.approx(0.1)
    assert book.best_bid == 99.9


async def test_update_continues_the_chain():
    """Обновление продолжает снимок по prevSeqId и меняет уровень."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [["99.9", "30"]], "asks": [], "seqId": 101, "prevSeqId": 100},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.bids[99.9] == pytest.approx(0.3)
    assert book.last_update_id == 101


async def test_gap_in_sequence_resets_the_book():
    """Пропущенное сообщение - книга разошлась: показывать её нельзя."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [["99.9", "30"]], "asks": [], "seqId": 105, "prevSeqId": 104},
    )
    assert collector.state.get("BTCUSDT").book.ready is False


async def test_zero_size_removes_level():
    """Ноль в обновлении - снятие уровня, а не нулевой объём в книге."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [["99.8", "0"]], "asks": [], "seqId": 101, "prevSeqId": 100},
    )
    assert 99.8 not in collector.state.get("BTCUSDT").book.bids


async def test_trade_goes_to_tape_in_coins():
    """Лента считает деньги: объём сделки тоже переводится в монеты."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    state = collector.state.ensure("BTCUSDT")

    collector._on_message(
        "trades",
        "BTC-USDT-SWAP",
        "update",
        {"px": "100", "sz": "50", "side": "buy", "ts": "1757320800000"},
    )
    metrics = state.tape.metrics(1757320800)
    # Пятьдесят контрактов - это половина монеты, то есть пятьдесят долларов.
    assert metrics.delta_notional == pytest.approx(50.0)


def test_dead_checksum_does_not_break_the_book():
    """Ноль в поле суммы - это не поломка книги.

    Биржа объявила контрольную сумму устаревшей: поле осталось, но значение в
    нём всегда ноль. Сверка по нему здесь была, и книга из-за неё пересобиралась
    на каждом сообщении - то есть не собиралась вовсе. Целостность теперь
    проверяется только цепочкой номеров.
    """
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [["99.9", "30"]], "asks": [], "seqId": 101, "prevSeqId": 100, "checksum": 0},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.ready is True
    assert book.last_update_id == 101


async def test_renumbering_after_maintenance_keeps_the_book():
    """Номер уехал назад при целой цепочке - это перенумерация, а не разрыв.

    OKX присылает такое после обслуживания: `prevSeqId` от прошлого сообщения,
    а `seqId` меньше него. Отбросить его как «старое» значило бы застрять на
    прежнем номере и уйти в переподписку на следующем же сообщении.
    """
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [["99.9", "30"]], "asks": [], "seqId": 3, "prevSeqId": 100},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.ready is True
    assert book.last_update_id == 3


async def test_quiet_book_heartbeat_changes_nothing():
    """Пустое сообщение с тем же номером - признак жизни, а не обновление."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))
    before = collector.state.get("BTCUSDT").book.best_bid

    collector._on_message(
        "books",
        "BTC-USDT-SWAP",
        "update",
        {"bids": [], "asks": [], "seqId": 100, "prevSeqId": 100},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.ready is True
    assert book.best_bid == before


def test_instrument_that_cannot_be_traded_is_not_in_the_reference():
    """Остановленный и ещё не открытый контракт в справочник не берём."""
    from core.okx.futures import parse_instrument

    row = {
        "instId": "BTC-USDT-SWAP", "ctVal": "0.01", "lotSz": "1",
        "minSz": "1", "tickSz": "0.1", "lever": "100", "maxLmtSz": "1000",
    }
    assert parse_instrument({**row, "state": "live"}) is not None
    assert parse_instrument({**row, "state": "suspend"}) is None
    assert parse_instrument({**row, "state": "preopen"}) is None
    assert parse_instrument({**row, "state": "test"}) is None
    # Поля нет вовсе - ответ старого образца: справочник не выбрасываем.
    assert parse_instrument(row) is not None


async def test_reset_on_disconnect():
    """Соединение оборвалось - книга не годится: цены могли уйти."""
    collector = make_collector()
    collector._pinned["BTCUSDT"] = 1
    collector.state.ensure("BTCUSDT")
    collector._on_message("books", "BTC-USDT-SWAP", "snapshot", snapshot(100))

    collector._forget_books()
    assert collector.state.get("BTCUSDT").book.ready is False


def test_top_symbols_counts_money_not_coins():
    """Оборот считается в деньгах: иначе первой станет самая дешёвая монета."""
    rows = [
        {"instId": "PEPE-USDT-SWAP", "volCcy24h": "1000000", "last": "0.00001"},
        {"instId": "BTC-USDT-SWAP", "volCcy24h": "1000", "last": "60000"},
        {"instId": "BTC-USDC-SWAP", "volCcy24h": "9999", "last": "60000"},
    ]
    assert top_symbols(rows, 2) == ["BTCUSDT", "PEPEUSDT"]


# ── реестр бирж ─────────────────────────────────────────────────────────────


class FakeCollector:
    """Сборщик, который только помнит, что у него открыли."""

    def __init__(self, exchange: str, known: set[str] | None = None):
        self.exchange = exchange
        self.state = object()
        self.pinned: list[str] = []
        self.unpinned: list[str] = []
        self.started = False
        self._known = known

    def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def pin(self, symbol: str) -> None:
        self.pinned.append(symbol)

    async def unpin(self, symbol: str) -> None:
        self.unpinned.append(symbol)

    async def supports(self, symbol: str) -> bool:
        return self._known is None or symbol in self._known

    def listed_symbols(self) -> frozenset[str]:
        return frozenset(self._known or ())


async def test_hub_gives_own_book_when_exchange_has_symbol():
    primary = FakeCollector("binance")
    okx = FakeCollector("okx", {"BTCUSDT"})
    hub = MarketHub(primary, {"okx": lambda: okx})

    pinned = await hub.pin("okx", "BTCUSDT")
    assert pinned.exchange == "okx"
    assert pinned.fallback is False
    assert okx.pinned == ["BTCUSDT"]
    assert primary.pinned == []
    assert okx.started is True


async def test_hub_falls_back_and_names_the_reason():
    """Монеты на бирже нет - книга общая, но причина названа."""
    primary = FakeCollector("binance")
    okx = FakeCollector("okx", {"BTCUSDT"})
    hub = MarketHub(primary, {"okx": lambda: okx})

    pinned = await hub.pin("okx", "PEPEUSDT")
    assert pinned.exchange == "binance"
    assert pinned.reason == "no_symbol"
    assert pinned.fallback is True
    assert primary.pinned == ["PEPEUSDT"]


async def test_hub_falls_back_for_unknown_exchange():
    primary = FakeCollector("binance")
    hub = MarketHub(primary, {})

    pinned = await hub.pin("weex", "BTCUSDT")
    assert pinned.exchange == "binance"
    assert pinned.reason == "no_feed"


async def test_hub_unpins_on_the_same_exchange():
    primary = FakeCollector("binance")
    okx = FakeCollector("okx", {"BTCUSDT"})
    hub = MarketHub(primary, {"okx": lambda: okx})

    await hub.pin("okx", "BTCUSDT")
    await hub.unpin("okx", "BTCUSDT")
    assert okx.unpinned == ["BTCUSDT"]
    assert primary.unpinned == []


# ── чужие монеты в скринере ─────────────────────────────────────────────────
#
# Список монет идёт с Binance: там все монеты и самый живой объём. Торгует
# ученик у себя, и монету, которой его биржа не знает, до сих пор выдавала
# только подменённая книга после нажатия. Теперь она помечена в списке.


async def test_hub_tells_which_symbols_the_exchange_lists():
    okx = FakeCollector("okx", {"BTCUSDT", "ETHUSDT"})
    hub = MarketHub(FakeCollector("binance"), {"okx": lambda: okx})
    await hub.pin("okx", "BTCUSDT")

    assert hub.listed("okx") == frozenset({"BTCUSDT", "ETHUSDT"})


async def test_hub_says_nothing_until_the_feed_is_up():
    """Сборщик не заведён - состава не знаем. Это не «монет нет»."""
    hub = MarketHub(FakeCollector("binance"), {"okx": lambda: FakeCollector("okx", {"BTCUSDT"})})

    assert hub.listed("okx") is None


async def test_empty_reference_is_not_an_answer():
    """Справочник ещё не пришёл: пометить весь список чужим хуже, чем молчать."""
    okx = FakeCollector("okx", set())
    hub = MarketHub(FakeCollector("binance"), {"okx": lambda: okx})
    await hub.pin("okx", "BTCUSDT")

    assert hub.listed("okx") is None




def test_screener_frame_marks_what_the_exchange_does_not_list():
    from backend.ws.scalping_hub import ScalpingHub

    class State:
        def rows(self, sort: str):
            return [_Row("BTCUSDT"), _Row("PEPEUSDT")]

    class Collector:
        state = State()

    okx = FakeCollector("okx", {"BTCUSDT"})
    hub = ScalpingHub(Collector(), MarketHub(Collector(), {"okx": lambda: okx}))
    hub.market._ensure("okx")

    frame = hub._screener_frame("walls", "okx")
    assert frame["absent"] == ["PEPEUSDT"]
    assert frame["exchange"] == "okx"
    # Без биржи ученика пометки нет вовсе: помечать нечем и незачем.
    assert "absent" not in hub._screener_frame("walls", "")


@dataclass
class _Row:
    """Строка скринера ровно в том объёме, в каком её читает кадр."""

    symbol: str
