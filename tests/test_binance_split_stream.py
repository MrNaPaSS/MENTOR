"""Стаканы и лента Binance - разными соединениями.

В одном соединении лента давала почти весь трафик, и обрыв ломал книги всех
монет разом: полсотни снимков, бюджет веса до дна, пустой скринер. Здесь
проверяется одно: подписки разводятся по своим соединениям, а сборщику это
тот же клиент.
"""

from __future__ import annotations

import asyncio

from backend.scalping.binance import SplitStreamClient, StreamClient, is_depth_stream
from backend.scalping.collector import ScalpingCollector


class FakeInner:
    def __init__(self) -> None:
        self.subs: set[str] = set()
        self.calls: list[tuple[str, frozenset[str]]] = []
        self.started = False
        self.stopped = False
        self.connected = False

    @property
    def streams(self) -> frozenset[str]:
        return frozenset(self.subs)

    def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    async def subscribe(self, streams: set[str]) -> None:
        self.subs |= streams
        self.calls.append(("sub", frozenset(streams)))

    async def unsubscribe(self, streams: set[str]) -> None:
        self.subs -= streams
        self.calls.append(("unsub", frozenset(streams)))


def split() -> SplitStreamClient:
    client = SplitStreamClient(lambda stream, data: None)
    client.depth = FakeInner()  # type: ignore[assignment]
    client.tape = FakeInner()  # type: ignore[assignment]
    return client


def test_depth_and_trades_go_to_their_own_connections():
    client = split()
    asyncio.run(client.subscribe({"btcusdt@depth@500ms", "btcusdt@trade"}))
    assert client.depth.subs == {"btcusdt@depth@500ms"}
    assert client.tape.subs == {"btcusdt@trade"}


def test_unsubscribing_every_stream_of_a_coin_reaches_both():
    """Снятие монеты с наблюдения - обе скорости стакана и лента разом."""
    client = split()
    asyncio.run(
        client.subscribe({"ethusdt@depth@100ms", "ethusdt@depth@500ms", "ethusdt@trade"})
    )
    asyncio.run(
        client.unsubscribe({"ethusdt@depth@100ms", "ethusdt@depth@500ms", "ethusdt@trade"})
    )
    assert client.depth.subs == set()
    assert client.tape.subs == set()


def test_an_empty_group_is_not_sent():
    """Смена скорости стакана не должна слать пустую команду ленте."""
    client = split()
    asyncio.run(client.subscribe({"solusdt@depth@100ms"}))
    assert client.tape.calls == []


def test_the_collector_sees_one_client():
    client = split()
    asyncio.run(client.subscribe({"btcusdt@depth@500ms", "btcusdt@trade"}))
    assert client.streams == {"btcusdt@depth@500ms", "btcusdt@trade"}

    client.start()
    assert client.depth.started and client.tape.started
    asyncio.run(client.stop())
    assert client.depth.stopped and client.tape.stopped


def test_connected_follows_the_book_connection():
    """Книги держатся на соединении стаканов - по нему и признак подключения."""
    client = split()
    client.depth.connected = True
    client.tape.connected = False
    assert client.connected is True
    client.depth.connected = False
    client.tape.connected = True
    assert client.connected is False


def test_depth_streams_are_recognised():
    assert is_depth_stream("btcusdt@depth@500ms")
    assert is_depth_stream("btcusdt@depth@100ms")
    assert not is_depth_stream("btcusdt@trade")


def test_the_real_collector_uses_two_connections():
    collector = ScalpingCollector(top_n=2)
    assert isinstance(collector.stream, SplitStreamClient)
    assert isinstance(collector.stream.depth, StreamClient)
    assert isinstance(collector.stream.tape, StreamClient)
