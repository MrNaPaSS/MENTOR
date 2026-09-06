"""Журнал сделок скальпинг-терминала и сохранённое рабочее место.

Журнал — это факт: сюда попадает только закрытая сделка, с ценой выхода и
результатом в деньгах. Незакрытые живут на клиенте, потому что до закрытия у
них нет итога, а статистика по намерениям никому не нужна.

Записи идентифицируются идентификатором с клиента: страница может отправить
сделку повторно после обрыва связи, и дубликат исказил бы и журнал, и календарь
прибыли. Повторная отправка обновляет существующую запись, а не создаёт вторую.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from core.models import ScalpTrade, ScalpWorkspace, Student, utcnow
from backend.deps import get_current_student, get_session

router = APIRouter(prefix="/api/journal", tags=["journal"])

# Сколько сделок отдаём за раз. Скальпер делает десятки сделок в день, и без
# потолка ответ вырастет до мегабайтов на длинной истории.
MAX_TRADES = 500

# Потолок сохранённого рабочего места. Настройки — это десяток чисел и флагов;
# всё, что крупнее, приехало не из интерфейса.
MAX_WORKSPACE_BYTES = 16_384

SIDES = {"long", "short"}
OUTCOMES = {"stop", "take", "manual"}


class TradeIn(BaseModel):
    """Закрытая сделка с клиента."""

    client_id: str = Field(min_length=1, max_length=64)
    symbol: str = Field(min_length=1, max_length=32)
    side: str
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    exit_price: float | None = Field(default=None, gt=0)
    qty: float = Field(gt=0)
    margin: float = Field(gt=0)
    leverage: int = Field(ge=1, le=400)
    takes_hit: int = Field(default=0, ge=0, le=10)
    # Комиссия обеих ног: по ней видно, почему на счёт пришло меньше.
    fee: float = Field(default=0, ge=0)
    targets: list[float] = Field(default_factory=list, max_length=10)
    outcome: str
    pnl: float
    opened_at: datetime | None = None
    closed_at: datetime
    note: str = Field(default="", max_length=255)


def _validate(trade: TradeIn) -> None:
    if trade.side not in SIDES:
        raise HTTPException(422, "Сторона сделки: long или short")
    if trade.outcome not in OUTCOMES:
        raise HTTPException(422, "Итог сделки: stop, take или manual")


def _as_utc(value: datetime | None) -> datetime | None:
    """Привести время к UTC: без часового пояса день в календаре уедет."""
    if value is None:
        return None
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    """Время наружу — всегда с зоной.

    SQLite хранит дату строкой и часовой пояс теряет. Отдать такую строку как
    есть значит заставить браузер прочитать её как местное время: у трейдера в
    другом поясе сделка уехала бы в соседний день календаря.
    """
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _row(trade: ScalpTrade) -> dict[str, Any]:
    return {
        "id": trade.id,
        "client_id": trade.client_id,
        "symbol": trade.symbol,
        "side": trade.side,
        "entry": float(trade.entry),
        "stop": float(trade.stop),
        "exit_price": float(trade.exit_price) if trade.exit_price is not None else None,
        "qty": float(trade.qty),
        "margin": float(trade.margin),
        "leverage": trade.leverage,
        "takes_hit": trade.takes_hit,
        "fee": float(trade.fee or 0),
        "targets": json.loads(trade.targets_json or "[]"),
        "outcome": trade.outcome,
        "pnl": float(trade.pnl),
        "opened_at": _iso(trade.opened_at),
        "closed_at": _iso(trade.closed_at),
        "note": trade.note,
    }


@router.get("/trades")
async def list_trades(
    days: int = Query(90, ge=1, le=365),
    symbol: str | None = Query(None, max_length=32),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Закрытые сделки за период, свежие первыми."""
    since = utcnow() - timedelta(days=days)
    query = (
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= since)
        .order_by(ScalpTrade.closed_at.desc())
        .limit(MAX_TRADES)
    )
    if symbol:
        query = query.where(ScalpTrade.symbol == symbol.upper())

    trades = session.execute(query).scalars().all()
    wins = [t for t in trades if float(t.pnl) > 0]
    losses = [t for t in trades if float(t.pnl) < 0]
    total = sum(float(t.pnl) for t in trades)

    return {
        "trades": [_row(t) for t in trades],
        "summary": {
            "count": len(trades),
            "pnl": round(total, 8),
            "wins": len(wins),
            "losses": len(losses),
            # Доля прибыльных считается от сделок с результатом: безубыток —
            # это не победа и не поражение, и в проценте ему места нет.
            "win_rate": round(len(wins) / max(1, len(wins) + len(losses)) * 100, 1),
            "best": round(max((float(t.pnl) for t in trades), default=0.0), 8),
            "worst": round(min((float(t.pnl) for t in trades), default=0.0), 8),
        },
    }


