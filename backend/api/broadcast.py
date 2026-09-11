"""Рассылка анализа (чарт + текст) всем студентам без создания торгового сигнала."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from core.models import Student, Broadcast, BroadcastComment
from backend import broadcast_social as social
from backend.api.chat import _who
from backend.deps import get_current_mentor, get_current_student, get_session, get_notifier, get_token_payload
from backend.mentor import is_mentor

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
    symbol: Optional[str] = None
    audience: str = "all"


class BroadcastOut(BaseModel):
    id: int
    text: str
    chart_url: Optional[str]
    symbol: Optional[str] = None
    audience: str
    sent_count: int
    created_at: datetime
    # Сколько читателей, лайков и комментариев, и стоит ли лайк спрашивающего.
    views: int = 0
    likes: int = 0
    comments: int = 0
    liked: bool = False

    class Config:
        from_attributes = True


class CommentIn(BaseModel):
    text: str


class ViewedIn(BaseModel):
    ids: list[int]


def _me(payload: dict) -> int | None:
    """Номер ученика из токена. У токена ментора номера нет - лайков тоже."""
    sub = str(payload.get("sub", ""))
    return int(sub) if sub.isdigit() else None


def _broadcast(session, broadcast_id: int) -> Broadcast:
    row = session.get(Broadcast, broadcast_id)
    if row is None:
        raise HTTPException(404, "Разбор не найден")
    return row


def _comment_out(row: BroadcastComment, author: Student, me: int) -> dict:
    return {
        "id": row.id,
        "text": row.text,
        "created_at": row.created_at,
        "author": _who(author),
        "mine": author.id == me,
    }


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
    counts = social.counts_for(session, [r.id for r in rows], _me(payload))
    out = []
    for r in rows:
        c = counts.get(r.id, social.Counts())
        item = BroadcastOut.model_validate(r).model_copy(
            update={"views": c.views, "likes": c.likes, "comments": c.comments, "liked": c.liked}
        )
        out.append(item)
    return out


@router.post("/viewed")
async def viewed_broadcasts(
    body: ViewedIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Заход в «Анализы»: разборы ленты отмечаются просмотренными разом."""
    if len(body.ids) > social.MAX_VIEWED:
        raise HTTPException(400, f"Не больше {social.MAX_VIEWED} разборов за раз")
    views = social.mark_viewed_many(session, body.ids, student.id)
    return {"views": {str(k): v for k, v in views.items()}}


@router.post("/{broadcast_id}/view")
async def view_broadcast(
    broadcast_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    _broadcast(session, broadcast_id)
    return {"views": social.mark_viewed(session, broadcast_id, student.id)}


@router.post("/{broadcast_id}/like")
async def like_broadcast(
    broadcast_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    _broadcast(session, broadcast_id)
    liked, likes = social.toggle_like(session, broadcast_id, student.id)
    return {"liked": liked, "likes": likes}


@router.get("/{broadcast_id}/comments")
async def list_comments(
    broadcast_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    _broadcast(session, broadcast_id)
    rows = session.execute(
        select(BroadcastComment, Student)
        .join(Student, Student.id == BroadcastComment.student_id)
        .where(BroadcastComment.broadcast_id == broadcast_id)
        .order_by(BroadcastComment.created_at.asc())
        .limit(200)
    ).all()
    return [_comment_out(c, author, student.id) for c, author in rows]


@router.post("/{broadcast_id}/comments")
async def add_comment(
    broadcast_id: int,
    body: CommentIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    _broadcast(session, broadcast_id)
    try:
        row = social.add_comment(session, broadcast_id, student.id, body.text)
    except social.CommentError as exc:
        raise HTTPException(400, str(exc))
    return _comment_out(row, student, student.id)


@router.delete("/{broadcast_id}/comments/{comment_id}")
async def delete_comment(
    broadcast_id: int,
    comment_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    row = session.get(BroadcastComment, comment_id)
    if row is None or row.broadcast_id != broadcast_id:
        raise HTTPException(404, "Комментарий не найден")
    # Убрать может автор или наставник: он отвечает за порядок под разбором.
    if row.student_id != student.id and not is_mentor(student):
        raise HTTPException(403, "Чужой комментарий")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.delete("/{broadcast_id}", dependencies=[Depends(get_current_mentor)])
async def delete_broadcast(broadcast_id: int, session=Depends(get_session)):
    row = session.get(Broadcast, broadcast_id)
    if not row:
        raise HTTPException(404, "Не найден")
    social.purge(session, broadcast_id)
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

    symbol = body.symbol.strip().upper() if body.symbol else None
    record = Broadcast(
        text=body.text,
        chart_url=body.chart_url,
        symbol=symbol or None,
        audience=body.audience,
        sent_count=sent,
        created_at=datetime.now(timezone.utc),
    )
    session.add(record)
    session.commit()

    return {"sent": sent, "total": len(students)}
