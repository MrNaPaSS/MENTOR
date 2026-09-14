"""Приватный поток Binance: снимок, события счёта и протухший ключ.

Сети нет: снимок позиций подменён, сообщения подаются прямо в разбор. Здесь
проверяется то, чем этот поток опасен:

* снимка позиций канал не даёт, и до запроса поток себя живым не считает -
  иначе пустой список сопровождение приняло бы за закрытую сделку;
* ключ протухает на ходу, и биржа говорит об этом отдельным событием.
  Соединение при этом живо, но событий в нём больше нет: молчащий поток
  опаснее оборвавшегося.
"""

from __future__ import annotations

import asyncio
import json

from core.binance.stream import (
    BinancePrivateStream,
    account_positions,
    order_event,
    ws_url,
)
from core.weex.futures import Credentials

POSITION = {
    "symbol": "BTCUSDT",
    "instId": "BTCUSDT",
    "side": "LONG",
    "positionSide": "LONG",
    "size": "0.01",
}


class FakeWs:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def make_stream(rows: list[dict] | None = None, **kw) -> BinancePrivateStream:
    async def snapshot() -> list[dict]:
        return list(rows or [])

    return BinancePrivateStream(Credentials("key", "secret", ""), snapshot, **kw)


def event(kind: str, **fields) -> str:
    return json.dumps({"e": kind, "E": 1700000000000, **fields})


# ── адрес ────────────────────────────────────────────────────────────────────


def test_private_stream_has_its_own_address():
    """Потоки разведены по адресам, и события счёта живут только на своём.

    Прежний путь биржа отключила 23 апреля 2026: соединение по нему
    открывается и живёт, но событий счёта в нём нет вовсе - проверено живым
    счётом 14 сентября, сделка прошла, а поток промолчал.
    """
    assert ws_url(False, "abc123") == "wss://fstream.binance.com/private/ws?listenKey=abc123"
    # Учебный контур - тот же путь, свой хост.
    assert ws_url(True, "abc123") == "wss://demo-fstream.binance.com/private/ws?listenKey=abc123"


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

    stream = BinancePrivateStream(Credentials("key", "secret", ""), broken)
    await stream._take_snapshot()
    assert stream.ready is False
    assert stream.positions() == []


# ── события счёта ────────────────────────────────────────────────────────────


def test_account_event_is_read_into_rest_field_names():
    """Поля в потоке короткие, и переводит их тот же код, что ответ ручки."""
    rows = account_positions(
        {
            "a": {
                "P": [
                    {"s": "BTCUSDT", "pa": "0.02", "ep": "80000", "up": "5", "ps": "LONG", "bep": "79900"}
                ]
            }
        }
    )
    assert rows == [
        {
            "symbol": "BTCUSDT",
            "positionAmt": "0.02",
            "entryPrice": "80000",
            "breakEvenPrice": "79900",
            "unRealizedProfit": "5",
            "positionSide": "LONG",
            "isolatedWallet": "",
        }
    ]


async def test_position_change_updates_the_state():
    stream = make_stream([POSITION])
    await stream._take_snapshot()
    stream._ready = True

    stream._dispatch(
        event(
            "ACCOUNT_UPDATE",
            a={"P": [{"s": "BTCUSDT", "pa": "0.05", "ep": "80000", "up": "1", "ps": "LONG"}]},
        )
    )
    assert [row["size"] for row in stream.positions()] == ["0.05"]


async def test_zero_amount_closes_the_position():
    """Нулевой объём в событии - позиция закрыта, и в списке ей места нет."""
    stream = make_stream([POSITION])
    await stream._take_snapshot()
    stream._ready = True

    stream._dispatch(
        event(
            "ACCOUNT_UPDATE",
            a={"P": [{"s": "BTCUSDT", "pa": "0", "ep": "0", "up": "0", "ps": "LONG"}]},
        )
    )
    assert stream.positions() == []


async def test_events_before_the_snapshot_change_nothing():
    """До снимка применять изменения не к чему: собранный по ним список врёт."""
    stream = make_stream([POSITION])
    stream._dispatch(
        event(
            "ACCOUNT_UPDATE",
            a={"P": [{"s": "BTCUSDT", "pa": "0.05", "ep": "80000", "up": "1", "ps": "LONG"}]},
        )
    )
    assert stream.positions() == []


# ── события заявок ───────────────────────────────────────────────────────────


def test_order_event_is_read_into_readable_names():
    one = order_event(
        {"o": {"s": "BTCUSDT", "i": 5, "c": "x-NMNH01btcusdt-1757", "X": "FILLED", "S": "BUY", "z": "0.01"}}
    )
    assert one["symbol"] == "BTCUSDT"
    assert one["orderId"] == "5"
    assert one["status"] == "FILLED"
    assert one["filled"] == 0.01


async def test_fill_asks_for_a_fresh_snapshot():
    """Исполнение - место, где ошибка в размере позиции стоит денег."""
    calls: list[int] = []

    async def snapshot() -> list[dict]:
        calls.append(1)
        return [POSITION]

    stream = BinancePrivateStream(Credentials("key", "secret", ""), snapshot)
    await stream._take_snapshot()
    assert len(calls) == 1

    stream._dispatch(event("ORDER_TRADE_UPDATE", o={"s": "BTCUSDT", "i": 5, "X": "FILLED"}))
    await stream._resync
    assert len(calls) == 2


async def test_order_event_wakes_the_watcher():
    woken: list[str] = []
    stream = make_stream([POSITION], on_orders=woken.append)
    await stream._take_snapshot()
    stream._dispatch(event("ORDER_TRADE_UPDATE", o={"s": "BTCUSDT", "i": 5, "X": "NEW"}))
    assert woken == ["BTCUSDT"]


# ── протухший ключ и обрыв ───────────────────────────────────────────────────


async def test_expired_key_is_treated_as_a_break():
    """Соединение живо, но событий в нём больше нет - это хуже обрыва.

    Поток перестаёт считать себя живым сразу, и сопровождение возвращается к
    опросу биржи, пока `_run` берёт новый ключ.
    """
    stream = make_stream([POSITION])
    await stream._take_snapshot()
    ws = FakeWs()
    stream._ws = ws  # type: ignore[assignment]
    assert stream.ready is True

    stream._dispatch(event("listenKeyExpired"))
    assert stream.ready is False
    # Сокет закрывается отдельной задачей - дождёмся её.
    await asyncio.sleep(0)
    assert ws.closed is True


async def test_broken_connection_forgets_the_state():
    """Соединения нет - состоянию верить нельзя, память чтений сбрасывается."""
    forgotten: list[int] = []
    stream = make_stream([POSITION], on_down=lambda: forgotten.append(1))
    await stream._take_snapshot()
    stream._down()
    assert stream.positions() == []
    assert stream.ready is False
    assert forgotten == [1]
