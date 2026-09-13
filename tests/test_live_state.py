"""Общая память чтений с биржи: один ответ на всех, кто спросил за секунду."""

from __future__ import annotations

import asyncio

import pytest

from backend.trading import live_state
from backend.trading.live_state import Cached, cached


class Exchange:
    """Биржа, которая считает, сколько раз её спросили."""

    exchange = "okx"
    stop_waits_full_fill = True

    def __init__(self) -> None:
        self.calls: dict[str, int] = {}
        self.delay = 0.0

    def _count(self, name: str) -> None:
        self.calls[name] = self.calls.get(name, 0) + 1

    async def positions(self):
        self._count("positions")
        if self.delay:
            await asyncio.sleep(self.delay)
        return [{"symbol": "BTCUSDT", "size": "1"}]

    async def algo_orders(self, symbol):
        self._count("algo_orders")
        return [{"orderId": "1", "symbol": symbol}]

    async def open_orders(self, symbol):
        self._count("open_orders")
        return []

    async def user_trades(self, symbol=None, limit=100):
        self._count("user_trades")
        return []

    async def place_tp_sl(self, **kw):
        self._count("place_tp_sl")
        return {"orderId": "p1"}

    async def cancel_algo_order(self, symbol, order_id):
        self._count("cancel_algo_order")
        raise RuntimeError("биржа отказала")


@pytest.fixture(autouse=True)
def _clean():
    live_state.clear()
    yield
    live_state.clear()


def run(coro):
    return asyncio.run(coro)


def test_second_question_within_a_second_does_not_reach_the_exchange():
    api = Exchange()
    client = cached(api, 1, "okx")

    async def twice():
        return await client.positions(), await client.positions()

    first, second = run(twice())
    assert first == second
    assert api.calls["positions"] == 1


def test_answers_go_stale_and_are_asked_again():
    api = Exchange()
    client = cached(api, 1, "okx", ttl=0.01)

    async def twice():
        await client.positions()
        await asyncio.sleep(0.02)
        await client.positions()

    run(twice())
    assert api.calls["positions"] == 2


def test_ten_open_tabs_ask_the_exchange_once():
    """Пока ответ в пути, остальные ждут его, а не шлют свои запросы."""
    api = Exchange()
    api.delay = 0.02
    client = cached(api, 1, "okx")

    async def crowd():
        return await asyncio.gather(*(client.positions() for _ in range(10)))

    rows = run(crowd())
    assert all(row == rows[0] for row in rows)
    assert api.calls["positions"] == 1


def test_symbols_are_remembered_apart():
    api = Exchange()
    client = cached(api, 1, "okx")

    async def both():
        await client.algo_orders("BTCUSDT")
        await client.algo_orders("ETHUSDT")
        await client.algo_orders("btcusdt")

    run(both())
    assert api.calls["algo_orders"] == 2


def test_students_and_exchanges_do_not_share_memory():
    api = Exchange()

    async def three():
        await cached(api, 1, "okx").positions()
        await cached(api, 2, "okx").positions()
        await cached(api, 1, "weex").positions()

    run(three())
    assert api.calls["positions"] == 3


def test_a_placed_order_makes_the_next_answer_fresh():
    api = Exchange()
    client = cached(api, 1, "okx")

    async def flow():
        await client.positions()
        await client.algo_orders("BTCUSDT")
        await client.place_tp_sl(symbol="BTCUSDT", plan_type="STOP_LOSS")
        await client.positions()
        await client.algo_orders("BTCUSDT")

    run(flow())
    assert api.calls["positions"] == 2
    assert api.calls["algo_orders"] == 2


def test_memory_is_dropped_even_when_the_exchange_refuses():
    """Отказ мог прийти после того, как биржа уже применила запрос."""
    api = Exchange()
    client = cached(api, 1, "okx")

    async def flow():
        await client.positions()
        with pytest.raises(RuntimeError):
            await client.cancel_algo_order("BTCUSDT", "1")
        await client.positions()

    run(flow())
    assert api.calls["positions"] == 2


def test_everything_else_goes_straight_to_the_exchange():
    api = Exchange()
    client = cached(api, 1, "okx")

    async def flow():
        await client.user_trades("BTCUSDT")
        await client.user_trades("BTCUSDT")

    run(flow())
    assert api.calls["user_trades"] == 2
    # Свойства клиента остаются на месте: по ним сделка запоминает биржу, а
    # сопровождение узнаёт, ждёт ли приложенный стоп полного исполнения.
    assert client.exchange == "okx"
    assert client.stop_waits_full_fill is True


def test_wrapping_twice_changes_nothing():
    api = Exchange()
    once = cached(api, 1, "okx")
    assert cached(once, 1, "okx") is once
    assert isinstance(once, Cached)
