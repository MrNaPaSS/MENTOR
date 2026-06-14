"""Сигналы — чтение (ТЗ §15.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from core.models import Signal
from backend.deps import get_session
from backend.schemas import SignalOut

router = APIRouter(prefix="/api/signals", tags=["signals"])


def _to_out(s: Signal) -> SignalOut:
    return SignalOut(
        id=s.id, symbol=s.symbol, direction=s.direction, leverage=s.leverage,
        entry_price=s.entry_price, entry_type=s.entry_type, stop_loss=s.stop_loss,
        tp1=s.tp1, tp2=s.tp2, tp3=s.tp3, margin_type=s.margin_type,
        target_audience=s.target_audience, status=s.status,
    )


@router.get("", response_model=list[SignalOut])
def list_signals(limit: int = 50, offset: int = 0, status: str | None = None, session=Depends(get_session)):
    stmt = select(Signal).order_by(Signal.created_at.desc())
    if status:
        stmt = stmt.where(Signal.status == status)
    stmt = stmt.limit(min(limit, 200)).offset(offset)
    return [_to_out(s) for s in session.execute(stmt).scalars().all()]


@router.get("/active", response_model=list[SignalOut])
def active_signals(session=Depends(get_session)):
    rows = session.execute(
        select(Signal).where(Signal.status == "active").order_by(Signal.created_at.desc())
    ).scalars().all()
    return [_to_out(s) for s in rows]


@router.get("/{signal_id}", response_model=SignalOut)
def get_signal(signal_id: int, session=Depends(get_session)):
    s = session.get(Signal, signal_id)
    if s is None:
        raise HTTPException(404, "Сигнал не найден")
    return _to_out(s)
