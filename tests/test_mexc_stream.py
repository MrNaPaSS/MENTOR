"""Приватный поток MEXC: вход подписью, снимок позиций и события заявок.

Сети нет: снимок позиций подменён, сообщения подаются прямо в разбор. Здесь
проверяется то, чем этот поток отличается от трёх подключённых и чем опасен:

* вход идёт сообщением в сам сокет, и подпись у него та же, что у ручек;
* снимка позиций канал не даёт, и до запроса поток себя живым не считает -
  иначе пустой список сопровождение приняло бы за закрытую сделку;
* размер позиции считается в контрактах, и переводить его в потоке вторым
  кодом нельзя: событие только просит снимок заново.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

from core.mexc.stream import MexcPrivateStream, login_message, order_event
from core.weex.futures import Credentials

POSITION = {
    "symbol": "BTCUSDT",
    "instId": "BTC_USDT",
    "side": "LONG",
    "positionSide": "LONG",
    "size": "0.01",
    "positionId": "4242",
}


def make_stream(rows: list[dict] | None = None, **kw) -> MexcPrivateStream:
    async def snapshot() -> list[dict]:
        return list(rows or [])

    return MexcPrivateStream(Credentials("key", "secret", ""), snapshot, **kw)


def push(channel: str, data) -> str:
    return json.dumps({"channel": channel, "data": data, "ts": 1700000000000})


# ── вход ─────────────────────────────────────────────────────────────────────


def test_login_is_signed_by_key_and_time():
    """Подпись входа - HMAC от `apiKey + время`, тем же правилом, что у ручек."""
    message = login_message(Credentials("key", "secret", ""), 1700000000000)
    assert message["method"] == "login"
    param = message["param"]
    assert param["apiKey"] == "key"
    assert param["reqTime"] == "1700000000000"
    assert param["signature"] == hmac.new(
        b"secret", b"key1700000000000", hashlib.sha256
    ).hexdigest()


def test_refused_login_is_not_silent(caplog):
    """Отказ входа: без записи поток выглядел бы живым, но событий не носил."""
    stream = make_stream()
    with caplog.at_level("WARNING"):
        stream._dispatch(push("rs.error", "Signature verify failed"))
    assert "вход" in caplog.text.lower()


def test_accepted_login_wakes_the_waiter():
    """Успешный вход - сигнал тому, кто ждёт, чтобы взять снимок."""

    async def scenario() -> bool:
        stream = make_stream()
        stream._logged_in = asyncio.Event()
        stream._dispatch(push("rs.login", {}))
        return stream._logged_in.is_set()

    assert asyncio.run(scenario()) is True


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

    stream = MexcPrivateStream(Credentials("key", "secret", ""), broken)
    await stream._take_snapshot()
    assert stream.ready is False
    assert stream.positions() == []


async def test_two_sides_of_one_pair_live_apart():
    """В двустороннем режиме у пары две позиции: сложить их - потерять одну."""
    short = {**POSITION, "side": "SHORT", "positionSide": "SHORT", "positionId": "4243"}
    stream = make_stream([POSITION, short])
    await stream._take_snapshot()
    assert len(stream.positions()) == 2


# ── события ──────────────────────────────────────────────────────────────────


def test_order_event_reads_our_own_mark():
    """Свою заявку поток называет нашим именем - то, чего нет на BingX."""
    event = order_event(
        {
            "symbol": "BTC_USDT",
            "orderId": 5,
            "externalOid": "nmnh-17",
            "state": 3,
            "side": 1,
            "dealVol": 100,
        }
    )
    assert event["symbol"] == "BTCUSDT"
    assert event["clientOrderId"] == "nmnh-17"
    assert event["state"] == 3


async def test_fill_asks_for_a_fresh_snapshot():
    """Исполнение - место, где ошибка в размере позиции стоит денег."""
    calls: list[int] = []

    async def snapshot() -> list[dict]:
        calls.append(1)
        return [POSITION]

    stream = MexcPrivateStream(Credentials("key", "secret", ""), snapshot)
    await stream._take_snapshot()
    assert len(calls) == 1

    stream._dispatch(
        push("push.personal.order", {"symbol": "BTC_USDT", "orderId": 5, "state": 3, "dealVol": 100})
    )
    await stream._resync
    assert len(calls) == 2


async def test_order_event_wakes_the_watcher():
    """Событие заявки будит сопровождение этого ученика - по паре."""
    woken: list[str] = []
    stream = MexcPrivateStream(
        Credentials("key", "secret", ""),
        lambda: asyncio.sleep(0, result=[POSITION]),
        on_orders=woken.append,
    )
    await stream._take_snapshot()
    stream._dispatch(
        push("push.personal.order", {"symbol": "BTC_USDT", "orderId": 5, "state": 2})
    )
    assert woken == ["BTCUSDT"]


async def test_stop_event_wakes_the_watcher_and_asks_for_a_snapshot():
    """Защита у MEXC ходит своими каналами - и они важнее заявочного.

    Сработавший стоп закрывает позицию. Узнавать об этом обходом значит ждать
    до пяти секунд с закрытой сделкой на экране - каналы сняты с живого счёта:
    `push.personal.stop.planorder` и `push.personal.stop.order`.
    """
    for channel in ("push.personal.stop.planorder", "push.personal.stop.order"):
        woken: list[str] = []
        calls: list[int] = []

        async def snapshot() -> list[dict]:
            calls.append(1)
            return [POSITION]

        stream = MexcPrivateStream(
            Credentials("key", "secret", ""), snapshot, on_orders=woken.append
        )
        await stream._take_snapshot()
        stream._dispatch(push(channel, {"symbol": "BTC_USDT", "stopLossPrice": 76000}))
        await stream._resync
        assert woken == ["BTCUSDT"], channel
        # Снимок просим заново: позиции после стопа может уже не быть.
        assert len(calls) == 2, channel


async def test_position_event_does_not_count_contracts_itself():
    """Событие позиции просит снимок, а не переводит контракты своим кодом.

    Второй перевод означал бы второй источник правды о размере позиции - и
    расхождение заметил бы ученик, а не мы.
    """
    calls: list[int] = []

    async def snapshot() -> list[dict]:
        calls.append(1)
        return [POSITION]

    stream = MexcPrivateStream(Credentials("key", "secret", ""), snapshot)
    await stream._take_snapshot()
    stream._dispatch(push("push.personal.position", {"symbol": "BTC_USDT", "holdVol": 200}))
    await stream._resync
    assert len(calls) == 2
    # Состояние по-прежнему то, что принёс снимок, а не то, что в событии.
    assert stream.positions() == [POSITION]


async def test_events_before_the_snapshot_change_nothing():
    """До снимка применять изменения не к чему: собранный по ним список врёт."""
    calls: list[int] = []

    async def snapshot() -> list[dict]:
        calls.append(1)
        return [POSITION]

    stream = MexcPrivateStream(Credentials("key", "secret", ""), snapshot)
    stream._dispatch(push("push.personal.position", {"symbol": "BTC_USDT", "holdVol": 200}))
    await asyncio.sleep(0)
    assert stream._resync is None
    assert calls == []
    assert stream.positions() == []


async def test_broken_connection_forgets_the_state():
    """Соединения нет - состоянию верить нельзя, память чтений сбрасывается."""
    forgotten: list[int] = []
    stream = MexcPrivateStream(
        Credentials("key", "secret", ""),
        lambda: asyncio.sleep(0, result=[POSITION]),
        on_down=lambda: forgotten.append(1),
    )
    await stream._take_snapshot()
    stream._down()
    assert stream.positions() == []
    assert stream.ready is False
    assert forgotten == [1]
