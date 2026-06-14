"""Менеджер WebSocket-подключений с фан-аутом событий (ТЗ §9.2).

Хранит активные соединения и рассылает им события (``new_signal``, ``price_update``,
``signal_closed`` и т.д.). Не зависит от FastAPI напрямую — принимает любой объект с
async-методом ``send_json`` (удобно для тестов).
"""

from __future__ import annotations

import asyncio
from typing import Any


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set = set()
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, ws) -> None:
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws) -> None:
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, event: str, payload: dict[str, Any]) -> None:
        """Разослать событие всем подключённым. Отвалившиеся соединения убираются."""
        message = {"event": event, "payload": payload}
        async with self._lock:
            targets = list(self._connections)
        dead = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 — соединение закрыто/битое
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)
