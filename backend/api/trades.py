"""Торгова активність студента через WEEX affiliate API."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from core.models import Student
from backend.deps import get_current_student, get_weex

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


@router.get("/me")
async def trades_me(
    days: int = Query(30, ge=1, le=365),
    student: Student = Depends(get_current_student),
    weex=Depends(get_weex),
):
    if not student.weex_uid:
        return {"trades": [], "summary": None, "deposits": [], "needs_uid": True}

    uid = str(student.weex_uid).strip()
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 86_400_000

    # Торговий підсумок за період
    all_rows = await weex.get_channel_trade_asset(start_ms, end_ms, page=1)
    user_row = next((r for r in all_rows if str(r.get("uid", "")) == uid), None)

    summary = None
    if user_row:
        futures_vol = _to_float(user_row.get("futuresTradingAmount"))
        spot_vol = _to_float(user_row.get("spotTradingAmount"))
        summary = {
            "futures_volume": futures_vol,
            "spot_volume": spot_vol,
            "total_volume": futures_vol + spot_vol,
            "deposit_total": _to_float(user_row.get("depositAmount")),
            "withdrawal_total": _to_float(user_row.get("withdrawalAmount")),
            "commission": _to_float(user_row.get("commission")),
        }

    # Депозиты и выводы — параллельные запросы
    assets, withdraw_raw = await asyncio.gather(
        weex.get_agency_assert(uid),
        weex.get_agency_withdrawals(uid),
    )

    def _parse_tx(d: dict, tx_type: str) -> dict:
        amount = _to_float(
            d.get("amount") or d.get("withdrawAmount") or d.get("depositAmount") or d.get("value") or 0
        )
        ts = int(d.get("updateTime") or d.get("createTime") or d.get("time") or 0)
        return {
            "type":      tx_type,
            "amount":    amount,
            "coin":      d.get("coinName") or d.get("coin") or d.get("currency") or "USDT",
            "status":    d.get("status") or d.get("state"),
            "timestamp": ts,
            "date_iso":  _ts_to_iso(ts),
            "txid":      d.get("txId") or d.get("id") or d.get("hash"),
        }

    def _parse_tx_list(raw_list: list, tx_type: str) -> list:
        return [_parse_tx(d, tx_type) for d in raw_list if isinstance(d, dict)]

    # getAssert может вернуть depositList и/или withdrawalList
    deposits    = _parse_tx_list(assets.get("depositList",   []), "deposit")
    # Выводы: сначала из отдельного эндпоинта, иначе из getAssert
    withdraw_from_assert = (
        assets.get("withdrawalList") or assets.get("withdrawList") or
        assets.get("withdrawal_list") or []
    )
    withdrawals = _parse_tx_list(withdraw_raw or withdraw_from_assert, "withdrawal")

    # Объединяем и сортируем по времени (новые сверху)
    transactions = sorted(deposits + withdrawals, key=lambda x: x["timestamp"], reverse=True)

    logger.info(
        "Trades uid=%s deposits=%d withdrawals=%d assert_keys=%s",
        uid, len(deposits), len(withdrawals), list(assets.keys()),
    )

    return {
        "trades":       [],
        "summary":      summary,
        "deposits":     deposits,
        "withdrawals":  withdrawals,
        "transactions": transactions,
        "needs_uid":    False,
    }
