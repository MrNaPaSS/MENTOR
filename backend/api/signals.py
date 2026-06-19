"""Сигналы — чтение и создание/закрытие ментором (ТЗ §15.2)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from core import repo
from core.models import Signal
from core.parser import parse_signal
from bot.services import signal_service
from backend.deps import get_session, get_weex, get_settings, get_current_mentor, get_ws_manager
from backend.schemas import SignalOut, SignalCreate, SignalCreateDirect, SignalCreateResult, DeliveryPreview

router = APIRouter(prefix="/api/signals", tags=["signals"])


def _to_out(s: Signal) -> SignalOut:
    return SignalOut(
        id=s.id, symbol=s.symbol, direction=s.direction, leverage=s.leverage,
        entry_price=s.entry_price, entry_type=s.entry_type, stop_loss=s.stop_loss,
        tp1=s.tp1, tp2=s.tp2, tp3=s.tp3, margin_type=s.margin_type,
        target_audience=s.target_audience, status=s.status,
        chart_url=getattr(s, "chart_url", None),
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


@router.post("", response_model=SignalCreateResult, dependencies=[Depends(get_current_mentor)])
async def create_signal(
    body: SignalCreate,
    session=Depends(get_session),
    weex=Depends(get_weex),
    settings=Depends(get_settings),
    ws=Depends(get_ws_manager),
):
    """Создать сигнал из текста, рассчитать под аудиторию и сохранить доставки.

    Telegram-рассылку выполняет бот (общая БД); здесь сигнал создаётся, доставки считаются и
    рассылается WS-событие ``new_signal`` веб-клиентам.
    """
    parsed = parse_signal(body.text)
    if not parsed.is_valid:
        raise HTTPException(422, "; ".join(parsed.errors))

    resolved = await signal_service.resolve_signal(parsed, weex, settings)
    resolved.target_audience = body.audience
    ref = signal_service.reference_calc(
        resolved, settings, "turbo" if body.audience == "turbo" else "moderate"
    )
    tps = ref.take_profits
    signal = repo.create_signal(
        session,
        symbol=resolved.symbol, direction=resolved.direction,
        leverage=resolved.leverage or ref.leverage, entry_price=resolved.entry_price,
        entry_type=resolved.entry_type, margin_type=resolved.margin_type,
        stop_loss=ref.sl_price,
        tp1=tps[0].price if len(tps) > 0 else None,
        tp2=tps[1].price if len(tps) > 1 else None,
        tp3=tps[2].price if len(tps) > 2 else None,
        target_audience=body.audience, status="active",
        chart_url=body.chart_url or None,
    )

    previews: list[DeliveryPreview] = []
    for student in repo.audience_students(session, body.audience):
        calc = await signal_service.compute_for_student(resolved, student, weex, settings)
        status = "skipped" if calc.status == "skipped" else "pending"
        repo.record_delivery(
            session, signal.id, student.id,
            balance_at_signal=student.balance_usdt,
            margin_usd=None if calc.status == "skipped" else calc.margin_usd,
            position_size=None if calc.status == "skipped" else calc.position_size,
            risk_usd=None if calc.status == "skipped" else calc.risk_usd,
            status=status,
        )
        previews.append(DeliveryPreview(
            username=student.username, mode=student.mode, balance=student.balance_usdt,
            margin_usd=None if calc.status == "skipped" else calc.margin_usd,
            risk_usd=None if calc.status == "skipped" else calc.risk_usd,
            status=status,
        ))

    await ws.broadcast("new_signal", {"signal_id": signal.id, "symbol": signal.symbol,
                                      "direction": signal.direction, "leverage": signal.leverage})
    return SignalCreateResult(signal=_to_out(signal), deliveries=previews)


@router.post("/direct", response_model=SignalCreateResult, dependencies=[Depends(get_current_mentor)])
async def create_signal_direct(
    body: SignalCreateDirect,
    session=Depends(get_session),
    weex=Depends(get_weex),
    settings=Depends(get_settings),
    ws=Depends(get_ws_manager),
):
    """Создать сигнал из структурированных полей (без текстового парсера)."""
    sym = body.symbol.upper()
    if not sym.endswith(("USDT", "USDC", "USD")):
        sym += "USDT"
    direction = body.direction.upper()
    if direction not in ("LONG", "SHORT"):
        raise HTTPException(422, "direction должен быть LONG или SHORT")

    signal = repo.create_signal(
        session,
        symbol=sym, direction=direction,
        leverage=body.leverage, entry_price=body.entry_price,
        entry_type=body.entry_type, margin_type=body.margin_type,
        stop_loss=body.stop_loss,
        tp1=body.tp1, tp2=body.tp2, tp3=body.tp3,
        target_audience=body.audience, status="active",
        chart_url=body.chart_url or None,
    )

    from core.parser import parse_signal as _parse
    from bot.services import signal_service as _svc
    parsed_for_calc = _parse(f"{sym} {direction}\nПлечо {body.leverage}x\nВход {body.entry_price}\nСтоп {body.stop_loss}")
    resolved = await _svc.resolve_signal(parsed_for_calc, weex, settings)
    resolved.target_audience = body.audience

    previews: list[DeliveryPreview] = []
    for student in repo.audience_students(session, body.audience):
        calc = await _svc.compute_for_student(resolved, student, weex, settings)
        status = "skipped" if calc.status == "skipped" else "pending"
        repo.record_delivery(
            session, signal.id, student.id,
            balance_at_signal=student.balance_usdt,
            margin_usd=None if calc.status == "skipped" else calc.margin_usd,
            position_size=None if calc.status == "skipped" else calc.position_size,
            risk_usd=None if calc.status == "skipped" else calc.risk_usd,
            status=status,
        )
        previews.append(DeliveryPreview(
            username=student.username, mode=student.mode, balance=student.balance_usdt,
            margin_usd=None if calc.status == "skipped" else calc.margin_usd,
            risk_usd=None if calc.status == "skipped" else calc.risk_usd,
            status=status,
        ))

    await ws.broadcast("new_signal", {"signal_id": signal.id, "symbol": signal.symbol,
                                      "direction": signal.direction, "leverage": signal.leverage})
    return SignalCreateResult(signal=_to_out(signal), deliveries=previews)


@router.patch("/{signal_id}/close", response_model=SignalOut, dependencies=[Depends(get_current_mentor)])
async def close_signal(signal_id: int, session=Depends(get_session), ws=Depends(get_ws_manager)):
    s = session.get(Signal, signal_id)
    if s is None:
        raise HTTPException(404, "Сигнал не найден")
    s.status = "closed"
    s.closed_at = datetime.now(timezone.utc)
    session.commit()
    await ws.broadcast("signal_closed", {"signal_id": s.id})
    return _to_out(s)


@router.delete("/{signal_id}", dependencies=[Depends(get_current_mentor)])
async def delete_signal(signal_id: int, session=Depends(get_session), ws=Depends(get_ws_manager)):
    from sqlalchemy import delete as sql_delete
    from core.models import SignalDelivery
    s = session.get(Signal, signal_id)
    if s is None:
        raise HTTPException(404, "Сигнал не найден")
    session.execute(sql_delete(SignalDelivery).where(SignalDelivery.signal_id == signal_id))
    session.delete(s)
    session.commit()
    await ws.broadcast("signal_deleted", {"signal_id": signal_id})
    return {"ok": True}
