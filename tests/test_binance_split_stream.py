"""Стаканы и лента Binance - разными соединениями.

В одном соединении лента давала почти весь трафик, и обрыв ломал книги всех
монет разом: полсотни снимков, бюджет веса до дна, пустой скринер. Здесь
проверяется одно: подписки разводятся по своим соединениям, а сборщику это
тот же клиент.
"""

from __future__ import annotations

import asyncio
import json

import aiohttp

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


# ── живость соединения ───────────────────────────────────────────────────────
#
# Соединение рвалось кодом 1006 каждые сорок секунд: сто восемьдесят обрывов за
# день, и каждый ломал книги всех монет разом. Сторожем живости был свой ping
# aiohttp, и рядом в журнале стояло «Cannot write to closing transport». Теперь
# живость мерится сообщениями: идут - поток жив, молчит дольше срока - мёртв.


class FakeMessage:
    def __init__(self, type_, data=""):
        self.type = type_
        self.data = data


class FakeSocket:
    """Сокет, который отдаёт заготовленные сообщения, а потом молчит."""

    def __init__(self, messages, silence: bool = True):
        self.queue = list(messages)
        self.silence = silence
        self.close_code = 1006

    def exception(self):
        return None

    async def receive(self):
        if self.queue:
            return self.queue.pop(0)
        if self.silence:
            # Молчим, пока ждущий не устанет: ровно так ведёт себя сокет,
            # оборванный сетью посередине, - закрытия с той стороны не будет.
            await asyncio.sleep(3600)
        return FakeMessage(aiohttp.WSMsgType.CLOSED)


def read(client: StreamClient, socket: FakeSocket) -> str:
    return asyncio.run(client._read(socket))


def test_silence_longer_than_the_limit_is_a_dead_connection():
    """Оборванный сетью сокет молчит вечно: ждать его нечего."""
    client = StreamClient(lambda stream, data: None, name="стаканы", stall=0.05)
    assert read(client, FakeSocket([])) == "тишина 0 с"


def test_messages_keep_the_connection_alive():
    """Пока сообщения идут, срок тишины не истекает - и книги живут."""
    seen: list[str] = []
    client = StreamClient(lambda stream, data: seen.append(stream), name="стаканы", stall=0.3)

    payload = json.dumps({"stream": "btcusdt@trade", "data": {"e": "trade"}})
    socket = FakeSocket([FakeMessage(aiohttp.WSMsgType.TEXT, payload)] * 3)

    assert read(client, socket) == "тишина 0 с"
    assert seen == ["btcusdt@trade"] * 3


def test_the_close_of_the_exchange_is_named_by_its_code():
    """Обрыв с той стороны отличаем от тишины: лечатся они по-разному."""
    client = StreamClient(lambda stream, data: None, name="лента", stall=5.0)
    socket = FakeSocket([FakeMessage(aiohttp.WSMsgType.CLOSED)], silence=False)

    assert read(client, socket) == "обрыв 1006"


def test_the_tape_is_allowed_to_be_quiet_longer_than_the_books():
    """Стаканы полусотни монет молчать не могут, спящая монета - может."""
    client = SplitStreamClient(lambda stream, data: None)
    assert client.depth._stall < client.tape._stall
