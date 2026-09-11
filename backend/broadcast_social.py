"""Просмотры, лайки и комментарии разборов ментора.

Логика отдельно от ручек: счётчики нужны и списку разборов, и ответу на
лайк, и тестам - без HTTP.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from core.models import Broadcast, BroadcastComment, BroadcastReaction, utcnow

VIEW = "view"
LIKE = "like"

# Самый длинный комментарий. Под разбором спорят о сделке, а не пишут
# статьи: длиннее - это уже сообщение в чат.
MAX_COMMENT = 800
# Пауза между комментариями одного ученика: от случайного двойного нажатия и
# от того, кто решил залить ленту.
COMMENT_COOLDOWN = timedelta(seconds=5)
# Сколько разборов отмечается одним заходом: столько лента и отдаёт.
MAX_VIEWED = 100


@dataclass(frozen=True)
class Counts:
    views: int = 0
    likes: int = 0
    comments: int = 0
    liked: bool = False


def counts_for(session, ids: list[int], me: int | None) -> dict[int, Counts]:
    """Счётчики сразу для списка разборов - тремя запросами, а не тремя на каждый."""
    if not ids:
        return {}
    reactions = session.execute(
        select(BroadcastReaction.broadcast_id, BroadcastReaction.kind, func.count())
        .where(BroadcastReaction.broadcast_id.in_(ids))
        .group_by(BroadcastReaction.broadcast_id, BroadcastReaction.kind)
    ).all()
    comments = dict(
        session.execute(
            select(BroadcastComment.broadcast_id, func.count())
            .where(BroadcastComment.broadcast_id.in_(ids))
            .group_by(BroadcastComment.broadcast_id)
        ).all()
    )
    liked: set[int] = set()
    if me is not None:
        liked = set(
            session.execute(
                select(BroadcastReaction.broadcast_id).where(
                    BroadcastReaction.broadcast_id.in_(ids),
                    BroadcastReaction.student_id == me,
                    BroadcastReaction.kind == LIKE,
                )
            ).scalars()
        )
    views: dict[int, int] = {}
    likes: dict[int, int] = {}
    for broadcast_id, kind, n in reactions:
        (views if kind == VIEW else likes)[broadcast_id] = int(n)
    return {
        i: Counts(
            views=views.get(i, 0),
            likes=likes.get(i, 0),
            comments=int(comments.get(i, 0)),
            liked=i in liked,
        )
        for i in ids
    }


def _count(session, broadcast_id: int, kind: str) -> int:
    return int(
        session.execute(
            select(func.count()).where(
                BroadcastReaction.broadcast_id == broadcast_id, BroadcastReaction.kind == kind
            )
        ).scalar_one()
    )


def _find(session, broadcast_id: int, student_id: int, kind: str) -> BroadcastReaction | None:
    return session.execute(
        select(BroadcastReaction).where(
            BroadcastReaction.broadcast_id == broadcast_id,
            BroadcastReaction.student_id == student_id,
            BroadcastReaction.kind == kind,
        )
    ).scalar_one_or_none()


def mark_viewed(session, broadcast_id: int, student_id: int) -> int:
    """Отметить просмотр. Повторный ничего не меняет. Отдаёт число читателей."""
    if _find(session, broadcast_id, student_id, VIEW) is None:
        session.add(BroadcastReaction(broadcast_id=broadcast_id, student_id=student_id, kind=VIEW))
        try:
            session.commit()
        except IntegrityError:
            # Две вкладки отметили одновременно - просмотр уже записан.
            session.rollback()
    return _count(session, broadcast_id, VIEW)


def mark_viewed_many(session, ids: list[int], student_id: int) -> dict[int, int]:
    """Отметить просмотренными все разборы ленты разом. Отдаёт число читателей каждого.

    Так считается заход в раздел: человек открыл «Анализы» - он видел ленту.
    Неизвестные номера пропускаются, повторный заход ничего не меняет.
    """
    unique = sorted({int(i) for i in ids})[:MAX_VIEWED]
    if not unique:
        return {}
    known = set(session.execute(select(Broadcast.id).where(Broadcast.id.in_(unique))).scalars())
    if not known:
        return {}
    seen = set(
        session.execute(
            select(BroadcastReaction.broadcast_id).where(
                BroadcastReaction.broadcast_id.in_(known),
                BroadcastReaction.student_id == student_id,
                BroadcastReaction.kind == VIEW,
            )
        ).scalars()
    )
    fresh = sorted(known - seen)
    if fresh:
        session.add_all(
            [BroadcastReaction(broadcast_id=b, student_id=student_id, kind=VIEW) for b in fresh]
        )
        try:
            session.commit()
        except IntegrityError:
            # Вторая вкладка успела раньше - дописываем по одному, повторы отсеет база.
            session.rollback()
            for b in fresh:
                mark_viewed(session, b, student_id)
    counts = dict(
        session.execute(
            select(BroadcastReaction.broadcast_id, func.count())
            .where(BroadcastReaction.broadcast_id.in_(known), BroadcastReaction.kind == VIEW)
            .group_by(BroadcastReaction.broadcast_id)
        ).all()
    )
    return {b: int(counts.get(b, 0)) for b in sorted(known)}


def toggle_like(session, broadcast_id: int, student_id: int) -> tuple[bool, int]:
    """Поставить или снять лайк. Отдаёт (стоит ли теперь лайк, сколько их)."""
    row = _find(session, broadcast_id, student_id, LIKE)
    if row is not None:
        session.delete(row)
        session.commit()
        return False, _count(session, broadcast_id, LIKE)
    session.add(BroadcastReaction(broadcast_id=broadcast_id, student_id=student_id, kind=LIKE))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
    return True, _count(session, broadcast_id, LIKE)


class CommentError(ValueError):
    """Комментарий не принят: текст пустой, длинный или написан слишком часто."""


def add_comment(session, broadcast_id: int, student_id: int, text: str) -> BroadcastComment:
    body = (text or "").strip()
    if not body:
        raise CommentError("Комментарий пустой")
    if len(body) > MAX_COMMENT:
        raise CommentError(f"Комментарий длиннее {MAX_COMMENT} знаков")
    last = session.execute(
        select(BroadcastComment.created_at)
        .where(BroadcastComment.student_id == student_id)
        .order_by(BroadcastComment.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last is not None:
        stamp = last if last.tzinfo else last.replace(tzinfo=utcnow().tzinfo)
        if utcnow() - stamp < COMMENT_COOLDOWN:
            raise CommentError("Слишком часто - подождите пару секунд")
    row = BroadcastComment(broadcast_id=broadcast_id, student_id=student_id, text=body)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def purge(session, broadcast_id: int) -> None:
    """Убрать реакции и комментарии удаляемого разбора.

    Каскад в описании таблиц есть, но SQLite без особой настройки его не
    исполняет: удаляем явно, и поведение не зависит от базы.
    """
    session.query(BroadcastReaction).filter_by(broadcast_id=broadcast_id).delete()
    session.query(BroadcastComment).filter_by(broadcast_id=broadcast_id).delete()
