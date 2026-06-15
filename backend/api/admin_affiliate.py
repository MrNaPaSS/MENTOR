"""Партнёрская статистика WEEX для админ-дашборда (только ментор).

Агрегирует данные аффилиат-API (getChannelUserTradeAndAsset / getAffiliateUIDs /
getAffiliateCommission / agency.getAssert) в KPI и таблицу рефералов. На моках — синтетика,
на реальном ключе — данные WEEX. Кэш короткий (TTL), чтобы не упираться в лимиты.
"""

from __future__ import annotations

import time
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_weex, get_current_mentor

router = APIRouter(prefix="/api/admin/affiliate", tags=["admin-affiliate"],
                   dependencies=[Depends(get_current_mentor)])

_DAY_MS = 86_400_000
_cache: dict[str, tuple[float, object]] = {}
_TTL = 120  # сек


def _d(v) -> Decimal:
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(0)


def _period(days: int) -> tuple[int, int]:
    end = int(time.time() * 1000)
    return end - days * _DAY_MS, end


async def _cached(key: str, factory):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    value = await factory()
    _cache[key] = (now, value)
    return value


class AffiliateOverview(BaseModel):
    referrals: int
    total_deposit: Decimal
    total_spot_volume: Decimal
    total_futures_volume: Decimal
    total_commission: Decimal
    period_days: int


class ReferralRow(BaseModel):
    uid: str
    register_time: int | None = None
    kyc: bool | None = None
    deposit: Decimal
    spot_volume: Decimal
    futures_volume: Decimal
    commission: Decimal


@router.get("/overview", response_model=AffiliateOverview)
async def overview(days: int = 30, weex=Depends(get_weex)):
    days = max(1, min(days, 90))
    start, end = _period(days)

    async def build():
        return await weex.get_channel_trade_asset(start, end)

    records = await _cached(f"trade:{days}", build)

    return AffiliateOverview(
        referrals=len(records),
        total_deposit=sum((_d(r.get("depositAmount")) for r in records), Decimal(0)),
        total_spot_volume=sum((_d(r.get("spotTradingAmount")) for r in records), Decimal(0)),
        total_futures_volume=sum((_d(r.get("futuresTradingAmount")) for r in records), Decimal(0)),
        total_commission=sum((_d(r.get("commission")) for r in records), Decimal(0)),
        period_days=days,
    )


@router.get("/referrals", response_model=list[ReferralRow])
async def referrals(days: int = 30, weex=Depends(get_weex)):
    days = max(1, min(days, 90))
    start, end = _period(days)

    async def build():
        uids = await weex.get_affiliate_uids(start, end)
        trade = await weex.get_channel_trade_asset(start, end)
        return uids, trade

    uids, trade = await _cached(f"refs:{days}", build)
    uid_meta = {u["uid"]: u for u in uids}

    rows = []
    for r in trade:
        meta = uid_meta.get(r["uid"], {})
        rows.append(ReferralRow(
            uid=r["uid"],
            register_time=meta.get("registerTime"),
            kyc=meta.get("kycResult"),
            deposit=_d(r.get("depositAmount")),
            spot_volume=_d(r.get("spotTradingAmount")),
            futures_volume=_d(r.get("futuresTradingAmount")),
            commission=_d(r.get("commission")),
        ))
    rows.sort(key=lambda x: x.futures_volume + x.spot_volume, reverse=True)
    return rows


class UidBalance(BaseModel):
    uid: str
    available_balance: Decimal
    contract_total: Decimal
    spot_total: Decimal


@router.get("/uid/{uid}/balance", response_model=UidBalance)
async def uid_balance(uid: str, weex=Depends(get_weex)):
    a = await weex.get_agency_assert(uid)
    return UidBalance(
        uid=uid,
        available_balance=_d(a.get("availableBalance")),
        contract_total=_d(a.get("contractTotalUsdt")),
        spot_total=_d(a.get("spotProTotalUsdt")),
    )
