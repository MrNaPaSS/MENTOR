"""Кэшбэк трейдерам: сводка для ученика и управление программой для наставника.

Цифры берутся из начислений, которые раз в час собирает
`backend/cashback_collector.py` по партнёрскому отчёту биржи. Сама биржа здесь
не спрашивается: страница открывается мгновенно и не тратит лимит запросов.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select

from backend.cashback_collector import EXCHANGE, import_cashback, load_versions
from backend.deps import get_current_mentor, get_current_student, get_session, get_weex
from core.broker.cashback import ZERO, first_day, to_decimal, version_on
from core.models import CashbackAccrual, CashbackProgram, Student, iso
from core.weex.uid import clean_uid

router = APIRouter(prefix="/api/cashback", tags=["cashback"])
admin_router = APIRouter(
    prefix="/api/admin/cashback",
    tags=["admin-cashback"],
    dependencies=[Depends(get_current_mentor)],
)

MAX_DAYS = 90


def _period(days: int) -> int:
    return max(1, min(days, MAX_DAYS))


def _sum(values) -> Decimal:
    return sum((to_decimal(value) for value in values), ZERO)


# ── ученик ───────────────────────────────────────────────────────────────────


class CashbackDay(BaseModel):
    day: str
    fee: Decimal
    cashback: Decimal


class MyCashback(BaseModel):
    enabled: bool
    trader_share: Decimal
    period_days: int
    fee: Decimal
    cashback: Decimal
    paid: Decimal
    days: list[CashbackDay]


@router.get("/me", response_model=MyCashback)
def my_cashback(
    days: int = 30,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Кэшбэк ученика за период: сколько заплатил бирже и сколько вернётся."""
    days = _period(days)
    # По UID, а не только по ученику: начисление могло появиться раньше, чем
    # ученик завёлся у нас, и тогда в строке его ещё нет.
    owned = CashbackAccrual.student_id == student.id
    uid = clean_uid(student.weex_uid)
    if uid:
        owned = or_(owned, CashbackAccrual.uid == uid)

    rows = session.execute(
        select(CashbackAccrual)
        .where(CashbackAccrual.exchange == EXCHANGE)
        .where(CashbackAccrual.day >= first_day(days))
        .where(owned)
        .order_by(CashbackAccrual.day)
    ).scalars().all()

    current = version_on(load_versions(session), first_day(1))
    enabled = bool(current and current.terms.enabled)
    return MyCashback(
        enabled=enabled,
        trader_share=current.terms.trader_share if enabled and current else ZERO,
        period_days=days,
        fee=_sum(row.fee for row in rows),
        cashback=_sum(row.cashback for row in rows),
        paid=_sum(row.cashback for row in rows if row.status == "paid"),
        days=[
            CashbackDay(day=row.day, fee=to_decimal(row.fee), cashback=to_decimal(row.cashback))
            for row in rows
        ],
    )


# ── наставник: условия программы ─────────────────────────────────────────────


