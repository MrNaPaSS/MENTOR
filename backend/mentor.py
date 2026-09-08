"""Кто из учеников — наставник.

Признак один: телеграм-идентификатор из настроек. Отдельным модулем, потому
что спрашивают о нём в двух разных местах: в эндпоинтах, куда конфигурация
приходит зависимостью, и в обычных функциях, где её нет вовсе — подпись автора
собирается без запроса, а лента идёт ещё и через веб-сокет.

Раньше в этих местах стоял `getattr(student, "is_admin", False)`, а такого поля
у ученика нет: признак всегда выходил ложным, и наставник шёл в ленте обычным
учеником — без короны и под личным ником из телеграма.
"""

from __future__ import annotations

import os

from core.models import Student


def admin_tg_id() -> int:
    """Телеграм наставника из окружения. Не задан — значит наставника нет."""
    try:
        return int(os.getenv("ADMIN_TG_ID", "0") or "0")
    except ValueError:
        return 0


def is_mentor(student: Student | None) -> bool:
    """Наставник это или обычный ученик."""
    admin = admin_tg_id()
    return bool(admin) and student is not None and student.tg_id == admin
