"""Публичная статистика и лидерборд (ТЗ §15.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from core import repo
from core.models import Signal, Student
from backend.deps import get_session
from backend.schemas import PublicStats, LeaderboardRow

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/public", response_model=PublicStats)
def public_stats(session=Depends(get_session)):
    total = session.execute(select(func.count()).select_from(Signal)).scalar_one()
    active = session.execute(
        select(func.count()).select_from(Signal).where(Signal.status == "active")
    ).scalar_one()
    students = len(repo.list_students(session, only_approved=True, only_active=True))
    return PublicStats(total_signals=total, active_signals=active, active_students=students)


@router.get("/leaderboard", response_model=list[LeaderboardRow])
def leaderboard(session=Depends(get_session)):
    rows = session.execute(
        select(Student)
        .where(Student.is_approved.is_(True), Student.is_active.is_(True))
        .order_by(Student.balance_usdt.desc().nullslast())
    ).scalars().all()
    return [
        LeaderboardRow(rank=i + 1, username=s.username, mode=s.mode, balance=s.balance_usdt)
        for i, s in enumerate(rows)
    ]
