"""Ежедневный сборщик снимков баланса студентов.

Раз в час проверяет всех активных одобренных студентов с weex_uid,
сохраняет снимок баланса за сегодня и обновляет дневной объём торгов.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import select

from core.db import SessionLocal
from core.models import BalanceSnapshot, Student
from core.weex.base import WeexClient

logger = logging.getLogger("nmnh.balance")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _today_range_ms() -> tuple[int, int]:
    """Возвращает (start_ms, end_ms) для текущего UTC-дня."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_ms = int(day_start.timestamp() * 1000)
    end_ms = int(now.timestamp() * 1000)
    return start_ms, end_ms


async def snapshot_all(weex: WeexClient) -> int:
    """Снимок баланса + дневной объём торгов для всех студентов."""
    today = _today_utc()
    saved = 0

    with SessionLocal() as session:
        students = session.execute(
            select(Student)
            .where(Student.is_approved.is_(True))
            .where(Student.is_active.is_(True))
            .where(Student.weex_uid.isnot(None))
        ).scalars().all()

        if not students:
            return 0

        # Один запрос к WEEX за дневные объёмы торгов всех рефералов
        start_ms, end_ms = _today_range_ms()
        volume_by_uid: dict[str, dict] = {}
        try:
            rows = await weex.get_channel_trade_asset(start_ms, end_ms, page=1)
            for row in rows:
                uid = str(row.get("uid", ""))
                if uid:
                    volume_by_uid[uid] = row
        except Exception as exc:
            logger.warning("Не удалось получить объёмы торгов: %s", exc)

        for student in students:
            uid = str(student.weex_uid).strip()
            existing = session.execute(
                select(BalanceSnapshot).where(
                    BalanceSnapshot.student_id == student.id,
                    BalanceSnapshot.date == today,
                )
            ).scalar_one_or_none()

            # Баланс — только если снимка ещё нет
            if existing is None:
                try:
                    balance = await weex.get_affiliate_balance(uid)
                except Exception as exc:
                    logger.warning("Не удалось получить баланс uid=%s: %s", uid, exc)
                    continue

                if balance is None:
                    continue

                existing = BalanceSnapshot(
                    student_id=student.id,
                    date=today,
                    balance_usdt=balance,
                    source="affiliate_api",
                )
                session.add(existing)

                student.balance_usdt = balance
                student.balance_source = "affiliate_api"
                saved += 1

            # Объём торгов — обновляем при каждом цикле (данные растут в течение дня)
            vol_row = volume_by_uid.get(uid)
            if vol_row and existing is not None:
                try:
                    existing.futures_volume = float(vol_row.get("futuresTradingAmount") or 0)
                    existing.spot_volume = float(vol_row.get("spotTradingAmount") or 0)
                except (TypeError, ValueError):
                    pass

        session.commit()

    logger.info("Balance snapshots: %d new for %s", saved, today)
    return saved


async def snapshot_student(weex: WeexClient, student_id: int, weex_uid: str) -> bool:
    """Снимок для конкретного студента (вызывается при входе)."""
    today = _today_utc()

    with SessionLocal() as session:
        existing = session.execute(
            select(BalanceSnapshot).where(
                BalanceSnapshot.student_id == student_id,
                BalanceSnapshot.date == today,
            )
        ).scalar_one_or_none()
        if existing:
            return False

        try:
            balance = await weex.get_affiliate_balance(weex_uid)
        except Exception as exc:
            logger.warning("Снимок при входе uid=%s: %s", weex_uid, exc)
            return False

        if balance is None:
            return False

        session.add(BalanceSnapshot(
            student_id=student_id,
            date=today,
            balance_usdt=balance,
            source="affiliate_api",
        ))
        session.commit()

    return True


class BalanceCollector:
    """Фоновый цикл ежечасной проверки снимков."""

    def __init__(self, weex: WeexClient, interval: float = 3600.0):
        self.weex = weex
        self.interval = interval
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        # Первый прогон сразу при старте
        try:
            await snapshot_all(self.weex)
        except Exception as exc:
            logger.warning("Первый прогон снимков: %s", exc)

        while True:
            await asyncio.sleep(self.interval)
            try:
                await snapshot_all(self.weex)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Сбой цикла снимков: %s", exc)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
