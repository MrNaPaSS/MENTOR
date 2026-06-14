"""Проверка, что бот импортируется и роутеры собираются без ошибок.

Live-запуск требует токена, поэтому здесь — статическая проверка регистрации хендлеров.
"""

from aiogram import Router

from bot.mentor import build_mentor_router
from bot.student import build_student_router
from bot.middlewares import IsAdmin


def test_mentor_router_builds():
    router = build_mentor_router(admin_id=123)
    assert isinstance(router, Router)
    # У роутера зарегистрированы обработчики сообщений и колбэков.
    assert router.message.handlers
    assert router.callback_query.handlers


def test_student_router_builds():
    router = build_student_router(admin_id=123)
    assert isinstance(router, Router)
    assert router.message.handlers


async def test_is_admin_filter():
    flt = IsAdmin(999)

    class U:
        id = 999

    class Ev:
        from_user = U()

    assert await flt(Ev()) is True
    U.id = 1
    assert await flt(Ev()) is False


def test_main_module_imports():
    import bot.main  # noqa: F401
