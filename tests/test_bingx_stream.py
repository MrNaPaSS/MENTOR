"""Приватный поток BingX: снимок, события счёта и связь условных заявок.

Сети нет: снимок позиций подменён, сообщения подаются прямо в разбор. Здесь
проверяется то, чем этот поток отличается от потока OKX и чем опасен:

* снимка позиций канал не даёт, и до запроса поток себя живым не считает -
  иначе пустой список сопровождение приняло бы за закрытую сделку;
* сообщения сжаты, а на текстовый `Ping` надо ответить `Pong`;
* у стопов и целей нет нашего идентификатора, и `o.ti` - единственное, чем
  биржа связывает защиту со входом (ТЗ BingX, §3.2).
"""

from __future__ import annotations

import gzip
import json

import pytest

from core.bingx.stream import BingxPrivateStream, account_positions, order_event, urls
from core.weex.futures import Credentials

POSITION = {
    "symbol": "BTCUSDT",
    "instId": "BTC-USDT",
    "side": "LONG",
    "positionSide": "LONG",
    "size": "0.5",
    "averageOpenPrice": "80000",
}


class FakeWs:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send_str(self, text: str) -> None:
        self.sent.append(text)


def make_stream(rows: list[dict] | None = None, **kw) -> BingxPrivateStream:
    async def snapshot() -> list[dict]:
        return list(rows or [])

    return BingxPrivateStream(Credentials("key", "secret", ""), snapshot, **kw)


# ── ключ и адрес ─────────────────────────────────────────────────────────────


def test_key_goes_into_the_address_as_a_parameter():
    """Ключ идёт параметром: с ключом в пути биржа отвечает 403.

    Проверено на живом демо-счёте. Второе написание оставлено запасным - на
    случай, если биржа передумает, - но первым пробуем рабочее.
    """
    first, spare = urls(False, "abc123")
    assert first.endswith("?listenKey=abc123")
    assert spare.endswith("/abc123")
    assert urls(True, "abc123")[0].startswith("wss://vst-")


# ── снимок ───────────────────────────────────────────────────────────────────


async def test_stream_is_not_alive_until_the_snapshot_arrives():
    """Пустой список позиций сопровождение приняло бы за закрытую сделку."""
    stream = make_stream([POSITION])
    assert stream.ready is False
    assert stream.positions() == []

    await stream._take_snapshot()
    assert stream.positions() == [POSITION]
    # Сокета нет - и живым поток себя всё равно не считает.
    assert stream.ready is False


async def test_failed_snapshot_leaves_the_stream_untrusted():
    async def broken() -> list[dict]:
        raise RuntimeError("биржа молчит")

    stream = BingxPrivateStream(Credentials("key", "secret", ""), broken)
    await stream._take_snapshot()
    assert stream.ready is False
    assert stream.positions() == []


# ── события счёта ────────────────────────────────────────────────────────────


def test_account_event_reads_short_field_names():
    event = {
        "e": "ACCOUNT_UPDATE",
        "a": {
            "B": [{"a": "USDT", "wb": "1000"}],
            "P": [{"s": "BTC-USDT", "pa": "0.7", "ep": "80000", "up": "5", "ps": "LONG"}],
        },
    }
    rows = account_positions(event)
    assert rows == [
        {
            "symbol": "BTC-USDT",
            "positionAmt": "0.7",
            "avgPrice": "80000",
            "unrealizedProfit": "5",
            "positionSide": "LONG",
            "initialMargin": "",
        }
    ]


async def test_account_update_changes_the_held_position():
    stream = make_stream([POSITION])
    await stream._take_snapshot()

    stream._apply_account(
        {
            "e": "ACCOUNT_UPDATE",
            "a": {"P": [{"s": "BTC-USDT", "pa": "0.9", "ep": "80000", "ps": "LONG"}]},
        }
    )
    held = stream.positions()
    assert len(held) == 1
    assert float(held[0]["size"]) == pytest.approx(0.9)


async def test_zero_amount_closes_the_position():
    """Нулевой объём - позиции нет. Нулевую строку сопровождение сочло бы живой."""
    stream = make_stream([POSITION])
    await stream._take_snapshot()

    stream._apply_account(
        {"e": "ACCOUNT_UPDATE", "a": {"P": [{"s": "BTC-USDT", "pa": "0", "ps": "LONG"}]}}
    )
    assert stream.positions() == []


def test_account_update_before_the_snapshot_is_ignored():
    """Собранный по одним изменениям список молча разошёлся бы с биржей."""
    stream = make_stream([POSITION])
    stream._apply_account(
        {"e": "ACCOUNT_UPDATE", "a": {"P": [{"s": "BTC-USDT", "pa": "9", "ps": "LONG"}]}}
    )
    assert stream.positions() == []


# ── события заявок ───────────────────────────────────────────────────────────


