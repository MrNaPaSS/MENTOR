"""Профиль ученика и личная аналитика (ТЗ §15.6, §15.4)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from core.models import BalanceSnapshot, SignalDelivery, Student
from backend.deps import get_session, get_current_student, get_weex
from backend.schemas import ProfileOut, ProfilePatch, AnalyticsMe

router = APIRouter(prefix="/api", tags=["profile"])


def _profile(s: Student) -> ProfileOut:
    return ProfileOut(
        id=s.id, username=s.username, weex_uid=s.weex_uid, mode=s.mode,
        language=s.language, risk_percent=s.risk_percent, turbo_leverage=s.turbo_leverage,
        balance_usdt=s.balance_usdt, balance_source=s.balance_source,
    )


@router.get("/profile", response_model=ProfileOut)
def get_profile(student: Student = Depends(get_current_student)):
    return _profile(student)


@router.patch("/profile", response_model=ProfileOut)
def patch_profile(
    body: ProfilePatch,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    fresh = session.get(Student, student.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(fresh, field, value)
    session.commit()
    return _profile(fresh)


@router.get("/profile/balance", response_model=ProfileOut)
async def refresh_balance(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    fresh = session.get(Student, student.id)
    if fresh.weex_uid:
        balance = await weex.get_affiliate_balance(fresh.weex_uid)
        if balance is not None:
            fresh.balance_usdt = balance
            fresh.balance_source = "affiliate_api"
            session.commit()
    return _profile(fresh)


@router.get("/analytics/me", response_model=AnalyticsMe)
def analytics_me(student: Student = Depends(get_current_student), session=Depends(get_session)):
    def count(status: str | None = None) -> int:
        stmt = select(func.count()).select_from(SignalDelivery).where(
            SignalDelivery.student_id == student.id
        )
        if status:
            stmt = stmt.where(SignalDelivery.status == status)
        return session.execute(stmt).scalar_one()

    return AnalyticsMe(
        signals_received=count(), sent=count("sent"),
        skipped=count("skipped"), failed=count("failed"),
    )


@router.get("/analytics/calendar")
async def analytics_calendar(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    """Календарь активности: PnL по снимкам баланса + сигналы + сделки + депозиты."""
    from calendar import monthrange

    prefix = f"{year:04d}-{month:02d}"
    _, days_in_month = monthrange(year, month)

    # ── DB: снимки баланса ──────────────────────────────────────────────────
    snapshots = session.execute(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.student_id == student.id)
        .where(BalanceSnapshot.date.like(f"{prefix}-%"))
        .order_by(BalanceSnapshot.date.asc())
    ).scalars().all()

    prev_snap = session.execute(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.student_id == student.id)
        .where(BalanceSnapshot.date < f"{prefix}-01")
        .order_by(BalanceSnapshot.date.desc())
        .limit(1)
    ).scalar_one_or_none()

    balance_by_date: dict[str, Decimal] = {s.date: Decimal(str(s.balance_usdt)) for s in snapshots}

    # ── DB: сигналы ─────────────────────────────────────────────────────────
    deliveries = session.execute(
        select(
            func.strftime("%Y-%m-%d", SignalDelivery.delivered_at).label("d"),
            func.count().label("n"),
        )
        .where(SignalDelivery.student_id == student.id)
        .where(SignalDelivery.status == "sent")
        .where(func.strftime("%Y-%m", SignalDelivery.delivered_at) == prefix)
        .group_by("d")
    ).all()
    signals_by_date: dict[str, int] = {row.d: row.n for row in deliveries if row.d}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    last_day = min(days_in_month, int(today[8:10])) if today.startswith(prefix) else days_in_month

    # ── WEEX: депозиты (live) ───────────────────────────────────────────────
    deposit_dates: set[str] = set()
    if student.weex_uid:
        uid = str(student.weex_uid).strip()
        try:
            assets = await weex.get_agency_assert(uid)
            for dep in assets.get("depositList", []):
                ts = dep.get("updateTime", 0)
                if not ts:
                    continue
                dep_date = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                if dep_date.startswith(prefix):
                    deposit_dates.add(dep_date)
        except Exception:
            pass

    # ── Объёмы торгов — из снимков в БД (заполняет balance_collector каждый час) ──
    volume_by_date: dict[str, float] = {}
    for snap in snapshots:
        if snap.futures_volume is not None or snap.spot_volume is not None:
            volume_by_date[snap.date] = float(snap.futures_volume or 0) + float(snap.spot_volume or 0)

    # ── Заполняем дни до первого снимка текущим балансом ───────────────────
    if snapshots:
        first_snap_bal = Decimal(str(snapshots[0].balance_usdt))
        first_snap_date = snapshots[0].date
        for _d in range(1, last_day + 1):
            _ds = f"{prefix}-{_d:02d}"
            if _ds < first_snap_date and _ds not in balance_by_date:
                balance_by_date[_ds] = first_snap_bal

    # ── Строим список дней ──────────────────────────────────────────────────
    prev_balance: Decimal | None = Decimal(str(prev_snap.balance_usdt)) if prev_snap else None
    first_snapshot_seen = False
    days_out = []
    for d in range(1, last_day + 1):
        date_str = f"{prefix}-{d:02d}"
        balance = balance_by_date.get(date_str)
        is_real = date_str in {s.date for s in snapshots}
        pnl_pct: float | None = None
        if balance is not None:
            if not first_snapshot_seen:
                pnl_pct = 0.0
                first_snapshot_seen = True
            elif prev_balance is not None and prev_balance > 0:
                pnl_pct = float((balance - prev_balance) / prev_balance * 100)
        vol = volume_by_date.get(date_str, 0.0)
        days_out.append({
            "date": date_str,
            "signals": signals_by_date.get(date_str, 0),
            "balance": float(balance) if balance is not None else None,
            "pnl_pct": pnl_pct,
            "estimated": not is_real and balance is not None,
            "trades": 1 if vol > 0 else 0,        # был ли торговый объём за день
            "trade_volume": vol,
            "has_deposit": date_str in deposit_dates,
        })
        if balance is not None:
            prev_balance = balance

    return {"days": days_out}
