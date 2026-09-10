"""Ежедневный сборщик снимков баланса студентов.

Раз в час проверяет всех активных одобренных студентов с weex_uid,
сохраняет снимок баланса за сегодня и обновляет дневной объём торгов.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import or_, select

from backend.trading.funds import balance_by_keys, futures_volume_by_keys
from core.db import SessionLocal
from core.models import BalanceSnapshot, Student, WeexCredential
from core.weex.base import WeexClient
from core.weex.uid import clean_uid

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
        # Ученики, о балансе которых есть кого спросить: свои ключи биржи или
        # UID у наставника. Раньше брались только те, у кого есть UID, и ученик
        # с подключёнными ключами оставался без снимков вовсе.
        keyed = select(WeexCredential.student_id).where(WeexCredential.is_active.is_(True))
        students = session.execute(
            select(Student)
            .where(Student.is_approved.is_(True))
            .where(Student.is_active.is_(True))
            .where(or_(Student.weex_uid.isnot(None), Student.id.in_(keyed)))
        ).scalars().all()

        if not students:
            return 0

        # Один запрос к WEEX за дневные объёмы торгов всех рефералов
        start_ms, end_ms = _today_range_ms()
        volume_by_uid: dict[str, dict] = {}
        try:
            rows = await weex.get_channel_trade_asset(start_ms, end_ms, page=1)
            for row in rows:
                # По цифрам: в отчёте UID число, а у ученика в базе он мог
                # осесть с префиксом или пробелом - строка тогда не находилась,
                # и оборот дня оставался пустым.
                uid = clean_uid(row.get("uid"))
                if uid:
                    volume_by_uid[uid] = row
        except Exception as exc:
            logger.warning("Не удалось получить объёмы торгов: %s", exc)

        for student in students:
            # Пустая строка, а не "None": с тех пор как в обход попали ученики
            # без UID, str(None) превращался в строку и уходил на биржу как
            # настоящий идентификатор.
            uid = clean_uid(student.weex_uid)
            existing = session.execute(
                select(BalanceSnapshot).where(
                    BalanceSnapshot.student_id == student.id,
                    BalanceSnapshot.date == today,
                )
            ).scalar_one_or_none()

            # Баланс — только если снимка ещё нет
            if existing is None:
                # Сначала свои ключи ученика: они дают ту же цифру, что он
                # видит в приложении биржи. Партнёрская ручка по UID - взгляд
                # со стороны, и она остаётся запасной.
                source = "api_keys"
                balance = await balance_by_keys(session, student)

                if balance is None and uid:
                    source = "affiliate_api"
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
                    source=source,
                )
                session.add(existing)

                student.balance_usdt = balance
                student.balance_source = source
                saved += 1

            # Объём торгов — обновляем при каждом цикле (данные растут в течение дня)
            #
            # Порядок тот же, что и с балансом: свои ключи ученика первыми.
            # Партнёрская ручка по UID - взгляд со стороны, она приходит с
            # задержкой; ключи показывают то же, что ученик видит у себя.
            #
            # С одной оговоркой. Лента исполнений приходит пачкой последних
            # сделок, без диапазона дат: если пачка заполнена целиком, за её
            # краем могли остаться сделки того же дня, и оборот выйдет
            # занижённым. Тогда предпочитаем партнёрскую цифру - она считает
            # день полностью.
            vol_row = volume_by_uid.get(uid)
            if existing is not None:
                # Спот виден только партнёрской ручке: ключи заведены под
                # фьючерсы, и другого счёта этот клиент не видит.
                if vol_row:
                    try:
                        existing.spot_volume = float(vol_row.get("spotTradingAmount") or 0)
                    except (TypeError, ValueError):
                        pass

                futures: float | None = None
                by_keys = await futures_volume_by_keys(session, student, today)
                if by_keys is not None and by_keys[1]:
                    futures = by_keys[0]
                elif vol_row:
                    try:
                        futures = float(vol_row.get("futuresTradingAmount") or 0)
                    except (TypeError, ValueError):
                        futures = None
                elif by_keys is not None:
                    # Отчёт неполон, а сверить не с чем: UID у ученика нет.
                    # Занижённый оборот честнее пустого - но скажем об этом в
                    # журнал, чтобы расхождение с биржей не искали вслепую.
                    futures = by_keys[0]
                    logger.info(
                        "Оборот ученика %s посчитан по неполной ленте исполнений: %.2f",
                        student.id,
                        futures,
                    )
                else:
                    # Оба пути молчали: ключей нет или биржа не ответила, а
                    # партнёрской строки по UID не пришло. Оборот дня остаётся
                    # нулём - навсегда, а не «пока не наберётся»: поле просто
                    # не пишется. В календаре это выглядит как «объём не
                    # собирается», и без этой записи причину пришлось бы
                    # искать вслепую.
                    logger.warning(
                        "Оборот ученика %s не с чего взять: "
                        "лента исполнений недоступна (ключи/keystore), "
                        "партнёрской строки по uid=%r нет "
                        "(в базе записано %r, в отчёте %d строк)",
                        student.id,
                        uid,
                        student.weex_uid,
                        len(volume_by_uid),
                    )

                if futures is not None:
                    existing.futures_volume = futures

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

        # Снимок дня - тем же порядком, что и везде: сначала свои ключи
        # ученика, потом партнёрская ручка по UID. Иначе дневная точка на
        # графике и цифра в углу экрана считались бы по разным источникам.
        student = session.get(Student, student_id)
        source = "api_keys"
        balance = await balance_by_keys(session, student) if student else None

        if balance is None and weex_uid:
            source = "affiliate_api"
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
            source=source,
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
