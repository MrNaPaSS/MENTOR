"""Сервисные ручки подписки: ими пользуется бот академии.

Бот ведёт разговор с человеком, но денег не считает и прав не знает: у него
хранилище - файл, и транзакций там нет. Он спрашивает платформу и пересказывает
ответ. Поэтому здесь всё, что ему нужно: тарифы, счёт, состояние, отказ от
продления и очередь событий для рассылки.

Защита - тот же `X-Service-Key`, что у монет и паролей входа. Отдельного
механизма здесь нет намеренно: ключ один, и вторая дверь означала бы второй
способ её потерять.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend import notifications, subscriptions
from backend.api.coins import find_or_create_student, require_service_key
from backend.deps import get_session
from backend.payments import bsc
from core.models import Student, iso

log = logging.getLogger("nmnh.subscription")

router = APIRouter(
    prefix="/api/service",
    tags=["service"],
    dependencies=[Depends(require_service_key)],
)


class InvoiceIn(BaseModel):
    tg_id: int
    plan: str = Field(default="terminal", max_length=16)
    # month | year. Пусто - месяц: так вели себя все счета до годовой подписки.
    period: str = Field(default="month", max_length=8)
    username: str | None = Field(default=None, max_length=64)


class CancelIn(BaseModel):
    tg_id: int


class AckIn(BaseModel):
    ids: list[int] = Field(default_factory=list)


def _student(session, tg_id: int, username: str | None = None) -> Student:
    student, _ = find_or_create_student(
        session, tg_id=tg_id, weex_uid=None, username=username
    )
    session.commit()
    return student


@router.get("/subscription/plans")
def plans() -> dict:
    """Тарифы с обеими ценами: по этому ответу бот рисует тумблер месяц/год."""
    return {"plans": subscriptions.plans_view(), "network_label": bsc.NETWORK_LABEL}


@router.post("/subscription/invoice")
def invoice(body: InvoiceIn, session=Depends(get_session)) -> dict:
    """Выставить счёт. Нажал дважды - вернётся тот же, а не второй."""
    student = _student(session, body.tg_id, body.username)
    try:
        intent = subscriptions.open_invoice(
            session,
            student_id=student.id,
            plan=body.plan,
            period=body.period,
            tg_id=body.tg_id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except subscriptions.NoFreeAmount as exc:
        # Слотов на цену 99, и все заняты ожидающими счетами. Это не поломка
        # приёма, а редкая теснота: через час брони снимутся сами.
        log.warning("Свободной суммы нет для %s: %s", body.tg_id, exc)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Сейчас слишком много счетов ждут оплату. Попробуйте через час.",
        ) from exc
    except RuntimeError as exc:
        # Адрес приёма не задан или свободная сумма не нашлась. Человеку про
        # это знать нечего, но в журнале причина должна остаться.
        log.error("Счёт для %s не выставлен: %s", body.tg_id, exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Приём оплаты сейчас недоступен"
        ) from exc
    return subscriptions.invoice_view(intent)


@router.get("/subscription/status")
def status_of(tg_id: int = Query(...), session=Depends(get_session)) -> dict:
    """Состояние подписки. По нему бот решает, выдавать ли пароль входа."""
    student = session.query(Student).filter(Student.tg_id == tg_id).one_or_none()
    if student is None:
        # Человека у нас ещё нет - это не ошибка, а ответ «ничего нет».
        return {
            "active": False,
            "plan": "",
            "paid_until": None,
            "days_left": 0,
            "source": "",
            "expiring_soon": False,
            "cancelled": False,
            "terminal": False,
        }

    from backend.access import effective_access

    access = effective_access(session, student)
    state = subscriptions.state(session, student.id)
    return {
        "active": state.active,
        "plan": state.plan,
        "paid_until": iso(state.paid_until),
        "days_left": state.days_left,
        # referral | subscription | both | academy | пусто. Бот показывает по
        # нему, каким путём человек пришёл, и не предлагает купить то, что у
        # человека уже есть бесплатно.
        "source": access.source,
        "expiring_soon": state.expiring_soon,
        "cancelled": state.cancelled,
        # Пускать ли в терминал вообще: у реферала и ученика академии это
        # верно и без подписки.
        "terminal": access.terminal,
    }


@router.post("/subscription/cancel")
def cancel(body: CancelIn, session=Depends(get_session)) -> dict:
    """Отказ от продления. Оплаченные дни остаются - за них заплачено."""
    student = session.query(Student).filter(Student.tg_id == body.tg_id).one_or_none()
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ученик не найден")
    changed = subscriptions.cancel(session, student.id)
    state = subscriptions.state(session, student.id)
    return {"cancelled": changed, "paid_until": iso(state.paid_until), "active": state.active}


@router.get("/notifications")
def queue(
    kind: str = Query(default=notifications.KIND, max_length=16),
    limit: int = Query(default=50, ge=1, le=200),
    session=Depends(get_session),
) -> dict:
    """Что бот ещё не забрал. Событие лежит в очереди, пока он не подтвердит."""
    rows = notifications.pending(session, kind=kind, limit=limit)
    return {"events": [notifications.view(row) for row in rows]}


@router.post("/notifications/ack")
def ack(body: AckIn, session=Depends(get_session)) -> dict:
    """Отметить разосланное. Повторный ack тех же событий ничего не ломает."""
    return {"acked": notifications.ack(session, body.ids)}
