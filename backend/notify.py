"""Доставка уведомлений ученику в Telegram (контракт A-10).

Бэкенд шлёт код входа в Telegram через Bot API тем же ботом (BOT_TOKEN). Абстракция ``Notifier``
позволяет подменять доставку в тестах и работать без токена (NullNotifier + dev-код в ответе).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

logger = logging.getLogger("nmnh.notify")


class Notifier(ABC):
    @abstractmethod
    async def send_message(self, chat_id: int, text: str) -> bool:
        """Отправить сообщение. Возвращает True при успехе."""

    async def close(self) -> None:
        return None


class NullNotifier(Notifier):
    """Заглушка: ничего не шлёт (когда BOT_TOKEN не задан)."""

    async def send_message(self, chat_id: int, text: str) -> bool:
        logger.info("notify(null) -> %s: %s", chat_id, text)
        return False


class TelegramNotifier(Notifier):
    """Реальная доставка через Telegram Bot API (sendMessage)."""

    def __init__(self, token: str, session=None):
        self.token = token
        self._session = session
        self._owns_session = session is None

    async def _get_session(self):
        if self._session is None:
            import aiohttp

            self._session = aiohttp.ClientSession()
        return self._session

    async def send_message(self, chat_id: int, text: str) -> bool:
        session = await self._get_session()
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        try:
            async with session.post(url, json={"chat_id": chat_id, "text": text}) as resp:
                return resp.status == 200
        except Exception as exc:
            logger.warning("Не удалось отправить сообщение %s: %s", chat_id, exc)
            return False

    async def send_photo(self, chat_id: int, photo_url: str, caption: str = "") -> bool:
        session = await self._get_session()
        url = f"https://api.telegram.org/bot{self.token}/sendPhoto"
        try:
            async with session.post(url, json={"chat_id": chat_id, "photo": photo_url, "caption": caption}) as resp:
                return resp.status == 200
        except Exception as exc:
            logger.warning("Не удалось отправить фото %s: %s", chat_id, exc)
            return False

    async def close(self) -> None:
        if self._session is not None and self._owns_session:
            await self._session.close()


def get_notifier(token: str | None) -> Notifier:
    return TelegramNotifier(token) if token else NullNotifier()
