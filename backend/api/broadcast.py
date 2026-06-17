"""Рассылка анализа (чарт + текст) всем студентам без создания торгового сигнала."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.models import Student, Broadcast
from backend.deps import get_current_mentor, get_current_student, get_session, get_notifier, get_token_payload

router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])


def _tv_image_url(url: str) -> str | None:
    m = re.search(r"tradingview\.com/x/([A-Za-z0-9]+)", url)
    if not m:
        return None
    id_ = m.group(1)
    return f"https://s3.tradingview.com/snapshots/{id_[0].lower()}/{id_}.png"


class BroadcastIn(BaseModel):
    text: str = ""
    chart_url: Optional[str] = None
    audience: str = "all"


class BroadcastOut(BaseModel):
    id: int
    text: str
    chart_url: Optional[str]
    audience: str
    sent_count: int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/preview")
async def preview_broadcasts(session=Depends(get_session)):
    """Публичный эндпоинт для лендинга — только chart_url, без текста."""
    rows = session.execute(
        select(Broadcast)
        .where(Broadcast.chart_url.isnot(None))
        .order_by(Broadcast.created_at.desc())
        .limit(6)
    ).scalars().all()
    return [
        {"id": r.id, "chart_url": r.chart_url, "text": r.text, "created_at": r.created_at}
        for r in rows
    ]


@router.get("", response_model=list[BroadcastOut])
async def list_broadcasts(
    payload: dict = Depends(get_token_payload),
    session=Depends(get_session),
):
    rows = session.execute(
        select(Broadcast).order_by(Broadcast.created_at.desc()).limit(100)
    ).scalars().all()
    return rows


@router.delete("/{broadcast_id}", dependencies=[Depends(get_current_mentor)])
async def delete_broadcast(broadcast_id: int, session=Depends(get_session)):
    row = session.get(Broadcast, broadcast_id)
    if not row:
        raise HTTPException(404, "Не найден")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.post("", dependencies=[Depends(get_current_mentor)])
async def broadcast(
    body: BroadcastIn,
    session=Depends(get_session),
    notifier=Depends(get_notifier),
):
    stmt = select(Student).where(Student.is_approved == True, Student.is_active == True)
    if body.audience != "all":
        stmt = stmt.where(Student.mode == body.audience)
    students = session.execute(stmt).scalars().all()

    if not students:
        raise HTTPException(404, "Нет студентов в этой аудитории")

    image_url = _tv_image_url(body.chart_url) if body.chart_url else None
    sent = 0
    for s in students:
        if not s.tg_id:
            continue
        if image_url:
            ok = await notifier.send_photo(int(s.tg_id), image_url, caption=body.text)
        else:
            ok = await notifier.send_message(int(s.tg_id), body.text)
        if ok:
            sent += 1

    record = Broadcast(
        text=body.text,
        chart_url=body.chart_url,
        audience=body.audience,
        sent_count=sent,
        created_at=datetime.now(timezone.utc),
    )
    session.add(record)
    session.commit()

    return {"sent": sent, "total": len(students)}
