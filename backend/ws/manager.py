"""Менеджер WebSocket-подключений с фан-аутом событий (ТЗ §9.2).

Хранит активные соединения и рассылает им события (``new_signal``, ``price_update``,
``signal_closed`` и т.д.). Не зависит от FastAPI напрямую — принимает любой объект с
async-методом ``send_json`` (удобно для тестов).
"""

from __future__ import annotations

import asyncio
from typing import Any

# Сколько ждать одного клиента. Рассылка идёт всем разом, но цикл сборщика цен
# ждёт её конца: клиент на плохой связи, чей буфер не принимает кадр, раньше
# держал рассылку всем остальным, и цены у всех вставали.
SEND_TIMEOUT = 5.0


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
        """Разослать событие всем подключённым. Отвалившиеся соединения убираются.

        Всем разом, а не по очереди, и каждому - с пределом ожидания: один
        медленный клиент больше не задерживает остальных.
        """
        message = {"event": event, "payload": payload}
        async with self._lock:
            targets = list(self._connections)
        if not targets:
            return
        delivered = await asyncio.gather(*(self._send(ws, message) for ws in targets))
        dead = [ws for ws, ok in zip(targets, delivered) if not ok]
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)
            # Закрываем, а не только забываем: иначе клиент так и висел бы на
            # соединении, по которому больше ничего не приходит, и не знал бы,
            # что пора переподключиться.
            for ws in dead:
                asyncio.create_task(_close_quietly(ws))

    async def _send(self, ws, message: dict[str, Any]) -> bool:
        try:
            await asyncio.wait_for(ws.send_json(message), SEND_TIMEOUT)
            return True
        except Exception:  # noqa: BLE001 -соединение закрыто, битое или не успело
            return False


async def _close_quietly(ws) -> None:
    close = getattr(ws, "close", None)
    if close is None:
        return
    try:
        await asyncio.wait_for(close(), SEND_TIMEOUT)
    except Exception:  # noqa: BLE001 -оно и так мёртвое
        pass
