"""Импорт кэшбэка из партнёрского отчёта биржи.

Раз в час забирает у WEEX партнёрские комиссии и раскладывает их по трейдерам:
сколько трейдер заплатил бирже, сколько из этого пришло NMNH и какая часть
возвращается ему кэшбэком. Отчёт текущих суток растёт до их конца, поэтому
берутся несколько последних: вчерашние тоже успевают дополниться, пока биржа
досчитывает.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.broker.cashback import (
    NO_CASHBACK,
    ZERO,
    DayTotal,
    Terms,
    Version,
    aggregate,
    report_window,
    split,
    to_decimal,
    version_on,
)
from core.db import SessionLocal
from core.models import CashbackAccrual, CashbackProgram, Student, utcnow
from core.weex.base import WeexClient
from core.weex.uid import clean_uid

logger = logging.getLogger("nmnh.cashback")

EXCHANGE = "weex"
IMPORT_DAYS = 3


def load_versions(session: Session, exchange: str = EXCHANGE) -> list[Version]:
    """Все версии условий биржи - в порядке, в котором их заводили."""
    rows = session.execute(
        select(CashbackProgram)
        .where(CashbackProgram.exchange == exchange)
        .order_by(CashbackProgram.valid_from, CashbackProgram.id)
    ).scalars()
    return [
        Version(
            valid_from=row.valid_from,
            terms=Terms(
                trader_share=to_decimal(row.trader_share),
                min_margin=to_decimal(row.min_margin),
                enabled=bool(row.enabled),
            ),
            ref=row.id,
        )
        for row in rows
    ]


def _students_by_uid(session: Session) -> dict[str, int]:
    """Ученики по UID в цифрах: в отчёте биржи он число, у нас мог осесть с префиксом."""
    rows = session.execute(select(Student.id, Student.weex_uid).where(Student.weex_uid.isnot(None)))
    return {clean_uid(uid): student_id for student_id, uid in rows if clean_uid(uid)}


def apply_totals(
    session: Session, totals: Sequence[DayTotal], exchange: str = EXCHANGE
) -> int:
    """Записать суточные итоги в начисления. Возвращает число записанных строк.

    Выплаченная строка не переписывается никогда: деньги ушли, и цифра под ними
    должна остаться той, по которой платили.
    """
    if not totals:
        return 0

    versions = load_versions(session, exchange)
    students = _students_by_uid(session)
    existing = {
        (row.uid, row.day): row
        for row in session.execute(
            select(CashbackAccrual)
            .where(CashbackAccrual.exchange == exchange)
            .where(CashbackAccrual.day.in_({total.day for total in totals}))
        ).scalars()
    }

    written = 0
    capped = 0
    now = utcnow()
    for total in totals:
        row = existing.get((total.uid, total.day))
        if row is not None and row.status == "paid":
            continue

        version = version_on(versions, total.day)
        terms = version.terms if version else NO_CASHBACK
        parts = split(total.fee, total.commission, terms)
        capped += int(parts.capped)

        if row is None:
            row = CashbackAccrual(exchange=exchange, uid=total.uid, day=total.day)
            session.add(row)
        row.student_id = students.get(total.uid, row.student_id)
        row.fee = total.fee
        row.commission = total.commission
        row.trader_share = terms.trader_share if terms.enabled else ZERO
        row.cashback = parts.cashback
        row.nmnh = parts.nmnh
        row.program_id = version.ref if version else None
        row.updated_at = now
        written += 1

    if capped:
        # Не ошибка, а сигнал: у этих трейдеров биржа платит нам меньше
        # обещанной доли - обычно это чужие рефералы.
        logger.info("Кэшбэк урезан потолком маржи у %d строк из %d", capped, written)
    return written


async def import_cashback(weex: WeexClient, days: int = IMPORT_DAYS) -> int:
    """Забрать партнёрский отчёт за последние сутки и пересчитать начисления."""
    start_ms, end_ms = report_window(days)
    rows = await weex.get_affiliate_commission_all(start_ms, end_ms)
    totals = aggregate(rows, start_ms, end_ms)
    with SessionLocal() as session:
        written = apply_totals(session, totals)
        session.commit()
    logger.info("Кэшбэк: %d строк отчёта, %d начислений за %d сут.", len(rows), written, days)
    return written


class CashbackCollector:
    """Фоновый цикл ежечасного импорта кэшбэка."""

    def __init__(self, weex: WeexClient, interval: float = 3600.0):
        self.weex = weex
        self.interval = interval
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await import_cashback(self.weex)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Сбой импорта кэшбэка: %s", exc)
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="cashback-import")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
