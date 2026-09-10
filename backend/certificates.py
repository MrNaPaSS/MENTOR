"""Сертификат трейдера: за что выдаётся и как считается.

Четыре столпа, как на бланке:

    знания     - в академии пройден курс (событие course_completed);
    практика   - 50 сделок, подтверждённых биржей;
    дисциплина - 20 торговых дней, в которые у каждой сделки стоял стоп;
    развитие   - календарный месяц в плюсе, не меньше 10 сделок в нём.

Уровень - по числу закрытых столпов: два - бронза, три - серебро, все четыре -
золото. Выдаётся сам, как только дотянулся, и только вверх: бронзу после
серебра не выдаём, а серебро после бронзы - да.

Считаем только сделки, подтверждённые биржей: оценку с экрана пишет клиент, и
сертификат по ней можно было бы нарисовать себе из консоли браузера.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.models import Certificate, CoinTransaction, ScalpTrade

PRACTICE_TRADES = 50
DISCIPLINE_DAYS = 20
GROWTH_MIN_TRADES = 10

LEVELS: dict[int, str] = {2: "bronze", 3: "silver", 4: "gold"}
RANK: dict[str, int] = {"bronze": 1, "silver": 2, "gold": 3}


@dataclass(frozen=True)
class Pillar:
    key: str
    done: bool
    value: int
    target: int


def pillars(session, student_id: int) -> list[Pillar]:
    knowledge = (
        session.execute(
            select(CoinTransaction.id)
            .where(CoinTransaction.student_id == student_id)
            .where(CoinTransaction.reason == "course_completed")
            .limit(1)
        ).first()
        is not None
    )

    rows = session.execute(
        select(ScalpTrade.closed_at, ScalpTrade.stop, ScalpTrade.pnl)
        .where(ScalpTrade.student_id == student_id)
        .where(ScalpTrade.from_exchange.is_(True))
    ).all()

    # День засчитывается дисциплине, если стоп стоял у каждой сделки дня: одна
    # сделка без стопа - и день не в счёт, как бы ни закончились остальные.
    days: dict = {}
    months: dict = {}
    for closed, stop, pnl in rows:
        if closed is None:
            continue
        if closed.tzinfo is None:
            closed = closed.replace(tzinfo=timezone.utc)
        day = closed.astimezone(timezone.utc).date()
        days[day] = days.get(day, True) and float(stop or 0) > 0
        month = (day.year, day.month)
        total, count = months.get(month, (0.0, 0))
        months[month] = (total + float(pnl or 0), count + 1)

    practice = len(rows)
    discipline = sum(1 for ok in days.values() if ok)
    growth = sum(1 for total, count in months.values() if total > 0 and count >= GROWTH_MIN_TRADES)

    return [
        Pillar("knowledge", knowledge, int(knowledge), 1),
        Pillar("practice", practice >= PRACTICE_TRADES, practice, PRACTICE_TRADES),
        Pillar("discipline", discipline >= DISCIPLINE_DAYS, discipline, DISCIPLINE_DAYS),
        Pillar("growth", growth >= 1, growth, 1),
    ]


def level_of(ps: list[Pillar]) -> str | None:
    return LEVELS.get(sum(1 for p in ps if p.done))


def issue(session, student_id: int) -> tuple[list[Pillar], Certificate | None]:
    """Посчитать столпы и выдать сертификат, если уровень вырос. Коммит за вызывающим."""
    ps = pillars(session, student_id)
    level = level_of(ps)
    if level is None:
        return ps, None

    have = session.execute(
        select(Certificate.level).where(Certificate.student_id == student_id)
    ).scalars().all()
    best = max((RANK.get(one, 0) for one in have), default=0)
    if RANK[level] <= best:
        return ps, None

    cert = Certificate(
        student_id=student_id,
        level=level,
        pillars_json=json.dumps([asdict(p) for p in ps]),
    )
    session.add(cert)
    try:
        session.flush()
    except IntegrityError:
        # Тот же уровень выдал соседний запрос мгновением раньше.
        session.rollback()
        return ps, None
    return ps, cert


def number_of(cert: Certificate) -> str:
    """Номер на бланке: год выдачи и порядковый номер записи."""
    year = cert.issued_at.year if cert.issued_at else 0
    return f"NMNH-{year}-{cert.id:05d}"
