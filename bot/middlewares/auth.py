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


class IsInvited(BaseFilter):
    """Свой это человек или чужой.

    Бот закрыт: он один на школу, и любой, кто нашёл его поиском, до этого
    фильтра доходил и получал ответ. Своими считаются наставник и заведённый
    ученик - тот, кого впустили. Одного наличия записи мало: запись заводило
    само нажатие «старт», и в списке оседали все, кто заглянул из любопытства.

    Чужой не получает ничего. Не отказ, а тишину: отказ - это тоже ответ, по
    нему видно, что бот живой, и он же приглашает попробовать ещё раз.
    """

    def __init__(self, admin_id: int):
        self.admin_id = admin_id

    async def __call__(self, event) -> bool:
        user = getattr(event, "from_user", None)
        if user is None:
            return False
        if self.admin_id and user.id == self.admin_id:
            return True
        # Импорт внутри: фильтр создаётся при сборке роутера, а база к тому
        # моменту может быть ещё не поднята.
        from core import repo
        from core.db import SessionLocal

        with SessionLocal() as session:
            student = repo.find_student(session, user.id)
        return bool(student and student.is_approved and student.is_active)
