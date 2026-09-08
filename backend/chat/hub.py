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

# Как часто окликать комнату. Двадцать пять секунд - меньше, чем держит
# открытым молчащее соединение любой прокси на пути (у Cloudflare это сто), и
# достаточно редко, чтобы не мешать разговору.
SWEEP = 25.0


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

    async def sweep(self) -> None:
        """Окликнуть комнату и убрать тех, кто не отозвался.

        Присутствие врало в большую сторону: вкладку закрывают на ходу, ноутбук
        усыпляют, сеть пропадает - и сокет остаётся у нас открытым, пока в него
        не попробуют что-нибудь послать. В тихой комнате посылать нечего, и
        «трое в чате» держалось часами после того, как все ушли.

        Оклик заодно держит соединение живым: прокси на пути закрывают
        молчащие сокеты, и без него разговор обрывался у тех, кто просто
        смотрел на график.
        """
        async with self._lock:
            targets = list(self._people.items())

        dead = []
        for ws, _ in targets:
            try:
                await ws.send_json({"event": "ping", "payload": {}})
            except Exception:  # noqa: BLE001 - оборвался и оборвался
                dead.append(ws)

        if not dead:
            return
        async with self._lock:
            for ws in dead:
                self._people.pop(ws, None)
        logger.info("Чат: ушло молча %d", len(dead))
        await self.broadcast("people", await self.presence())

    async def watch(self) -> None:
        """Оклик по кругу. Живёт столько же, сколько само приложение."""
        while True:
            await asyncio.sleep(SWEEP)
            try:
                await self.sweep()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - комната важнее уборки
                logger.warning("Чат: оклик не удался: %s", exc)

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
