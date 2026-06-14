"""Фильтр доступа ментора: команды админки только от его Telegram ID (ТЗ §13)."""

from __future__ import annotations

from aiogram.filters import BaseFilter
from aiogram.types import Message, CallbackQuery


class IsAdmin(BaseFilter):
    def __init__(self, admin_id: int):
        self.admin_id = admin_id

    async def __call__(self, event) -> bool:
        user = getattr(event, "from_user", None)
        return bool(user and user.id == self.admin_id)