class ProgramIn(BaseModel):
    trader_share: Decimal = Field(ge=0, le=1)
    min_margin: Decimal = Field(default=Decimal(0), ge=0, le=1)
    enabled: bool = True
    # Сутки отчёта биржи, с которых действуют условия. Пусто - с сегодняшних.
    valid_from: str | None = None
    note: str = Field(default="", max_length=255)

    @field_validator("valid_from")
    @classmethod
    def _date(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("Дата в формате ГГГГ-ММ-ДД") from exc
        return value


class ProgramOut(BaseModel):
    id: int
    exchange: str
    trader_share: Decimal
    min_margin: Decimal
    enabled: bool
    valid_from: str
    note: str
    created_at: str | None


class ProgramState(BaseModel):
    current: ProgramOut | None
    history: list[ProgramOut]


def _program_out(row: CashbackProgram) -> ProgramOut:
    return ProgramOut(
        id=row.id,
        exchange=row.exchange,
        trader_share=to_decimal(row.trader_share),
        min_margin=to_decimal(row.min_margin),
        enabled=bool(row.enabled),
        valid_from=row.valid_from,
        note=row.note or "",
        created_at=iso(row.created_at),
    )


@admin_router.get("/program", response_model=ProgramState)
def program(session=Depends(get_session)):
    rows = session.execute(
        select(CashbackProgram)
        .where(CashbackProgram.exchange == EXCHANGE)
        .order_by(CashbackProgram.valid_from, CashbackProgram.id)
    ).scalars().all()
    current = version_on(load_versions(session), first_day(1))
    by_id = {row.id: row for row in rows}
    return ProgramState(
        current=_program_out(by_id[current.ref]) if current and current.ref in by_id else None,
        history=[_program_out(row) for row in reversed(rows)],
    )


@admin_router.post("/program", response_model=ProgramOut)
def set_program(body: ProgramIn, session=Depends(get_session)):
    """Новая версия условий. Прежние не правятся: они нужны для прошлых суток."""
    today = first_day(1)
    valid_from = body.valid_from or today
    # Задним числом условия не меняются: кэшбэк за прошедшие сутки трейдер уже
    # видел, и переписать его значит объяснять, куда делись деньги.
    if valid_from < today:
        raise HTTPException(422, "Условия действуют с сегодняшних суток или позже")

    row = CashbackProgram(
        exchange=EXCHANGE,
        trader_share=body.trader_share,
        min_margin=body.min_margin,
        enabled=body.enabled,
        valid_from=valid_from,
        note=body.note,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _program_out(row)


# ── наставник: сводка ────────────────────────────────────────────────────────


class CashbackOverview(BaseModel):
    period_days: int
    fee: Decimal
    commission: Decimal
    cashback: Decimal
    nmnh: Decimal
    paid: Decimal
    traders: int
    # Трейдеры из отчёта биржи, которых нет среди учеников: реферал торгует,
    # а кабинет не открыл. Комиссия с них всё равно наша.
    unmatched: int


class TraderRow(BaseModel):
    uid: str
    student_id: int | None
    username: str | None
    fee: Decimal
    commission: Decimal
    cashback: Decimal
    nmnh: Decimal


def _period_rows(session, days: int) -> list[CashbackAccrual]:
    return session.execute(
        select(CashbackAccrual)
        .where(CashbackAccrual.exchange == EXCHANGE)
        .where(CashbackAccrual.day >= first_day(days))
    ).scalars().all()


@admin_router.get("/overview", response_model=CashbackOverview)
def overview(days: int = 30, session=Depends(get_session)):
    days = _period(days)
    rows = _period_rows(session, days)
    uids = {row.uid for row in rows}
    matched = {row.uid for row in rows if row.student_id is not None}
    return CashbackOverview(
        period_days=days,
        fee=_sum(row.fee for row in rows),
        commission=_sum(row.commission for row in rows),
        cashback=_sum(row.cashback for row in rows),
        nmnh=_sum(row.nmnh for row in rows),
        paid=_sum(row.cashback for row in rows if row.status == "paid"),
        traders=len(uids),
        unmatched=len(uids - matched),
    )


@admin_router.get("/traders", response_model=list[TraderRow])
def traders(days: int = 30, session=Depends(get_session)):
    rows = _period_rows(session, _period(days))
    grouped: dict[str, list[CashbackAccrual]] = {}
    for row in rows:
        grouped.setdefault(row.uid, []).append(row)

    student_ids = {row.student_id for row in rows if row.student_id is not None}
    names = dict(
        session.execute(select(Student.id, Student.username).where(Student.id.in_(student_ids))).all()
    ) if student_ids else {}

    out = []
    for uid, items in grouped.items():
        student_id = next((item.student_id for item in items if item.student_id is not None), None)
        out.append(
            TraderRow(
                uid=uid,
                student_id=student_id,
                username=names.get(student_id),
                fee=_sum(item.fee for item in items),
                commission=_sum(item.commission for item in items),
                cashback=_sum(item.cashback for item in items),
                nmnh=_sum(item.nmnh for item in items),
            )
        )
    return sorted(out, key=lambda item: item.fee, reverse=True)


@admin_router.post("/import")
async def run_import(weex=Depends(get_weex)):
    """Забрать отчёт сейчас, не дожидаясь часового цикла."""
    return {"written": await import_cashback(weex)}
