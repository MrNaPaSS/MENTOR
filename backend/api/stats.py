"""Публичная статистика и лидерборд (ТЗ §15.4)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select

from core import repo
from core.models import utcnow
from core.models import BalanceSnapshot, ScalpTrade, Signal, Student, WeexCredential
from backend.deps import get_session
from backend.schemas import PublicStats, LeaderboardRow, TraderRow

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
        LeaderboardRow(
            rank=i + 1, username=s.username, mode=s.mode, balance=s.balance_usdt,
            avatar=s.avatar_url, frame=s.avatar_frame or "",
        )
        for i, s in enumerate(rows)
    ]


# Окно таблицы по умолчанию: месяц. Неделя слишком коротка - один удачный день
# ставит человека наверх; квартал слишком долог - там уже не видно, кто в форме
# сейчас.
DEFAULT_DAYS = 30

# Сортировки таблицы. Ключ приходит с экрана, и подставлять его в запрос как
# есть нельзя: список закрытый.
TRADER_SORTS = ("volume", "pnl")


@router.get("/traders", response_model=list[TraderRow])
def traders(
    sort: str = Query(TRADER_SORTS[0]),
    days: int = Query(DEFAULT_DAYS, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    session=Depends(get_session),
):
    """Кто сколько наторговал за окно - по тем, у кого подключены ключи.

    Объём берём из дневных снимков: их собирает сборщик балансов, и у ученика с
    ключами он считает оборот по его же исполнениям. Результат - из журнала
    сделок, где лежат настоящие числа биржи, а не оценка с экрана.

    Ученики без ключей в таблицу не попадают вовсе. Их объём известен только со
    стороны, партнёрской ручкой, и приходит с задержкой; ставить их в один ряд
    с теми, чьи числа взяты у самой биржи, значит сравнивать несравнимое - а за
    места в этой таблице однажды будут давать награды.
    """
    if sort not in TRADER_SORTS:
        sort = TRADER_SORTS[0]

    since = (utcnow() - timedelta(days=days)).date().isoformat()

    keyed = select(WeexCredential.student_id).where(WeexCredential.is_active.is_(True))
    students = session.execute(
        select(Student)
        .where(Student.is_approved.is_(True), Student.is_active.is_(True))
        .where(Student.id.in_(keyed))
    ).scalars().all()
    if not students:
        return []

    ids = [s.id for s in students]

    # Оборот за окно: сумма дневных снимков.
    volume_rows = session.execute(
        select(
            BalanceSnapshot.student_id,
            func.sum(
                func.coalesce(BalanceSnapshot.futures_volume, 0)
                + func.coalesce(BalanceSnapshot.spot_volume, 0)
            ),
        )
        .where(BalanceSnapshot.student_id.in_(ids))
        .where(BalanceSnapshot.date >= since)
        .group_by(BalanceSnapshot.student_id)
    ).all()
    volume = {row[0]: float(row[1] or 0) for row in volume_rows}

    # Результат за окно: сумма закрытых сделок журнала.
    since_at = utcnow() - timedelta(days=days)
    pnl_rows = session.execute(
        select(
            ScalpTrade.student_id,
            func.sum(ScalpTrade.pnl),
            func.count(),
            func.sum(case((ScalpTrade.pnl > 0, 1), else_=0)),
        )
        .where(ScalpTrade.student_id.in_(ids))
        .where(ScalpTrade.closed_at >= since_at)
        .group_by(ScalpTrade.student_id)
    ).all()
    result = {row[0]: (float(row[1] or 0), int(row[2] or 0), int(row[3] or 0)) for row in pnl_rows}

    rows = []
    for student in students:
        pnl, trades, wins = result.get(student.id, (0.0, 0, 0))
        rows.append(
            {
                "username": student.username,
                "mode": student.mode,
                "volume": volume.get(student.id, 0.0),
                "pnl": pnl,
                "trades": trades,
                "wins": wins,
            }
        )

    rows.sort(key=lambda r: r[sort], reverse=True)
    return [TraderRow(rank=i + 1, **row) for i, row in enumerate(rows[:limit])]
