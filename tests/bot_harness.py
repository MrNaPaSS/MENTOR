"""Тестовый harness для хендлеров aiogram без сети.

Мок-сессия перехватывает исходящие вызовы (send_message, edit_text, …), а ``feed_*`` подаёт
апдейты в диспетчер так же, как это делает реальный Telegram.
"""

from __future__ import annotations

import time

from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import Update


class MockedSession(BaseSession):
    """Сессия, которая ничего не шлёт в сеть, а копит вызванные методы."""

    def __init__(self) -> None:
        super().__init__()
        self.requests: list = []

    async def close(self) -> None:  # noqa: D401
        return None

    async def make_request(self, bot, method, timeout=None):
        self.requests.append(method)
        return True  # хендлеры игнорируют возвращаемое значение

    async def stream_content(self, *args, **kwargs):  # pragma: no cover - не используется
        yield b""

    def method_names(self) -> list[str]:
        return [type(m).__name__ for m in self.requests]

    def texts(self) -> list[str]:
        out = []
        for m in self.requests:
            text = getattr(m, "text", None)
            if text is not None:
                out.append(text)
        return out


def make_bot() -> tuple[Bot, MockedSession]:
    session = MockedSession()
    bot = Bot(token="42:TESTTOKEN", session=session)
    return bot, session


def make_dispatcher(bot: Bot, *routers, **workflow) -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())
    for r in routers:
        dp.include_router(r)
    for key, value in workflow.items():
        dp[key] = value
    return dp


def _user(uid: int):
    return {"id": uid, "is_bot": False, "first_name": "U", "username": f"user{uid}"}


def _chat(uid: int):
    return {"id": uid, "type": "private"}


async def feed_message(dp: Dispatcher, bot: Bot, uid: int, text: str, update_id: int = 1):
    data = {
        "update_id": update_id,
        "message": {
            "message_id": update_id,
            "date": int(time.time()),
            "chat": _chat(uid),
            "from": _user(uid),
            "text": text,
        },
    }
    update = Update.model_validate(data, context={"bot": bot})
    return await dp.feed_update(bot, update)


async def feed_callback(dp: Dispatcher, bot: Bot, uid: int, data_str: str, update_id: int = 1):
    data = {
        "update_id": update_id,
        "callback_query": {
            "id": str(update_id),
            "from": _user(uid),
            "chat_instance": "ci",
            "data": data_str,
            "message": {
                "message_id": update_id,
                "date": int(time.time()),
                "chat": _chat(uid),
                "from": _user(uid),
                "text": "preview",
            },
        },
    }
    update = Update.model_validate(data, context={"bot": bot})
    return await dp.feed_update(bot, update)
