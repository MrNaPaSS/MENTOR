"""Обработчик форумной группы: посты ментора -> сайт."""

from __future__ import annotations

import re
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path

from aiogram import Bot, Router
from aiogram.filters import Filter
from aiogram.types import Message

from core.db import SessionLocal
from core.models import Broadcast

logger = logging.getLogger("nmnh.forum")

UPLOADS_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

TV_RE = re.compile(r"tradingview\.com/x/([A-Za-z0-9]+)")


def _tv_image_url(text: str) -> str | None:
    m = TV_RE.search(text or "")
    if not m:
        return None
    id_ = m.group(1)
    return f"https://s3.tradingview.com/snapshots/{id_[0].lower()}/{id_}.png"


class IsForumPost(Filter):
    def __init__(self, chat_id: int, admin_id: int):
        self.chat_id = chat_id
        self.admin_id = admin_id

    async def __call__(self, message: Message) -> bool:
        return (
            message.chat.id == self.chat_id
            and message.from_user is not None
            and message.from_user.id == self.admin_id
        )


def build_forum_router(forum_chat_id: int, admin_tg_id: int) -> Router:
    router = Router(name="forum")

    if not forum_chat_id:
        return router  # форум не настроен

    f = IsForumPost(forum_chat_id, admin_tg_id)

    @router.message(f)
    async def on_forum_message(message: Message, bot: Bot) -> None:
        text = message.caption or message.text or ""
        chart_url: str | None = None

        # Фото из Telegram - скачиваем
        if message.photo:
            photo = message.photo[-1]
            file = await bot.get_file(photo.file_id)
            ext = ".jpg"
            filename = f"{uuid.uuid4().hex}{ext}"
            dest = UPLOADS_DIR / filename
            await bot.download_file(file.file_path, destination=dest)
            chart_url = f"/uploads/{filename}"

        # TradingView ссылка в тексте/подписи
        elif _tv_image_url(text):
            tv_match = TV_RE.search(text)
            if tv_match:
                chart_url = f"https://www.tradingview.com/x/{tv_match.group(1)}/"

        # Игнорируем если нет ни фото ни ссылки ни текста
        if not text.strip() and not chart_url:
            return

        with SessionLocal() as session:
            record = Broadcast(
                text=text.strip(),
                chart_url=chart_url,
                audience="all",
                sent_count=0,
                created_at=datetime.now(timezone.utc),
            )
            session.add(record)
            session.commit()

        logger.info("Forum post saved: chart=%s text=%.40s", chart_url, text)
        await message.react([])  # можно добавить реакцию если нужно

    return router
