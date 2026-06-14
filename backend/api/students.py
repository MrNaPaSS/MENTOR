"""Управление учениками (только ментор, ТЗ §15.3)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import repo
from core.models import Student
from backend.deps import get_session, get_current_mentor
from backend.schemas import StudentOut

router = APIRouter(prefix="/api/students", tags=["students"], dependencies=[Depends(get_current_mentor)])


def _to_out(s: Student) -> StudentOut:
    return StudentOut(
        id=s.id, username=s.username, weex_uid=s.weex_uid, mode=s.mode,
        language=s.language, balance_usdt=s.balance_usdt,
        is_active=s.is_active, is_approved=s.is_approved,
    )


class StudentPatch(BaseModel):
    mode: Optional[str] = None
    risk_percent: Optional[float] = None
    is_active: Optional[bool] = None
    is_approved: Optional[bool] = None


@router.get("", response_model=list[StudentOut])
def list_all(session=Depends(get_session)):
    return [_to_out(s) for s in repo.list_students(session)]


@router.get("/{student_id}", response_model=StudentOut)
def get_one(student_id: int, session=Depends(get_session)):
    s = session.get(Student, student_id)
    if s is None:
        raise HTTPException(404, "Ученик не найден")
    return _to_out(s)


@router.patch("/{student_id}", response_model=StudentOut)
def patch(student_id: int, body: StudentPatch, session=Depends(get_session)):
    s = session.get(Student, student_id)
    if s is None:
        raise HTTPException(404, "Ученик не найден")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(s, field, value)
    session.commit()
    return _to_out(s)


@router.post("/{student_id}/approve", response_model=StudentOut)
def approve(student_id: int, session=Depends(get_session)):
    s = session.get(Student, student_id)
    if s is None:
        raise HTTPException(404, "Ученик не найден")
    s.is_approved = True
    session.commit()
    return _to_out(s)


@router.delete("/{student_id}")
def delete(student_id: int, session=Depends(get_session)):
    s = session.get(Student, student_id)
    if s is None:
        raise HTTPException(404, "Ученик не найден")
    session.delete(s)
    session.commit()
    return {"ok": True}
