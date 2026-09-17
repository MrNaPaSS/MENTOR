"""Рыночные данные отдельным процессом.

Потоки бирж и сборка кадров стакана - самая тяжёлая часть сервера: тысячи
сообщений в секунду и кадр каждому открытому терминалу восемь раз в секунду.
Пока они живут в процессе сайта, потолок терминалов упирается в них, а
перезапуск сайта рвёт всем стакан.

Роль `market` уносит их в свой процесс. Приватные потоки бирж остаются у
сайта - из них читают торговые ручки, - поэтому звонок о счёте идёт между
процессами одним локальным запросом.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import internal as internal_api
from backend.main import market_apart, process_role


def test_market_is_a_known_role():
    assert process_role("market") == "market"


def test_apart_is_off_unless_asked():
    """По умолчанию всё как было: разделение требует правил в туннеле."""
    assert market_apart("") is False
    assert market_apart("0") is False
    assert market_apart("1") is True
    assert market_apart("true") is True


class FakeHub:
    def __init__(self) -> None:
        self.rung: list[tuple[int, str]] = []
        self.told: list[tuple[int, tuple[str, ...]]] = []

    async def ring(self, student_id: int, reason: str = "order") -> None:
        self.rung.append((student_id, reason))

    async def streamed(self, student_id: int, venues: tuple[str, ...]) -> None:
        self.told.append((student_id, venues))


class FakeConfig:
    jwt_secret = "secret"


def make_app(hub: FakeHub | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(internal_api.router)
    app.state.config = FakeConfig()
    app.state.scalping_hub = hub
    return app


def local(app: FastAPI) -> TestClient:
    """Клиент с петлевого адреса: снаружи ручка не отвечает вовсе."""
    return TestClient(app, client=("127.0.0.1", 40000))


def test_bell_rings_the_hub():
    hub = FakeHub()
    with local(make_app(hub)) as client:
        answer = client.post(
            "/internal/bell",
            json={"student_id": 7, "reason": "order"},
            headers={"X-Internal-Token": "secret"},
        )
    assert answer.status_code == 200
    assert hub.rung == [(7, "order")]


@pytest.mark.asyncio
async def test_the_bell_does_not_wait_for_the_sockets():
    """Ответ уходит сразу, рассылка идёт в фоне.

    Отправка в сокет идёт через туннель к живому браузеру: на медленной сети
    живой стол показал звонки по 2.5 секунды, и всё это время ждал процесс
    сайта, за которым стоит поток биржи.
    """
    import asyncio

    from backend.api.internal import BellIn, _deliver, _spawn

    class SlowHub(FakeHub):
        async def ring(self, student_id: int, reason: str = "order") -> None:
            await asyncio.sleep(0.2)
            await super().ring(student_id, reason)

    hub = SlowHub()
    started = asyncio.get_running_loop().time()
    _spawn(_deliver(hub, BellIn(student_id=7, reason="order")))
    # Возврат мгновенный, хотя сама отправка ещё идёт.
    assert asyncio.get_running_loop().time() - started < 0.05
    assert hub.rung == []

    await asyncio.sleep(0.3)
    assert hub.rung == [(7, "order")]


@pytest.mark.asyncio
async def test_a_broken_socket_does_not_leave_a_lost_task():
    """Сбой рассылки гасится на месте, а не всплывает «задачей без хозяина»."""
    import asyncio

    from backend.api.internal import BellIn, _deliver

    class BrokenHub(FakeHub):
        async def ring(self, student_id: int, reason: str = "order") -> None:
            raise RuntimeError("сокет закрыт")

    await _deliver(BrokenHub(), BellIn(student_id=7, reason="order"))


def test_bell_carries_the_streamed_exchanges():
    hub = FakeHub()
    with local(make_app(hub)) as client:
        client.post(
            "/internal/bell",
            json={"student_id": 7, "streamed": ["okx", "binance"]},
            headers={"X-Internal-Token": "secret"},
        )
    assert hub.told == [(7, ("binance", "okx"))]
    assert hub.rung == []


def test_a_wrong_secret_gets_nothing():
    """Чужому звонку не отвечаем и виду не подаём, что ручка есть."""
    hub = FakeHub()
    with local(make_app(hub)) as client:
        answer = client.post(
            "/internal/bell",
            json={"student_id": 7, "reason": "order"},
            headers={"X-Internal-Token": "not-the-secret"},
        )
    assert answer.status_code == 404
    assert hub.rung == []


def test_a_call_from_outside_gets_nothing():
    """Только петля: снаружи в эту ручку не позвонить."""
    hub = FakeHub()
    app = make_app(hub)
    with TestClient(app, client=("203.0.113.7", 40000)) as client:
        answer = client.post(
            "/internal/bell",
            json={"student_id": 7, "reason": "order"},
            headers={"X-Internal-Token": "secret"},
        )
    assert answer.status_code == 404
    assert hub.rung == []


def test_without_a_hub_the_bell_is_a_no_op():
    """Стакана в этом процессе нет - звонок не роняет ручку."""
    with local(make_app(None)) as client:
        answer = client.post(
            "/internal/bell",
            json={"student_id": 7, "reason": "order"},
            headers={"X-Internal-Token": "secret"},
        )
    assert answer.status_code == 200
    assert answer.json() == {"ok": False}


@pytest.mark.asyncio
async def test_a_silent_market_process_does_not_break_the_stream():
    """Процесс рынка не поднят - поток биржи от этого не страдает.

    Терминал в этом случае узнает об изменении своим кругом опроса: он никуда
    не делся, просто идёт реже.
    """
    from backend.ws.bell_bridge import BellBridge

    bridge = BellBridge("secret", url="http://127.0.0.1:9")  # порт, где никого нет
    await bridge.ring(7)
    await bridge.close()
