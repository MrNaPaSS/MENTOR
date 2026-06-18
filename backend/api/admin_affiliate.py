"""Партнёрская статистика WEEX для админ-дашборда (только ментор).

Агрегирует данные аффилиат-API (getChannelUserTradeAndAsset / getAffiliateUIDs /
getAffiliateCommission / agency.getAssert) в KPI и таблицу рефералов. На моках — синтетика,
на реальном ключе — данные WEEX. Кэш короткий (TTL), чтобы не упираться в лимиты.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_weex, get_current_mentor

logger = logging.getLogger("nmnh.admin_affiliate")

router = APIRouter(prefix="/api/admin/affiliate", tags=["admin-affiliate"],
                   dependencies=[Depends(get_current_mentor)])

_DAY_MS = 86_400_000
_cache: dict[str, tuple[float, object]] = {}
_TTL = 10  # сек — короткий TTL для быстрого обновления при смене периода


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
    total_withdrawal: Decimal
    with_deposit: int       # сколько рефералов имеют депозит > 0
    active_traders: int     # сколько рефералов торговали (futures > 0)
    period_days: int


import asyncio

class ReferralRow(BaseModel):
    uid: str
    register_time: int | None = None
    kyc: bool | None = None
    deposit: Decimal
    balance: Decimal
    spot_volume: Decimal
    futures_volume: Decimal
    commission: Decimal
    withdrawal: Decimal
    has_traded: bool        # торговал ли вообще
    has_deposit: bool       # было ли пополнение



@router.get("/overview", response_model=AffiliateOverview)
async def overview(days: int = 30, weex=Depends(get_weex)):
    days = max(1, min(days, 90))
    start, end = _period(days)
    # getAffiliateUIDs максимум поддерживает 90 дней, берем 85 с запасом
    uid_start = end - 85 * _DAY_MS

    async def build():
        all_uids, trade = await asyncio.gather(
            weex.get_affiliate_uids_all(uid_start, end),
            weex.get_channel_trade_asset_all(start, end),
        )
        return all_uids, trade

    all_uids, records = await _cached(f"overview:{days}", build)

    # Рефералов показываем по торговым записям (реальный размер сети)
    return AffiliateOverview(
        referrals=len(records),
        total_deposit=sum((_d(r.get("depositAmount")) for r in records), Decimal(0)),
        total_spot_volume=sum((_d(r.get("spotTradingAmount")) for r in records), Decimal(0)),
        total_futures_volume=sum((_d(r.get("futuresTradingAmount")) for r in records), Decimal(0)),
        total_commission=sum((_d(r.get("commission")) for r in records), Decimal(0)),
        total_withdrawal=sum((_d(r.get("withdrawalAmount") or r.get("withdrawAmount") or r.get("withdrawal")) for r in records), Decimal(0)),
        with_deposit=sum(1 for r in records if _d(r.get("depositAmount")) > 0),
        active_traders=sum(1 for r in records if _d(r.get("futuresTradingAmount")) > 0 or _d(r.get("spotTradingAmount")) > 0),
        period_days=days,
    )


async def _get_user_balance(weex, uid: str) -> Decimal:
    key = f"user_balance:{uid}"
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < 60:  # кэш баланса 60 секунд
        return hit[1]
    try:
        a = await weex.get_agency_assert(uid)
        avail = _d(a.get("availableBalance"))
        contract = _d(a.get("contractTotalUsdt"))
        spot = _d(a.get("spotProTotalUsdt"))
        unimargin = _d(a.get("unimarginTotalUsdt"))
        funding = _d(a.get("fundingTotalUsdt"))
        calculated_total = contract + spot + unimargin + funding
        balance = max(avail, calculated_total)
    except Exception:
        balance = Decimal(0)
    _cache[key] = (now, balance)
    return balance


@router.get("/referrals", response_model=list[ReferralRow])
async def referrals(days: int = 30, weex=Depends(get_weex)):
    days = max(1, min(days, 90))
    start, end = _period(days)
    # getAffiliateUIDs максимум поддерживает 90 дней, берем 85 с запасом
    uid_start = end - 85 * _DAY_MS

    async def build():
        # Параллельно: метаданные (90 дней) + торговля (выбранный период), все страницы
        all_uids, trade = await asyncio.gather(
            weex.get_affiliate_uids_all(uid_start, end),
            weex.get_channel_trade_asset_all(start, end),
        )
        return all_uids, trade

    all_uids, trade = await _cached(f"refs:{days}", build)
    if trade:
        logger.info("WEEX getChannelUserTradeAndAsset sample keys: %s", list(trade[0].keys()))
    uid_meta = {u["uid"]: u for u in all_uids}

    # Получаем балансы всех рефералов параллельно (ограничиваем семафором на 10)
    sem = asyncio.Semaphore(10)
    async def get_bal(uid):
        async with sem:
            return uid, await _get_user_balance(weex, uid)

    bal_results = await asyncio.gather(*(get_bal(r["uid"]) for r in trade))
    balances = dict(bal_results)

    rows = []
    for r in trade:
        meta = uid_meta.get(r["uid"], {})
        dep = _d(r.get("depositAmount"))
        fut = _d(r.get("futuresTradingAmount"))
        spt = _d(r.get("spotTradingAmount"))
        rows.append(ReferralRow(
            uid=r["uid"],
            register_time=meta.get("registerTime"),
            kyc=meta.get("kycResult"),
            deposit=dep,
            balance=balances.get(r["uid"], Decimal(0)),
            spot_volume=spt,
            futures_volume=fut,
            commission=_d(r.get("commission")),
            withdrawal=_d(r.get("withdrawalAmount") or r.get("withdrawAmount") or r.get("withdrawal")),
            has_traded=(fut > 0 or spt > 0),
            has_deposit=(dep > 0),
        ))
    rows.sort(key=lambda x: x.futures_volume + x.spot_volume, reverse=True)
    return rows


class MentorBalance(BaseModel):
    available_balance: Decimal
    contract_total: Decimal
    spot_total: Decimal
    total_usdt: Decimal


@router.get("/mentor-balance", response_model=MentorBalance)
async def mentor_balance(weex=Depends(get_weex)):
    """Баланс самого ментора на WEEX (agency assert)."""
    async def build():
        return await weex.get_own_balance()

    a = await _cached("mentor_balance", build)
    if not a:
        return MentorBalance(
            available_balance=Decimal(0),
            contract_total=Decimal(0),
            spot_total=Decimal(0),
            total_usdt=Decimal(0),
        )
    avail = _d(a.get("availableBalance"))
    contract = _d(a.get("contractTotalUsdt"))
    spot = _d(a.get("spotProTotalUsdt"))
    unimargin = _d(a.get("unimarginTotalUsdt"))
    funding = _d(a.get("fundingTotalUsdt"))
    
    # Считаем сумму спотового, контрактного, маржинального и баланса финансирования.
    # available_balance является доступной частью этих балансов, поэтому не суммируется с ними.
    calculated_total = contract + spot + unimargin + funding
    # На случай расхождений берем максимум между вычисленным total и доступным
    total_usdt = max(avail, calculated_total)
    
    return MentorBalance(
        available_balance=avail,
        contract_total=contract,
        spot_total=spot,
        total_usdt=total_usdt,
    )


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


class CommissionPoint(BaseModel):
    date: str            # YYYY-MM-DD
    commission: Decimal
    spot: Decimal
    futures: Decimal


@router.get("/commission-series", response_model=list[CommissionPoint])
async def commission_series(days: int = 14, weex=Depends(get_weex)):
    days = max(1, min(days, 90))
    start, end = _period(days)

    async def build():
        return await weex.get_affiliate_commission(start, end)

    items = await _cached(f"comm:{days}", build)

    from datetime import datetime, timezone
    buckets: dict[str, dict] = {}
    for it in items:
        ts = int(it.get("date", 0)) / 1000
        day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        b = buckets.setdefault(day, {"commission": Decimal(0), "spot": Decimal(0), "futures": Decimal(0)})
        c = _d(it.get("commission"))
        b["commission"] += c
        if str(it.get("productType", "")).upper() == "FUTURES":
            b["futures"] += c
        else:
            b["spot"] += c

    return [
        CommissionPoint(date=d, commission=v["commission"], spot=v["spot"], futures=v["futures"])
        for d, v in sorted(buckets.items())
    ]
