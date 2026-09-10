"""Сертификаты трейдера в кабинете: столпы, выданные уровни, отметка «получен»."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from backend import certificates
from backend.deps import get_current_student, get_session
from core.models import Certificate, Student, iso, utcnow

router = APIRouter(prefix="/api/certificates", tags=["certificates"])


class PillarOut(BaseModel):
    key: str
    done: bool
    value: int
    target: int


class CertificateOut(BaseModel):
    id: int
    level: str
    number: str
    issued_at: str
    # false - сертификат выдан, но ещё не открыт: горит уведомление.
    seen: bool
    pillars: list[PillarOut]


class CertificatesOut(BaseModel):
    pillars: list[PillarOut]
    level: str | None
    certificates: list[CertificateOut]
    # Чьё имя на бланке: подпись карточки, иначе ник.
    owner: str


def _out(cert: Certificate) -> CertificateOut:
    try:
        snap = json.loads(cert.pillars_json or "[]")
    except ValueError:
        snap = []
    return CertificateOut(
        id=cert.id,
        level=cert.level,
        number=certificates.number_of(cert),
        issued_at=iso(cert.issued_at) or "",
        seen=cert.seen_at is not None,
        pillars=[PillarOut(**p) for p in snap if isinstance(p, dict)],
    )


@router.get("", response_model=CertificatesOut)
def my_certificates(student: Student = Depends(get_current_student), session=Depends(get_session)):
    """Столпы и сертификаты. Уровень вырос - новый сертификат выдаётся здесь же."""
    ps, _ = certificates.issue(session, student.id)
    session.commit()
    rows = session.execute(
        select(Certificate)
        .where(Certificate.student_id == student.id)
        .order_by(Certificate.issued_at, Certificate.id)
    ).scalars().all()
    return CertificatesOut(
        pillars=[PillarOut(key=p.key, done=p.done, value=p.value, target=p.target) for p in ps],
        level=certificates.level_of(ps),
        certificates=[_out(c) for c in rows],
        owner=student.card_name or student.username or f"id{student.id}",
    )


@router.post("/{cert_id}/seen")
def mark_seen(cert_id: int, student: Student = Depends(get_current_student), session=Depends(get_session)):
    """Сертификат открыт: уведомление о нём больше не нужно."""
    cert = session.get(Certificate, cert_id)
    if cert is None or cert.student_id != student.id:
        raise HTTPException(404, "Сертификат не найден")
    if cert.seen_at is None:
        cert.seen_at = utcnow()
        session.commit()
    return {"ok": True}
