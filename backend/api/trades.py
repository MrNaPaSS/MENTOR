"""Торгова активність студента через WEEX affiliate API."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from core.models import ScalpTrade, Student
from backend.deps import get_current_student, get_session, get_weex
from backend.trading.funds import trade_volume

router = APIRouter(prefix="/api/trades", tags=["trades"])
logger = logging.getLogger("nmnh.trades")


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _ts_to_iso(ts_ms: int | None) -> str | None:
    if not ts_ms:
        return None
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _journal_summary(session, student: Student, since_ms: int) -> dict[str, float] | None:
    """Оборот и комиссия по журналу терминала. `None` - сделок за срок нет.

    Запасной счёт на случай, когда биржа о торговле молчит: партнёрская ручка
    знает только тех, у кого заведён UID, а без её ответа обнулялось всё, что
    на обороте стоит - вехи, дни торговли и путь трейдера. Журнал считает
    меньше настоящего - в него попадает только то, что вёл терминал, - но это
    честное «сколько наторговал через нас», а не ноль.
    """
    since = datetime.fromtimestamp(since_ms / 1000, tz=timezone.utc)
    rows = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= since)
    ).scalars().all()
    if not rows:
        return None

    volume = sum(
        trade_volume(
            float(t.qty or 0), float(t.entry or 0), float(t.exit_price or 0) or None
        )
        for t in rows
    )
    return {
        "futures_volume": round(volume, 2),
        "spot_volume": 0.0,
        "total_volume": round(volume, 2),
        "deposit_total": 0.0,
        "withdrawal_total": 0.0,
        "commission": round(sum(float(t.fee or 0) for t in rows), 2),
    }


@router.get("/me")
async def trades_me(
    days: int = Query(30, ge=1, le=365),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 86_400_000

    # Без UID партнёрскую ручку спрашивать не о чем, но торговля у ученика
    # могла быть: терминал работает по ключам, а UID заводит наставник. Раньше
    # здесь стоял ранний выход, и такой ученик видел нулевой оборот, пустые
    # вехи и путь трейдера, застывший на первом уровне.
    if not student.weex_uid:
        return {
            "trades": [],
            "summary": _journal_summary(session, student, start_ms),
            "deposits": [],
            "withdrawals": [],
            "transactions": [],
            "needs_uid": True,
        }

    uid = str(student.weex_uid).strip()

    # Торговий підсумок за період
    all_rows = await weex.get_channel_trade_asset(start_ms, end_ms, page=1)
    user_row = next((r for r in all_rows if str(r.get("uid", "")) == uid), None)

    summary = None
    if user_row:
        logger.info("Trades uid=%s deposit=%.2f futures=%.2f", uid,
                    _to_float(user_row.get("depositAmount")), _to_float(user_row.get("futuresTradingAmount")))
        futures_vol = _to_float(user_row.get("futuresTradingAmount"))
        spot_vol = _to_float(user_row.get("spotTradingAmount"))
        withdrawal = _to_float(
            user_row.get("withdrawalAmount") or user_row.get("withdrawAmount") or
            user_row.get("withdrawal") or user_row.get("totalWithdrawal") or 0
        )
        summary = {
            "futures_volume": futures_vol,
            "spot_volume": spot_vol,
            "total_volume": futures_vol + spot_vol,
            "deposit_total": _to_float(user_row.get("depositAmount") or user_row.get("deposit") or 0),
            "withdrawal_total": withdrawal,
            "commission": _to_float(user_row.get("commission")),
        }

        # Журнал - нижняя граница оборота, и она бывает выше отчёта.
        #
        # Эти сделки точно были: терминал сам их открывал и закрывал, по ним
        # известны и объём, и цены. Партнёрская ручка при этом показывала на
        # том же счёте 155 долларов там, где журнал насчитал почти миллион, -
        # рядом на экране стояли «объём месяца» из журнала и «путь трейдера» из
        # отчёта, и второй выглядел сломанным.
        #
        # Заменяем только фьючерсный оборот: спот терминал не ведёт и знать о
        # нём не может, а пополнения с комиссией у биржи и без того точнее.
        mine = _journal_summary(session, student, start_ms)
        if mine and mine["futures_volume"] > futures_vol:
            summary["futures_volume"] = mine["futures_volume"]
            summary["total_volume"] = round(mine["futures_volume"] + spot_vol, 2)
    else:
        # Строки нет - оборот считаем по журналу, чтобы аналитика не обнулилась
        # целиком из-за молчания партнёрской ручки.
        logger.info("Trades uid=%s not found in channel_trade_asset", uid)
        summary = _journal_summary(session, student, start_ms)

    assets = await weex.get_agency_assert(uid)

    def _parse_deposit(d: dict) -> dict:
        amount = _to_float(d.get("amount") or d.get("depositAmount") or d.get("value") or 0)
        ts = int(d.get("updateTime") or d.get("createTime") or 0)
        return {
            "type":      "deposit",
            "amount":    amount,
            "coin":      d.get("coinName") or d.get("coin") or "USDT",
            "status":    d.get("status") or d.get("state"),
            "timestamp": ts,
            "date_iso":  _ts_to_iso(ts),
            "txid":      d.get("txId") or d.get("id"),
        }

    deposits = [_parse_deposit(d) for d in assets.get("depositList", []) if isinstance(d, dict)]
    deposits.sort(key=lambda x: x["timestamp"], reverse=True)

    logger.info("Trades uid=%s deposits=%d summary=%s", uid, len(deposits), summary)

    return {
        "trades":            [],
        "summary":           summary,
        "deposits":          deposits,
        "withdrawals":       [],
        "transactions":      deposits,
        "needs_uid":         False,
    }
