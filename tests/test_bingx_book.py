"""Стакан и лента BingX: цепочка обновлений, сжатие и ответ на Ping.

Сети нет: поток подменён, справочник пар подставлен руками. Проверяем то, без
чего книга либо не соберётся вовсе (сжатие, `Pong`, подписка сообщением на
канал), либо разойдётся с биржей незаметно - непрерывность по `lastUpdateId`.
"""

from __future__ import annotations

import gzip
import json

import pytest

from backend.scalping.bingx import BingxStreamClient, split_type, unpack
from backend.scalping.bingx_collector import BingxCollector, top_symbols
from backend.scalping.market_hub import MarketHub
from core.bingx.futures import Instrument

BTC = Instrument(
    symbol="BTC-USDT",
    quantity_precision=4,
    price_precision=1,
    min_qty=0.0001,
    min_notional=2.0,
    taker=0.0005,
    maker=0.0002,
    max_leverage=125,
    status=1,
    api_open=True,
    api_close=True,
    broker_closed=False,
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


def make_collector(tickers: list[dict] | None = None) -> BingxCollector:
    collector = BingxCollector()
    collector.stream = FakeStream()  # type: ignore[assignment]
    collector.rest = FakeRest(tickers)  # type: ignore[assignment]
    collector._specs = {"BTC-USDT": BTC}  # справочник уже приехал

    async def specs() -> dict:
        """Справочник не спрашиваем: тест не ходит на биржу."""
        return collector._specs

    collector.specs = specs  # type: ignore[assignment]
    return collector


def opened(collector: BingxCollector, symbol: str = "BTCUSDT"):
    collector._pinned[symbol] = 1
    return collector.state.ensure(symbol)


def snapshot(update_id: int = 100) -> dict:
    return {
        "action": "all",
        "lastUpdateId": update_id,
        "bids": [["99.9", "10"], ["99.8", "20"]],
        "asks": [["100.1", "10"], ["100.2", "5"]],
    }


# ── книга ────────────────────────────────────────────────────────────────────


def test_snapshot_fills_the_book_in_coins():
    """Объём BingX считает в монетах - переводить нечего, и это главное."""
    collector = make_collector()
    opened(collector)

    collector._on_message("BTC-USDT", "incrDepth", snapshot())
    book = collector.state.get("BTCUSDT").book
    assert book.ready
    assert book.bids[99.9] == pytest.approx(10)
    assert book.asks[100.1] == pytest.approx(10)
    assert book.best_bid == 99.9


def test_update_continues_the_chain_by_one():
    collector = make_collector()
    opened(collector)
    collector._on_message("BTC-USDT", "incrDepth", snapshot(100))

    collector._on_message(
        "BTC-USDT",
        "incrDepth",
        {"action": "update", "lastUpdateId": 101, "bids": [["99.9", "30"]], "asks": []},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.bids[99.9] == pytest.approx(30)
    assert book.last_update_id == 101


def test_gap_in_numbering_is_applied_and_counted():
    """Пропуск в номерах - счётчик биржи, а не потеря сообщения.

    Живая биржа шаг в единицу не держит: на BTC-USDT попадаются шаги в два-три
    номера, десяток за минуту. Пересборка на каждом означала бы подпись «стакан
    собирается» вместо стакана. Потерять сообщение канал не может - он поверх
    TCP, - поэтому обновление применяем, а пропуск считаем.
    """
    collector = make_collector()
    opened(collector)
    collector._on_message("BTC-USDT", "incrDepth", snapshot(100))

    collector._on_message(
        "BTC-USDT",
        "incrDepth",
        {"action": "update", "lastUpdateId": 105, "bids": [["99.9", "30"]], "asks": []},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.ready is True
    assert book.bids[99.9] == pytest.approx(30)
    assert book.last_update_id == 105
    assert collector.gaps == 1
    assert collector.resyncs == 0


def test_repeated_message_is_not_a_gap():
    """Тот же номер - повтор, а не разрыв: пересобирать книгу незачем."""
    collector = make_collector()
    opened(collector)
    collector._on_message("BTC-USDT", "incrDepth", snapshot(100))

    collector._on_message(
        "BTC-USDT",
        "incrDepth",
        {"action": "update", "lastUpdateId": 100, "bids": [["99.9", "77"]], "asks": []},
    )
    book = collector.state.get("BTCUSDT").book
    assert book.ready is True
    assert book.bids[99.9] == pytest.approx(10)


def test_zero_size_removes_level():
    collector = make_collector()
    opened(collector)
    collector._on_message("BTC-USDT", "incrDepth", snapshot(100))

    collector._on_message(
        "BTC-USDT",
        "incrDepth",
        {"action": "update", "lastUpdateId": 101, "bids": [["99.8", "0"]], "asks": []},
    )
    assert 99.8 not in collector.state.get("BTCUSDT").book.bids


def test_broken_connection_leaves_no_stale_book():
    """Обрыв - книга несобрана, и кадр стакана до нового снимка не уходит."""
    collector = make_collector()
    opened(collector)
    collector._on_message("BTC-USDT", "incrDepth", snapshot(100))

    collector._forget_books()
    assert collector.state.get("BTCUSDT").book.ready is False


def test_trade_goes_to_tape_with_the_taker_side():
    collector = make_collector()
    state = opened(collector)

    collector._on_message(
        "BTC-USDT",
        "trade",
        {"T": 1757320800000, "p": "100", "q": "0.5", "m": False},
    )
    metrics = state.tape.metrics(1757320800)
    # `m` ложно - покупал тейкер: пятьдесят долларов на стороне покупки.
    assert metrics.delta_notional == pytest.approx(50.0)


def test_top_symbols_are_sorted_by_money():
    rows = [
        {"symbol": "BTC-USDT", "quoteVolume": "1000000", "lastPrice": "80000"},
        {"symbol": "PEPE-USDT", "quoteVolume": "5000000", "lastPrice": "0.00001"},
        {"symbol": "ETH-USD", "quoteVolume": "9000000"},
    ]
    assert top_symbols(rows, 5) == ["PEPEUSDT", "BTCUSDT"]


async def test_pin_subscribes_to_book_and_tape():
    collector = make_collector()
    await collector.pin("BTCUSDT")
    assert collector.stream.args == {("BTC-USDT", "incrDepth"), ("BTC-USDT", "trade")}

    await collector.unpin("BTCUSDT")
    assert collector.stream.args == set()
    assert collector.state.get("BTCUSDT") is None


async def test_hub_gives_bingx_book_to_a_bingx_trader():
    """Реестр включает биржу по факту открытого стакана, а не заранее."""
    collector = make_collector()
    collector._specs = {"BTC-USDT": BTC}
    hub = MarketHub(None, {"bingx": lambda: collector})

    pinned = await hub.pin("bingx", "BTCUSDT")
    assert pinned.exchange == "bingx"
    assert pinned.fallback is False
    assert collector.tracked == frozenset({"BTCUSDT"})


async def test_symbol_missing_on_bingx_falls_back_with_a_reason():
    collector = make_collector()

    class Primary:
        def __init__(self) -> None:
            self.pinned: list[str] = []

        async def pin(self, symbol: str) -> None:
            self.pinned.append(symbol)

    primary = Primary()
    hub = MarketHub(primary, {"bingx": lambda: collector})

    pinned = await hub.pin("bingx", "NOPEUSDT")
    assert pinned.exchange == "binance"
    assert pinned.reason == "no_symbol"
    assert primary.pinned == ["NOPEUSDT"]


# ── поток ────────────────────────────────────────────────────────────────────


def test_messages_arrive_compressed():
    """Сообщения BingX сжаты: без распаковки поток не работает вовсе."""
    raw = gzip.compress(b'{"dataType":"BTC-USDT@trade"}')
    assert unpack(raw) == '{"dataType":"BTC-USDT@trade"}'
    # Несжатое управляющее сообщение проходит как есть.
    assert unpack(b"Ping") == "Ping"
    assert unpack("Ping") == "Ping"


def test_data_type_is_split_into_pair_and_channel():
    assert split_type("BTC-USDT@incrDepth") == ("BTC-USDT", "incrDepth")
    assert split_type("мусор") == ("", "")


class FakeWs:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send_str(self, text: str) -> None:
        self.sent.append(text)

    async def send_json(self, payload) -> None:
        self.sent.append(json.dumps(payload))


async def test_ping_is_answered_with_pong():
    """Без ответа биржа закрывает соединение - и стакан гаснет молча."""
    stream = BingxStreamClient(lambda *_: None)
    ws = FakeWs()
    assert await stream._heartbeat(ws, "Ping") is True
    assert ws.sent == ["Pong"]
    assert await stream._heartbeat(ws, '{"dataType":"x"}') is False


async def test_subscription_goes_one_message_per_channel():
    """Пачкой BingX подписки не принимает - только по сообщению на канал."""
    stream = BingxStreamClient(lambda *_: None)
    ws = FakeWs()
    stream._ws = ws  # type: ignore[assignment]
    await stream.subscribe({("BTC-USDT", "incrDepth"), ("BTC-USDT", "trade")})

    payloads = [json.loads(one) for one in ws.sent]
    assert {p["dataType"] for p in payloads} == {"BTC-USDT@incrDepth", "BTC-USDT@trade"}
    assert {p["reqType"] for p in payloads} == {"sub"}
    assert len({p["id"] for p in payloads}) == 2


def test_dispatch_hands_over_pair_channel_and_row():
    seen: list[tuple] = []
    stream = BingxStreamClient(lambda inst, channel, row: seen.append((inst, channel, row)))
    stream._dispatch(
        json.dumps(
            {
                "code": 0,
                "dataType": "BTC-USDT@incrDepth",
                "data": {"action": "all", "lastUpdateId": 5, "bids": [], "asks": []},
            }
        )
    )
    assert seen and seen[0][0] == "BTC-USDT" and seen[0][1] == "incrDepth"
    assert seen[0][2]["lastUpdateId"] == 5
