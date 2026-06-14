"""Профиль ученика и личная аналитика (ТЗ §15.6, §15.4)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from core.models import SignalDelivery, Student
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
