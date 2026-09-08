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
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


class ChatHub:
    def __init__(self, members: Callable[[], Awaitable[int]] | None = None) -> None:
        # Сокет -> кто за ним. Ключом именно сокет: вкладок у человека много,
        # а закрывается каждая сама по себе.
        self._people: dict[Any, dict] = {}
        self._lock = asyncio.Lock()
        # Чем спросить размер форумной группы. Комната на сайте почти всегда
        # пуста - разговор идёт в Telegram, - и «1 в чате» читается как
        # заброшенное место, хотя людей рядом сотни. Число из форума ставит
        # комнату на своё место: здесь сейчас столько, а всего нас столько.
        self._members = members

    @property
    def connections(self) -> int:
        return len(self._people)

    def people(self) -> list[dict]:
        """Кто в комнате. Без повторов: две вкладки - один человек."""
        seen: dict[int, dict] = {}
        for who in self._people.values():
            seen.setdefault(who["id"], who)
        return list(seen.values())

    async def forum_size(self) -> int:
        """Сколько человек в форумной группе. Ноль - моста нет или он молчит.

        Отказ Telegram комнату не ломает: число рядом с присутствующими это
        справка, а не условие разговора.
        """
        if self._members is None:
            return 0
        try:
            return int(await self._members())
        except Exception as exc:  # noqa: BLE001 - соседняя система может всё
            logger.warning("Размер форума не получен: %s", exc)
            return 0

    async def presence(self) -> dict:
        """Кто в комнате и сколько нас всего - одной посылкой."""
        return {"people": self.people(), "forum": await self.forum_size()}

    async def join(self, ws, who: dict) -> None:
        async with self._lock:
            self._people[ws] = who
        await self.broadcast("people", await self.presence())

    async def leave(self, ws) -> None:
        async with self._lock:
            self._people.pop(ws, None)
        await self.broadcast("people", await self.presence())

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
