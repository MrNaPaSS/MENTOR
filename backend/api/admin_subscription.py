"""Разбор платежей руками: неопознанные переводы и выдача дней.

В криптовалюте всегда будут переводы, которые система сопоставить не может:
человек округлил сумму, заплатил не в ту сеть, отправил дважды, оплатил счёт,
истёкший вчера. Деньги при этом пришли - и без этих ручек они видны в базе, но
ничьи, пока кто-то не полезет туда руками.

Три действия, которые нужны наставнику:

* посмотреть, что лежит неразобранным;
* привязать перевод к человеку - дни начисляются той же дорогой, что и у
  обычной оплаты, с тем же предохранителем по `tx_hash`;
* выдать дни без денег: компенсация за простой, подарок, обещание, данное в
  переписке.

Защита - токен наставника, как у магазина и кэшбэка. Сервисный ключ сюда не
подходит: им ходит бот, а бот такие решения не принимает.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend import subscriptions
from backend.deps import get_current_mentor, get_session
from backend.payments import bsc
from core.models import OrphanPayment, PaymentIntent, Student, SubscriptionPayment, iso, utcnow

log = logging.getLogger("nmnh.subscription")

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_mentor)],
)


class ResolveIn(BaseModel):
    tx_hash: str = Field(max_length=80)
    # Кому зачесть: по номеру Telegram, как везде в общении с ботом.
    tg_id: int
    plan: str = Field(default="terminal", max_length=16)
    period: str = Field(default="month", max_length=8)
    reason: str = Field(default="ручной разбор", max_length=120)


class GrantIn(BaseModel):
    tg_id: int
    days: int = Field(ge=1, le=400)
    reason: str = Field(max_length=120)
    plan: str | None = Field(default=None, max_length=16)


def _student(session, tg_id: int) -> Student:
    student = session.scalars(select(Student).where(Student.tg_id == tg_id)).first()
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ученика с таким Telegram нет")
    return student


@router.get("/payments/orphans")
def orphans(
    limit: int = Query(default=50, ge=1, le=200),
    resolved: bool = Query(default=False),
    session=Depends(get_session),
) -> dict:
    """Неопознанные переводы. По умолчанию - только ждущие разбора.

    Разобранные показываются по запросу: спор «мне не зачли» разбирается по
    той же таблице, и стирать из неё историю нельзя.
    """
    query = select(OrphanPayment).order_by(OrphanPayment.seen_at.desc()).limit(limit)
    if not resolved:
        query = query.where(OrphanPayment.resolved_student_id.is_(None))

    rows = session.scalars(query).all()
    return {
        "payments": [
            {
                "tx_hash": row.tx_hash,
                "network": row.network,
                "from_address": row.from_address,
                "amount": bsc.format_usdt(row.amount_raw),
                "amount_raw": str(row.amount_raw),
                "seen_at": iso(row.seen_at),
                "resolved_student_id": row.resolved_student_id,
                "resolved_at": iso(row.resolved_at),
            }
            for row in rows
        ]
    }


@router.post("/payments/resolve")
def resolve(body: ResolveIn, session=Depends(get_session)) -> dict:
    """Зачесть неопознанный перевод человеку.

    Дни начисляются тем же кодом, что и обычная оплата: подарок новому,
    продление от остатка, событие боту и `UNIQUE (tx_hash)` против повторного
    зачёта. Разбор руками не должен считать дни по своим правилам - иначе у
    нас два начисления, и однажды они разойдутся.
    """
    orphan = session.get(OrphanPayment, body.tx_hash.strip().lower())
    if orphan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Такого перевода среди неопознанных нет")
    if orphan.resolved_student_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот перевод уже зачтён")

    student = _student(session, body.tg_id)
    try:
        plan = subscriptions.plan_of(body.plan)
        period = subscriptions.period_of(body.period)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    # Счёт заводим задним числом: начисление привязано к счёту, и без него
    # в истории оплат осталась бы запись, ведущая в никуда.
    intent = PaymentIntent(
        student_id=student.id,
        tg_id=student.tg_id,
        plan=plan.code,
        period=period,
        price_usd=subscriptions.price_of(plan, period),
        network=orphan.network,
        receiver=orphan.from_address or "",
        amount_raw=str(orphan.amount_raw),
        status="pending",
        expires_at=utcnow(),
    )
    session.add(intent)
    session.flush()

    payment = subscriptions.credit(
        session, intent, tx_hash=orphan.tx_hash, amount_raw=str(orphan.amount_raw)
    )
    if payment is None:
        # Тот же хеш уже начислен: перевод разбирали дважды.
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Этот перевод уже был начислен")

    payment.reason = body.reason[:120]
    orphan.resolved_student_id = student.id
    orphan.resolved_at = utcnow()
    session.commit()

    state = subscriptions.state(session, student.id)
    log.info(
        "Неопознанный перевод %s зачтён ученику %s: %d дней",
        orphan.tx_hash,
        student.id,
        payment.days_added,
    )
    return {
        "student_id": student.id,
        "days_added": payment.days_added,
        "plan": state.plan,
        "paid_until": iso(state.paid_until),
        "days_left": state.days_left,
    }


@router.post("/subscription/grant")
def grant(body: GrantIn, session=Depends(get_session)) -> dict:
    """Выдать дни без денег. Ложится в ту же историю, что и оплата, с причиной."""
    student = _student(session, body.tg_id)
    try:
        payment = subscriptions.grant_days(
            session, student.id, days=body.days, reason=body.reason, plan=body.plan
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    state = subscriptions.state(session, student.id)
    log.info("Наставник выдал %d дней ученику %s: %s", body.days, student.id, body.reason)
    return {
        "student_id": student.id,
        "days_added": payment.days_added,
        "plan": state.plan,
        "paid_until": iso(state.paid_until),
        "days_left": state.days_left,
    }


@router.get("/subscription/{tg_id}")
def state_of(tg_id: int, session=Depends(get_session)) -> dict:
    """Состояние подписки и последние оплаты - для разбора спора."""
    student = _student(session, tg_id)
    state = subscriptions.state(session, student.id)
    history = session.scalars(
        select(SubscriptionPayment)
        .where(SubscriptionPayment.student_id == student.id)
        .order_by(SubscriptionPayment.created_at.desc())
        .limit(20)
    ).all()
    return {
        "student_id": student.id,
        "active": state.active,
        "plan": state.plan,
        "paid_until": iso(state.paid_until),
        "days_left": state.days_left,
        "cancelled": state.cancelled,
        "payments": [
            {
                "created_at": iso(row.created_at),
                "days_added": row.days_added,
                "gift_days": row.gift_days,
                "tx_hash": row.tx_hash,
                "amount": bsc.format_usdt(row.amount_raw),
                "reason": row.reason,
            }
            for row in history
        ],
    }