@router.post("/trades", status_code=201)
async def add_trade(
    body: TradeIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Записать закрытую сделку. Повторная отправка обновляет запись."""
    _validate(body)

    trade = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.client_id == body.client_id)
    ).scalar_one_or_none()

    if trade is None:
        trade = ScalpTrade(student_id=student.id, client_id=body.client_id)
        session.add(trade)

    trade.symbol = body.symbol.upper()
    trade.side = body.side
    trade.entry = body.entry
    trade.stop = body.stop
    trade.exit_price = body.exit_price
    trade.qty = body.qty
    trade.margin = body.margin
    trade.leverage = body.leverage
    trade.takes_hit = body.takes_hit
    trade.fee = body.fee
    trade.targets_json = json.dumps(body.targets)
    trade.outcome = body.outcome
    trade.pnl = body.pnl
    trade.opened_at = _as_utc(body.opened_at)
    trade.closed_at = _as_utc(body.closed_at) or utcnow()
    trade.note = body.note

    session.commit()
    session.refresh(trade)
    return _row(trade)


@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    trade = session.get(ScalpTrade, trade_id)
    if trade is None or trade.student_id != student.id:
        raise HTTPException(404, "Сделка не найдена")
    session.delete(trade)
    session.commit()
    return {"ok": True}


@router.get("/calendar")
async def calendar(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Прибыль журнала по дням месяца.

    Считается на месте, а не хранится: сделок за месяц сотни, а не миллионы, и
    отдельная таблица итогов означала бы ещё одно место, где данные расходятся.
    """
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)

    trades = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= start)
        .where(ScalpTrade.closed_at < end)
    ).scalars().all()

    days: dict[str, dict[str, float]] = {}
    for trade in trades:
        key = _as_utc(trade.closed_at).strftime("%Y-%m-%d")  # type: ignore[union-attr]
        day = days.setdefault(key, {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0})
        day["pnl"] += float(trade.pnl)
        day["trades"] += 1
        if float(trade.pnl) > 0:
            day["wins"] += 1
        elif float(trade.pnl) < 0:
            day["losses"] += 1

    return {
        "year": year,
        "month": month,
        "days": [
            {"date": key, "pnl": round(v["pnl"], 8), **{k: int(v[k]) for k in ("trades", "wins", "losses")}}
            for key, v in sorted(days.items())
        ],
        "total": round(sum(float(t.pnl) for t in trades), 8),
    }


@router.get("/workspace")
async def get_workspace(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранённый шаблон рабочего места. Пустой объект — значит не сохранял."""
    row = session.execute(
        select(ScalpWorkspace).where(ScalpWorkspace.student_id == student.id)
    ).scalar_one_or_none()
    if row is None:
        return {"payload": None, "updated_at": None}
    try:
        payload = json.loads(row.payload)
    except ValueError:
        payload = None
    return {"payload": payload, "updated_at": row.updated_at.isoformat()}


@router.put("/workspace")
async def save_workspace(
    payload: dict[str, Any],
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранить шаблон, чтобы он открывался на любом устройстве."""
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_WORKSPACE_BYTES:
        raise HTTPException(413, "Настройки слишком большие")

    row = session.execute(
        select(ScalpWorkspace).where(ScalpWorkspace.student_id == student.id)
    ).scalar_one_or_none()
    if row is None:
        row = ScalpWorkspace(student_id=student.id)
        session.add(row)
    row.payload = raw
    row.updated_at = utcnow()
    session.commit()
    return {"ok": True, "updated_at": row.updated_at.isoformat()}
