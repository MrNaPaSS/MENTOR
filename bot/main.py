"""Точка входа NMNH Signal Bot.

Запуск: ``python -m bot.main`` (требует .env с BOT_TOKEN и ADMIN_TG_ID).
Пока WEEX на моках (WEEX_USE_MOCK=true).
"""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from core.db import init_engine, create_all
from core import repo
from core.db import SessionLocal
from core.weex import get_weex_client
from bot.config import Config
from bot.mentor import build_mentor_router
from bot.student import build_student_router
from bot.scheduler import start_scheduler


def setup_database() -> None:
    init_engine()
    create_all()
    with SessionLocal() as session:
        repo.seed_settings(session)


async def run() -> None:
    config = Config.from_env()
    logging.basicConfig(level=getattr(logging, config.log_level, logging.INFO))
    logger = logging.getLogger("nmnh.bot")

    if not config.bot_token or not config.admin_tg_id:
        raise SystemExit("Заполните BOT_TOKEN и ADMIN_TG_ID в .env (см. .env.example).")

    setup_database()
    weex = get_weex_client(config.weex_use_mock)

    bot = Bot(config.bot_token)
    dp = Dispatcher(storage=MemoryStorage())
    dp["weex"] = weex  # инъекция в хендлеры по имени аргумента

    # Порядок важен: команды ментора (с фильтром по ID) — первыми.
    dp.include_router(build_mentor_router(config.admin_tg_id))
    dp.include_router(build_student_router(config.admin_tg_id, config.weex_referral_link))

    with SessionLocal() as session:
        interval = repo.load_settings(session).balance_sync_interval
    scheduler = start_scheduler(weex, interval_minutes=interval)

    logger.info("NMNH Signal Bot запущен (mock WEEX=%s)", config.weex_use_mock)
    try:
        await dp.start_polling(bot)
    finally:
        scheduler.shutdown(wait=False)
        await weex.close()
        await bot.session.close()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
