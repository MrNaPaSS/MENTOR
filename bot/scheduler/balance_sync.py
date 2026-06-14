"""Периодическое обновление балансов учеников через аффилиат-API WEEX.

При недоступности баланса — оставляем последнее известное значение и помечаем источник
``manual`` (fallback, решение A-01). Возвращает счётчики для логов.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from core import repo
from core.db import SessionLocal
from core.weex.base import WeexClient

logger = logging.getLogger("nmnh.scheduler")


async def sync_balances(weex: WeexClient) -> dict:
    """Обновить балансы всех одобренных активных учеников с WEEX UID."""
    updated, failed = 0, 0
    with SessionLocal() as session:
        students = repo.list_students(session, only_approved=True, only_active=True)
        for student in students:
            if not student.weex_uid:
                continue
            balance = await weex.get_affiliate_balance(student.weex_uid)
            if balance is None:
                # Баланс недоступен — оставляем последний, помечаем manual.
                repo.set_balance(session, student, student.balance_usdt, "manual")
                failed += 1
            else:
                repo.set_balance(session, student, balance, "affiliate_api")
                updated += 1
    logger.info("Синхронизация балансов: обновлено %s, не удалось %s", updated, failed)
    return {"updated": updated, "failed": failed}


def start_scheduler(weex: WeexClient, interval_minutes: int = 30) -> AsyncIOScheduler:
    """Запустить периодическую синхронизацию балансов."""
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        sync_balances, "interval", minutes=interval_minutes, args=[weex],
        id="balance_sync", replace_existing=True,
    )
    scheduler.start()
    return scheduler
