"""Периодическое обновление балансов учеников через аффилиат-API WEEX.

При недоступности баланса — оставляем последнее известное значение и помечаем источник
``manual`` (fallback, решение A-01). Возвращает счётчики для логов.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from core import repo
from core.db import SessionLocal
from core.models import BalanceSnapshot
from core.weex.base import WeexClient

logger = logging.getLogger("nmnh.scheduler")


def _upsert_snapshot(session, student_id: int, balance, source: str) -> None:
    """Сохранить (или обновить) снимок баланса за сегодняшний день UTC."""
    if balance is None:
        return
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = session.execute(
        select(BalanceSnapshot).where(
            BalanceSnapshot.student_id == student_id,
            BalanceSnapshot.date == today,
        )
    ).scalar_one_or_none()
    if existing:
        existing.balance_usdt = balance
        existing.source = source
    else:
        session.add(BalanceSnapshot(
            student_id=student_id,
            date=today,
            balance_usdt=balance,
            source=source,
        ))


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
                _upsert_snapshot(session, student.id, student.balance_usdt, "manual")
                failed += 1
            else:
                repo.set_balance(session, student, balance, "affiliate_api")
                _upsert_snapshot(session, student.id, balance, "affiliate_api")
                updated += 1
        session.commit()
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
