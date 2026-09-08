"""Доставка разговора в форумную группу Telegram.

Отдельным слоем от самого чата, и на то две причины.

Первая - частота. Telegram принимает в одну группу около двадцати сообщений в
минуту, а живой чат столько выдаёт за полминуты. Значит, между чатом и Telegram
обязана стоять очередь, иначе поток сообщений превращается в череду отказов.

Вторая - ожидание. Отправка в форум не должна задерживать ответ тому, кто
написал: его сообщение уже сохранено и уже разослано по комнате, а дошло ли оно
до Telegram - обстоятельство соседней системы. Поэтому наружу отсюда торчит
``submit`` без ожидания, а не ``await send``.

Что ушло в форум, помним в ``ChatBridge``: без этого сообщение, вернувшееся к
нам обновлением, легло бы в чат вторым экземпляром и поехало обратно.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from sqlalchemy import select

logger = logging.getLogger("nmnh.forum")

API = "https://api.telegram.org/bot{token}/{method}"

# Сколько сообщений в минуту разрешает группа. Держим с запасом: точного
# предела Telegram не объявляет, а платой за превышение служит отказ.
PER_MINUTE = 18
WINDOW = 60.0

# Сколько ждать, если Telegram попросил подождать, а срока не назвал.
RETRY_FALLBACK = 3.0

# Длина очереди. Дальше задания перестают ставиться: копить часами то, что
# должно было уйти секунду назад, бессмысленно - в форуме это уже не разговор.
QUEUE_MAX = 500

TIMEOUT = 15


class ForumBridge:
    """Односторонний мост «сайт -> форум»: очередь, частота и память отправок."""

    def __init__(self, token: str, chat_id: int, site_url: str, session=None) -> None:
        self.token = token or ""
        self.chat_id = int(chat_id or 0)
        self.site_url = (site_url or "").rstrip("/")
        self._session = session
        self._owns_session = session is None
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_MAX)
        self._task: asyncio.Task | None = None
        # Времена последних отправок - по ним считается, можно ли слать сейчас.
        self._sent: list[float] = []

    @property
    def enabled(self) -> bool:
        """Мост настроен. Без токена или адреса группы он молчит целиком."""
        return bool(self.token and self.chat_id)

    # ── Приём заданий ──

    def submit(self, job: dict) -> None:
        """Поставить задание в очередь. Не ждёт и не бросает.

        Переполнение очереди - не ошибка того, кто написал в чат: его сообщение
        принято и разослано. Поэтому здесь только запись в журнал.
        """
        if not self.enabled:
            return
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull:
            logger.warning("Очередь форума переполнена, задание отброшено: %s", job.get("op"))

    async def start(self) -> None:
        if not self.enabled or self._task is not None:
            return
        self._task = asyncio.create_task(self._work(), name="forum-bridge")
        logger.info("Мост чата с форумом %s запущен", self.chat_id)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._session is not None and self._owns_session:
            await self._session.close()
            self._session = None

    # ── Работа очереди ──

    async def _work(self) -> None:
        while True:
            job = await self._queue.get()
            try:
                await self._pace()
                await self._run(job)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - соседняя система может всё
                logger.warning("Задание форума не выполнено (%s): %s", job.get("op"), exc)
            finally:
                self._queue.task_done()

    async def _pace(self) -> None:
        """Подождать, если за минуту уже отправлено столько, сколько можно."""
        now = time.monotonic()
        self._sent = [t for t in self._sent if now - t < WINDOW]
        if len(self._sent) >= PER_MINUTE:
            await asyncio.sleep(WINDOW - (now - self._sent[0]) + 0.1)
            now = time.monotonic()
            self._sent = [t for t in self._sent if now - t < WINDOW]
        self._sent.append(time.monotonic())

    async def _run(self, job: dict) -> None:
        op = job.get("op")
        if op == "send":
            await self._send(job)
        elif op == "edit":
            await self._edit(job)
        elif op == "delete":
            await self._delete(job)

    # ── Обращения к Telegram ──

    async def _http(self):
        if self._session is None:
            import aiohttp

            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT))
        return self._session

    async def _call(self, method: str, payload: dict) -> dict | None:
        """Один вызов Bot API. Повтор ровно один - по просьбе самого Telegram.

        Просьбу подождать (429) выполняем: она приходит с точным сроком, и
        отправка после него проходит. Всё остальное считаем отказом - повторять
        вслепую значит слать одно и то же по кругу.
        """
        session = await self._http()
        url = API.format(token=self.token, method=method)
        for attempt in (1, 2):
            try:
                async with session.post(url, json=payload) as res:
                    status = res.status
                    body = await res.json(content_type=None)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Telegram %s недоступен: %s", method, exc)
                return None

            if body.get("ok"):
                return body.get("result") or {}

            if status == 429 and attempt == 1:
                wait = float((body.get("parameters") or {}).get("retry_after") or RETRY_FALLBACK)
                logger.info("Telegram просит подождать %.1f с", wait)
                await asyncio.sleep(wait + 0.5)
                continue

            logger.warning("Telegram %s отказал: %s", method, body.get("description"))
            return None
        return None

    def _keyboard(self, symbol: str, label: str) -> dict | None:
        """Кнопка «перейти к терминалу» под сообщением.

        Ведёт на монету, а не в кабинет вообще: попасть в терминал и искать
        там, о чём была речь, - лишний шаг ровно в тот момент, когда цена ещё
        та самая.
        """
        clean = "".join(c for c in (symbol or "").upper() if c.isalnum())
        if not clean or not self.site_url or not label:
            return None
        return {
            "inline_keyboard": [
                [{"text": label, "url": f"{self.site_url}/app/scalping?symbol={clean}"}]
            ]
        }

    async def _send(self, job: dict) -> None:
        payload: dict[str, Any] = {
            "chat_id": self.chat_id,
            "text": job["html"],
            "parse_mode": "HTML",
            # Превью разворачивается только там, где картинка и есть сообщение.
            # У спрятанной ссылки смысл в том, что её не видно, и простыня под
            # «BTC 1m» этот смысл отменяет.
            "link_preview_options": {"is_disabled": not job.get("preview")},
        }
        if job.get("topic_id"):
            payload["message_thread_id"] = int(job["topic_id"])
        if job.get("reply_to"):
            payload["reply_parameters"] = {"message_id": int(job["reply_to"])}

        keyboard = self._keyboard(job.get("symbol", ""), job.get("button", ""))
        if keyboard:
            payload["reply_markup"] = keyboard

        result = await self._call("sendMessage", payload)
        if not result:
            return

        tg_id = result.get("message_id")
        if tg_id and job.get("message_id"):
            self._remember(int(job["message_id"]), int(tg_id))

    async def _edit(self, job: dict) -> None:
        tg_id = self._known(int(job["message_id"]))
        if tg_id is None:
            return
        await self._call(
            "editMessageText",
            {
                "chat_id": self.chat_id,
                "message_id": tg_id,
                "text": job["html"],
                "parse_mode": "HTML",
                "link_preview_options": {"is_disabled": True},
            },
        )

    async def _delete(self, job: dict) -> None:
        tg_id = self._known(int(job["message_id"]))
        if tg_id is None:
            return
        await self._call("deleteMessage", {"chat_id": self.chat_id, "message_id": tg_id})
        self._forget(int(job["message_id"]))

    # ── Память отправок ──
    #
    # Своей короткой сессией: очередь живёт дольше любого запроса, и держать
    # чужую открытой всё это время нельзя.

    def _remember(self, message_id: int, tg_message_id: int) -> None:
        from core.db import SessionLocal
        from core.models import ChatBridge

        try:
            with SessionLocal() as session:
                session.add(
                    ChatBridge(
                        message_id=message_id,
                        tg_chat_id=self.chat_id,
                        tg_message_id=tg_message_id,
                    )
                )
                session.commit()
        except Exception as exc:  # noqa: BLE001 - связка не повод терять отправку
            logger.warning("Связка %s <-> %s не записана: %s", message_id, tg_message_id, exc)

    def _known(self, message_id: int) -> int | None:
        from core.db import SessionLocal
        from core.models import ChatBridge

        with SessionLocal() as session:
            return session.execute(
                select(ChatBridge.tg_message_id).where(ChatBridge.message_id == message_id)
            ).scalar_one_or_none()

    def _forget(self, message_id: int) -> None:
        from core.db import SessionLocal
        from core.models import ChatBridge

        with SessionLocal() as session:
            row = session.execute(
                select(ChatBridge).where(ChatBridge.message_id == message_id)
            ).scalar_one_or_none()
            if row is not None:
                session.delete(row)
                session.commit()
