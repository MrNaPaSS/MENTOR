"""Рассылка по сокетам: один медленный клиент не держит остальных (backend/ws/manager.py)."""

from __future__ import annotations

import asyncio

from backend.ws import manager as manager_mod
from backend.ws.manager import ConnectionManager


class Fast:
    def __init__(self):
        self.got: list[dict] = []
        self.closed = False

    async def send_json(self, message):
        self.got.append(message)

    async def close(self):
        self.closed = True


class Stuck(Fast):
    async def send_json(self, message):
        await asyncio.sleep(3600)


class Broken(Fast):
    async def send_json(self, message):
        raise RuntimeError("соединение закрыто")


def test_slow_client_does_not_hold_the_broadcast(monkeypatch):
    monkeypatch.setattr(manager_mod, "SEND_TIMEOUT", 0.05)
    fast, stuck, broken = Fast(), Stuck(), Broken()

    async def run():
        hub = ConnectionManager()
        for ws in (fast, stuck, broken):
            await hub.connect(ws)
        await asyncio.wait_for(hub.broadcast("price_update", {"p": 1}), timeout=2)
        # Закрытие мёртвых идёт фоном - даём ему пройти.
        await asyncio.sleep(0.1)
        return hub

    hub = asyncio.run(run())
    assert fast.got == [{"event": "price_update", "payload": {"p": 1}}]
    # Застрявший и сломанный убраны из рассылки и закрыты: клиент должен
    # переподключиться, а не висеть на соединении, по которому ничего не идёт.
    assert hub.count == 1
    assert stuck.closed and broken.closed
