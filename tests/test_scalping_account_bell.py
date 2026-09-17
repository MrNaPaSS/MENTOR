"""Звонок о счёте: терминал узнаёт об исполнении, а не опрашивает биржу.

Терминал спрашивал позиции, заявки и сделки каждые три секунды - около
тридцати запросов в минуту на вкладку, и всё равно с задержкой. Сервер об
изменении знает раньше: приватный поток биржи сообщает об исполнении в тот же
миг. Событие уезжает по тому же каналу, где идёт стакан.
"""

from __future__ import annotations

import asyncio

import pytest

from backend.scalping.state import MarketState
from backend.ws.scalping_hub import RING_EVERY, ScalpingHub


class FakeSocket:
    """Сокет, который только копит отправленное."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    def bells(self) -> list[dict]:
        return [m["payload"] for m in self.sent if m.get("event") == "account"]


class FakeCollector:
    exchange = "binance"

    def __init__(self) -> None:
        self.state = MarketState()

    def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def pin(self, symbol: str) -> None:
        pass

    async def unpin(self, symbol: str) -> None:
        pass


async def make_hub(*people: int) -> tuple[ScalpingHub, list[FakeSocket]]:
    hub = ScalpingHub(FakeCollector())  # type: ignore[arg-type]
    sockets = []
    for person in people:
        ws = FakeSocket()
        await hub.connect(ws, person)
        sockets.append(ws)
    # Рассылка кадров в этих тестах только мешает: проверяем звонки.
    await hub.stop()
    return hub, sockets


@pytest.mark.asyncio
async def test_bell_goes_to_its_own_student():
    """Чужому ученику о счёте не говорят: это его позиции и его заявки."""
    hub, (mine, other) = await make_hub(7, 8)

    await hub.ring(7, reason="order")

    assert mine.bells() == [{"reason": "order"}]
    assert other.bells() == []


@pytest.mark.asyncio
async def test_anonymous_socket_gets_nothing():
    """Канал без токена работает как раньше - стакан публичный, счёта нет."""
    hub, (guest,) = await make_hub(0)

    await hub.ring(0)

    assert guest.bells() == []


@pytest.mark.asyncio
async def test_burst_rings_once_and_keeps_the_tail():
    """Пачка исполнений - один звонок сразу и один хвостом, а не десять.

    Рыночный вход крупным объёмом биржа присылает десятком сообщений, и
    звонить на каждое значило бы гонять терминал чаще, чем он опрашивал.
    """
    hub, (ws,) = await make_hub(7)

    for _ in range(5):
        await hub.ring(7)
    assert len(ws.bells()) == 1

    await asyncio.sleep(RING_EVERY + 0.1)
    assert len(ws.bells()) == 2


@pytest.mark.asyncio
async def test_streams_told_once_per_change():
    """Состав потоков шлём при изменении, а не каждую сверку."""
    hub, (ws,) = await make_hub(7)

    await hub.streamed(7, ("okx",))
    await hub.streamed(7, ("okx",))
    assert ws.bells() == [{"streamed": ["okx"]}]

    await hub.streamed(7, ("binance", "okx"))
    assert ws.bells()[-1] == {"streamed": ["binance", "okx"]}


@pytest.mark.asyncio
async def test_new_socket_learns_the_streams_at_once():
    """Вторая вкладка узнаёт о потоках сразу, а не через сверку.

    Иначе до первой сверки она спрашивала бы сервер частым кругом впустую.
    """
    hub, (first,) = await make_hub(7)
    await hub.streamed(7, ("okx",))

    second = FakeSocket()
    await hub.connect(second, 7)
    await hub.stop()

    assert second.bells() == [{"streamed": ["okx"]}]


@pytest.mark.asyncio
async def test_last_socket_out_forgets_the_student():
    """Ушёл последний сокет ученика - о нём ничего не остаётся."""
    hub, (ws,) = await make_hub(7)
    await hub.streamed(7, ("okx",))

    await hub.disconnect(ws)

    assert 7 not in hub._people
    assert 7 not in hub._streamed
    # Звонок в пустоту ничего не роняет.
    await hub.ring(7)


# ── кого канал считает своим ────────────────────────────────────────────────


def test_only_a_live_token_names_the_student():
    """Звонок о счёте идёт по токену: чужой подписью ученика не назвать."""
    from types import SimpleNamespace

    from backend.security import create_access_token
    from backend.ws.routes import _student_of

    def socket(secret: str):
        state = SimpleNamespace(config=SimpleNamespace(jwt_secret=secret))
        return SimpleNamespace(app=SimpleNamespace(state=state))

    token = create_access_token("42", "student", "secret", 600)
    assert _student_of(socket("secret"), token) == 42
    # Подпись чужим ключом, мусор и пустота - никто.
    assert _student_of(socket("another"), token) == 0
    assert _student_of(socket("secret"), "abc.def.ghi") == 0
    assert _student_of(socket("secret"), "") == 0