def test_order_event_reads_short_field_names():
    event = {
        "e": "ORDER_TRADE_UPDATE",
        "o": {
            "s": "BTC-USDT",
            "i": "42",
            "c": "BTCUSDT-1789",
            "S": "BUY",
            "o": "LIMIT",
            "X": "FILLED",
            "ti": "7001",
        },
    }
    row = order_event(event)
    assert row["symbol"] == "BTCUSDT"
    assert row["clientOrderId"] == "btcusdt-1789"   # биржа переводит в строчные
    assert row["linkedOrderId"] == "7001"
    assert row["status"] == "FILLED"


async def test_order_event_wakes_the_watcher():
    """Событие заявки будит сопровождение по этой монете - в тот же миг."""
    woken: list[str] = []
    stream = make_stream([], on_orders=woken.append)
    await stream._take_snapshot()

    stream._apply_order(
        {
            "e": "ORDER_TRADE_UPDATE",
            "o": {"s": "BTC-USDT", "i": "42", "c": "BTCUSDT-1789", "X": "NEW"},
        }
    )
    assert woken == ["BTCUSDT"]


def test_ti_points_at_the_order_itself_not_at_the_entry():
    """Связи «защита - вход» поток не даёт, хотя документация её обещает.

    Проверено сделкой на демо-счёте: в событии условной заявки `o.ti` равен
    номеру самой этой заявки, а в событии исполненного входа его нет вовсе.
    Значит свою защиту опознаём только номерами, записанными при постановке.
    """
    protection = order_event(
        {
            "e": "ORDER_TRADE_UPDATE",
            "o": {"s": "BTC-USDT", "i": "7001", "o": "STOP_MARKET", "X": "NEW", "ti": "7001"},
        }
    )
    assert protection["linkedOrderId"] == protection["orderId"]
    assert protection["clientOrderId"] == ""

    entry = order_event(
        {"e": "ORDER_TRADE_UPDATE", "o": {"s": "BTC-USDT", "i": "42", "c": "BTCUSDT-1789", "X": "FILLED"}}
    )
    assert entry["linkedOrderId"] == ""


async def test_fill_asks_for_a_fresh_snapshot():
    """После исполнения размер позиции решает всё - перечитываем его сразу."""
    stream = make_stream([POSITION])
    await stream._take_snapshot()

    stream._apply_order(
        {"e": "ORDER_TRADE_UPDATE", "o": {"s": "BTC-USDT", "i": "42", "X": "FILLED"}}
    )
    assert stream._resync is not None
    await stream._resync


# ── сжатие и сердцебиение ────────────────────────────────────────────────────


async def test_ping_is_answered_with_pong():
    stream = make_stream([])
    ws = FakeWs()
    await stream._dispatch(ws, "Ping")
    assert ws.sent == ["Pong"]


async def test_compressed_event_is_understood():
    """Сообщения приходят сжатыми: без распаковки поток нем."""
    from core.bingx.stream import _unpack

    raw = gzip.compress(json.dumps({"e": "ORDER_TRADE_UPDATE"}).encode())
    assert json.loads(_unpack(raw))["e"] == "ORDER_TRADE_UPDATE"
    assert _unpack(b"Ping") == "Ping"


# ── опознание своей защиты сопровождением ────────────────────────────────────
#
# У BingX стоп и цели без метки, и это единственный способ их узнать: номер,
# который вернула биржа. Проверяем ту часть сопровождения, которая его находит.


class _PlanClient:
    """Клиент, у которого условные заявки без меток - как у BingX."""

    plans_unlabeled = True

    def __init__(self, plans: list[dict]) -> None:
        self._plans = plans

    async def algo_orders(self, symbol: str) -> list[dict]:
        return self._plans


def _live_trade(**over):
    from core.models import LiveTrade

    row = LiveTrade(
        student_id=1,
        client_id="BTCUSDT-1789",
        symbol="BTCUSDT",
        side="long",
        entry=80000.0,
        initial_stop=79000.0,
        current_stop=79000.0,
        targets_json="[]",
        tp_orders_json=json.dumps([{"price": 82000, "order_id": "7002", "filled": False}]),
        qty=0.5,
        leverage=10,
        margin=4000.0,
        takes_hit=0,
        status="open",
    )
    for key, value in over.items():
        setattr(row, key, value)
    return row


def _watcher():
    from backend.trading.watcher import PositionWatcher

    return PositionWatcher(lambda: None, lambda: None)


async def test_attached_stop_is_found_by_its_number():
    """Свою цель за стоп не принимаем, а стоп находим - и запишем его номер."""
    plans = [
        {"orderId": "7002", "planType": "TAKE_PROFIT", "positionSide": "LONG"},
        {"orderId": "7001", "planType": "STOP_LOSS", "positionSide": "LONG"},
    ]
    found = await _watcher()._find_stop_order(_PlanClient(plans), _live_trade())
    assert found == "7001"


async def test_stop_of_the_opposite_position_is_not_ours():
    """На встречной позиции свой стоп: записать его значит снять чужую защиту."""
    plans = [{"orderId": "8001", "planType": "STOP_LOSS", "positionSide": "SHORT"}]
    found = await _watcher()._find_stop_order(_PlanClient(plans), _live_trade())
    assert found == ""
