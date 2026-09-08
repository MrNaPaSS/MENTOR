"""Комната общего чата: кто в ней сейчас и кому рассылать сообщения.

Отдельно от общего менеджера подключений (``backend/ws/manager.py``): тот
рассылает всем подряд, а чату нужно знать не только сокеты, но и людей за ними.
Присутствие - половина смысла комнаты: по нему решают, ждать ли ответа, и
выдумывать его нельзя.

Один человек с двух вкладок - это один человек в списке, но два соединения в
рассылке. Поэтому здесь два счёта: соединения и люди.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class ChatHub:
    def __init__(self) -> None:
        # Сокет -> кто за ним. Ключом именно сокет: вкладок у человека много,
        # а закрывается каждая сама по себе.
        self._people: dict[Any, dict] = {}
        self._lock = asyncio.Lock()

    @property
    def connections(self) -> int:
        return len(self._people)

    def people(self) -> list[dict]:
        """Кто в комнате. Без повторов: две вкладки - один человек."""
        seen: dict[int, dict] = {}
        for who in self._people.values():
            seen.setdefault(who["id"], who)
        return list(seen.values())

    async def join(self, ws, who: dict) -> None:
        async with self._lock:
            self._people[ws] = who
        await self.broadcast("people", {"people": self.people()})

    async def leave(self, ws) -> None:
        async with self._lock:
            self._people.pop(ws, None)
        await self.broadcast("people", {"people": self.people()})

    async def broadcast(self, event: str, payload: dict) -> None:
        """Разослать всем в комнате.

        Отвалившиеся соединения убираем по ходу: сокет закрывается и без
        события ``disconnect`` - вкладку усыпили, сеть пропала, - и без чистки
        список присутствующих врал бы в большую сторону.
        """
        async with self._lock:
            targets = list(self._people.items())

        dead = []
        for ws, _ in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception:
                dead.append(ws)

        if not dead:
            return
        async with self._lock:
            for ws in dead:
                self._people.pop(ws, None)
        logger.info("Чат: убрано мёртвых соединений: %d", len(dead))
