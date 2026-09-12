"""Institutional intelligence: CFTC COT, macro indicators, Bitcoin ETFs, AI analysis."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import uuid
from typing import Any
from urllib.parse import quote

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend import coin_ledger
from backend.ai_quota import AnalyzeQuota
from backend.config import BackendConfig
from backend.deps import get_ai_quota, get_config, get_current_student, get_session
from backend.sources import cache, session
from core.models import Student

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/institutional", tags=["institutional"])

# ── Constants ─────────────────────────────────────────────────────────────────

CFTC_URL = "https://publicreporting.cftc.gov/api/odata/v4/gpe5-46if"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart"

# Exact CME contract names used for filtering
CFTC_NAMES = {
    "BTC": "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    "ETH": "ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE",
}

YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
}

MACRO_SYMBOLS = {
    "DXY":   ("DX-Y.NYB", "Индекс доллара USD"),
    "US10Y": ("^TNX",     "US 10Y Treasury"),
    "SPX":   ("^GSPC",    "S&P 500"),
    "GOLD":  ("GC=F",     "Золото (XAU/USD)"),
    "OIL":   ("CL=F",     "Нефть WTI"),
    "VIX":   ("^VIX",     "VIX (страх рынка)"),
}

ETF_LIST = [
    {"name": "BlackRock IBIT",    "ticker": "IBIT"},
    {"name": "Fidelity FBTC",     "ticker": "FBTC"},
    {"name": "ARK 21Shares ARKB", "ticker": "ARKB"},
    {"name": "Bitwise BITB",      "ticker": "BITB"},
    {"name": "VanEck HODL",       "ticker": "HODL"},
    {"name": "Invesco BTCO",      "ticker": "BTCO"},
    {"name": "Franklin EZBC",     "ticker": "EZBC"},
]

NASDAQ_H = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# ── Fallback demo data (shown when live API unreachable) ──────────────────────

DEMO_COT: dict[str, list[dict]] = {
    "BTC": [
        {"date": "2026-06-10", "oi": 82_450, "nc_long": 22_100, "nc_short": 8_320, "nc_net": 13_780, "nc_net_chg": 890, "nc_long_pct": 26.8, "nc_short_pct": 10.1, "c_long": 9_200, "c_short": 24_800, "c_net": -15_600, "c_net_chg": -420, "c_long_pct": 11.2, "c_short_pct": 30.1, "nr_long": 4_100, "nr_short": 2_730, "nr_net": 1_370},
        {"date": "2026-06-03", "oi": 81_100, "nc_long": 21_210, "nc_short": 8_320, "nc_net": 12_890, "nc_net_chg": 340, "nc_long_pct": 26.2, "nc_short_pct": 10.3, "c_long": 9_400, "c_short": 24_200, "c_net": -14_800, "c_net_chg": -210, "c_long_pct": 11.6, "c_short_pct": 29.8, "nr_long": 4_050, "nr_short": 2_720, "nr_net": 1_330},
        {"date": "2026-05-27", "oi": 80_200, "nc_long": 20_870, "nc_short": 8_320, "nc_net": 12_550, "nc_net_chg": -120, "nc_long_pct": 26.0, "nc_short_pct": 10.4, "c_long": 9_100, "c_short": 23_900, "c_net": -14_800, "c_net_chg": 180, "c_long_pct": 11.3, "c_short_pct": 29.8, "nr_long": 3_900, "nr_short": 2_610, "nr_net": 1_290},
        {"date": "2026-05-20", "oi": 78_600, "nc_long": 20_350, "nc_short": 8_020, "nc_net": 12_330, "nc_net_chg": 510, "nc_long_pct": 25.9, "nc_short_pct": 10.2, "c_long": 8_800, "c_short": 23_500, "c_net": -14_700, "c_net_chg": -90, "c_long_pct": 11.2, "c_short_pct": 29.9, "nr_long": 3_800, "nr_short": 2_580, "nr_net": 1_220},
        {"date": "2026-05-13", "oi": 76_900, "nc_long": 19_840, "nc_short": 8_020, "nc_net": 11_820, "nc_net_chg": 670, "nc_long_pct": 25.8, "nc_short_pct": 10.4, "c_long": 8_600, "c_short": 23_200, "c_net": -14_600, "c_net_chg": -180, "c_long_pct": 11.2, "c_short_pct": 30.2, "nr_long": 3_700, "nr_short": 2_560, "nr_net": 1_140},
        {"date": "2026-05-06", "oi": 74_300, "nc_long": 19_170, "nc_short": 8_020, "nc_net": 11_150, "nc_net_chg": -380, "nc_long_pct": 25.8, "nc_short_pct": 10.8, "c_long": 8_300, "c_short": 22_800, "c_net": -14_500, "c_net_chg": 220, "c_long_pct": 11.2, "c_short_pct": 30.7, "nr_long": 3_500, "nr_short": 2_400, "nr_net": 1_100},
        {"date": "2026-04-29", "oi": 72_100, "nc_long": 18_500, "nc_short": 7_970, "nc_net": 10_530, "nc_net_chg": 290, "nc_long_pct": 25.7, "nc_short_pct": 11.1, "c_long": 8_100, "c_short": 22_300, "c_net": -14_200, "c_net_chg": 100, "c_long_pct": 11.2, "c_short_pct": 30.9, "nr_long": 3_350, "nr_short": 2_310, "nr_net": 1_040},
        {"date": "2026-04-22", "oi": 69_800, "nc_long": 18_210, "nc_short": 7_970, "nc_net": 10_240, "nc_net_chg": 520, "nc_long_pct": 26.1, "nc_short_pct": 11.4, "c_long": 7_900, "c_short": 21_800, "c_net": -13_900, "c_net_chg": 140, "c_long_pct": 11.3, "c_short_pct": 31.2, "nr_long": 3_200, "nr_short": 2_140, "nr_net": 1_060},
        {"date": "2026-04-15", "oi": 67_200, "nc_long": 17_690, "nc_short": 8_000, "nc_net": 9_690, "nc_net_chg": -80, "nc_long_pct": 26.3, "nc_short_pct": 11.9, "c_long": 7_650, "c_short": 21_400, "c_net": -13_750, "c_net_chg": -60, "c_long_pct": 11.4, "c_short_pct": 31.8, "nr_long": 3_100, "nr_short": 2_040, "nr_net": 1_060},
        {"date": "2026-04-08", "oi": 65_500, "nc_long": 17_130, "nc_short": 7_820, "nc_net": 9_310, "nc_net_chg": 360, "nc_long_pct": 26.2, "nc_short_pct": 11.9, "c_long": 7_400, "c_short": 21_000, "c_net": -13_600, "c_net_chg": 90, "c_long_pct": 11.3, "c_short_pct": 32.1, "nr_long": 3_020, "nr_short": 1_930, "nr_net": 1_090},
    ],
    "ETH": [
        {"date": "2026-06-10", "oi": 32_100, "nc_long": 8_200, "nc_short": 3_450, "nc_net": 4_750, "nc_net_chg": 310, "nc_long_pct": 25.5, "nc_short_pct": 10.7, "c_long": 3_100, "c_short": 9_800, "c_net": -6_700, "c_net_chg": -150, "c_long_pct": 9.7, "c_short_pct": 30.5, "nr_long": 1_450, "nr_short": 1_050, "nr_net": 400},
        {"date": "2026-06-03", "oi": 31_400, "nc_long": 7_890, "nc_short": 3_450, "nc_net": 4_440, "nc_net_chg": 120, "nc_long_pct": 25.1, "nc_short_pct": 11.0, "c_long": 3_050, "c_short": 9_600, "c_net": -6_550, "c_net_chg": -80, "c_long_pct": 9.7, "c_short_pct": 30.6, "nr_long": 1_400, "nr_short": 1_000, "nr_net": 400},
        {"date": "2026-05-27", "oi": 30_700, "nc_long": 7_770, "nc_short": 3_450, "nc_net": 4_320, "nc_net_chg": -80, "nc_long_pct": 25.3, "nc_short_pct": 11.2, "c_long": 2_980, "c_short": 9_400, "c_net": -6_420, "c_net_chg": 60, "c_long_pct": 9.7, "c_short_pct": 30.6, "nr_long": 1_360, "nr_short": 970, "nr_net": 390},
        {"date": "2026-05-20", "oi": 29_900, "nc_long": 7_520, "nc_short": 3_120, "nc_net": 4_400, "nc_net_chg": 190, "nc_long_pct": 25.2, "nc_short_pct": 10.4, "c_long": 2_900, "c_short": 9_200, "c_net": -6_300, "c_net_chg": 30, "c_long_pct": 9.7, "c_short_pct": 30.8, "nr_long": 1_320, "nr_short": 940, "nr_net": 380},
        {"date": "2026-05-13", "oi": 28_800, "nc_long": 7_330, "nc_short": 3_120, "nc_net": 4_210, "nc_net_chg": 240, "nc_long_pct": 25.5, "nc_short_pct": 10.8, "c_long": 2_820, "c_short": 8_980, "c_net": -6_160, "c_net_chg": -40, "c_long_pct": 9.8, "c_short_pct": 31.2, "nr_long": 1_280, "nr_short": 920, "nr_net": 360},
        {"date": "2026-05-06", "oi": 27_600, "nc_long": 7_090, "nc_short": 3_120, "nc_net": 3_970, "nc_net_chg": -140, "nc_long_pct": 25.7, "nc_short_pct": 11.3, "c_long": 2_750, "c_short": 8_800, "c_net": -6_050, "c_net_chg": 80, "c_long_pct": 10.0, "c_short_pct": 31.9, "nr_long": 1_230, "nr_short": 880, "nr_net": 350},
        {"date": "2026-04-29", "oi": 26_300, "nc_long": 6_800, "nc_short": 2_910, "nc_net": 3_890, "nc_net_chg": 110, "nc_long_pct": 25.9, "nc_short_pct": 11.1, "c_long": 2_680, "c_short": 8_610, "c_net": -5_930, "c_net_chg": 30, "c_long_pct": 10.2, "c_short_pct": 32.7, "nr_long": 1_190, "nr_short": 840, "nr_net": 350},
        {"date": "2026-04-22", "oi": 25_100, "nc_long": 6_690, "nc_short": 2_910, "nc_net": 3_780, "nc_net_chg": 200, "nc_long_pct": 26.7, "nc_short_pct": 11.6, "c_long": 2_600, "c_short": 8_420, "c_net": -5_820, "c_net_chg": 50, "c_long_pct": 10.4, "c_short_pct": 33.5, "nr_long": 1_140, "nr_short": 800, "nr_net": 340},
    ],
}

DEMO_MACRO = {
    "DXY":   {"key": "DXY",   "label": "Индекс доллара USD",  "price": 104.62, "change": -0.31, "changePct": -0.30},
    "US10Y": {"key": "US10Y", "label": "US 10Y Treasury",     "price":   4.38, "change":  0.04, "changePct":  0.92},
    "SPX":   {"key": "SPX",   "label": "S&P 500",             "price": 5812.0, "change": 28.5,  "changePct":  0.49},
    "GOLD":  {"key": "GOLD",  "label": "Золото (XAU/USD)",    "price": 2745.3, "change": 12.1,  "changePct":  0.44},
    "OIL":   {"key": "OIL",   "label": "Нефть WTI",           "price":   73.4, "change": -0.82, "changePct": -1.11},
    "VIX":   {"key": "VIX",   "label": "VIX (страх рынка)",   "price":   14.8, "change": -0.3,  "changePct": -1.99},
}

# ── HTTP client ───────────────────────────────────────────────────────────────

async def _sess() -> aiohttp.ClientSession:
    """Сессия для публичных источников этого модуля (CFTC, Yahoo, Nasdaq).

    Без проверки сертификата: на рабочем столе HTTPS перехватывается, и
    проверка обрывает запрос. Здесь это допустимо - в этих обращениях нет ни
    ключей, ни данных ученика. Запрос к Anthropic идёт иначе, см. `_call_claude`.
    """
    return await session.insecure()


async def _get(url: str, params: dict | None = None, headers: dict | None = None) -> Any:
    s = await _sess()
    try:
        async with s.get(url, params=params, headers=headers or {}, ssl=False) as r:
            if r.status not in (200, 201):
                return None
            return await r.json(content_type=None)
    except Exception:
        return None


# ── CFTC COT ─────────────────────────────────────────────────────────────────

async def _fetch_cftc(asset: str, weeks: int) -> list[dict] | None:
    """Fetch TFF COT data from CFTC OData v4 API (exact CME contract name match).

    aiohttp URL-encodes '$' in param keys to '%24', breaking OData — so we build
    the query string manually and pass a pre-formed URL string.

    Отката по датам здесь не нужно, в отличие от источников с ежедневным
    файлом: запрос идёт с сортировкой по убыванию даты отчёта, и свежий
    доступный отчёт приходит первым сам. За какое он число - видно в поле
    `as_of` ответа (ТЗ §7.4).
    """
    name = CFTC_NAMES.get(asset)
    if not name:
        return None
    filter_expr = f"market_and_exchange_names eq '{name}'"
    qs = (
        f"$filter={quote(filter_expr, safe='')}"
        f"&$top={weeks}"
        f"&$orderby=report_date_as_yyyy_mm_dd%20desc"
    )
    data = await _get(f"{CFTC_URL}?{qs}")
    if data and data.get("value"):
        return data["value"]
    return None


# ── Сроки жизни (серверный кэш) ────────────────────────────────────────────
#
# Эти ручки ходят в чужие медленные источники: CFTC, Yahoo, Nasdaq. Раньше -
# на каждый запрос каждого ученика, и страница Smart Money грузилась секундами:
# одни потоки ETF это цена биткоина, семь запросов в Nasdaq и до четырнадцати
# в Yahoo. Теперь ответ живёт на сервере, а фоновый прогрев (`warm`) держит
# его свежим до того, как кто-то придёт.
#
# Устаревшее отдаём дольше свежего: вчерашние позиции фондов лучше демо-цифр.
COT_TTL, COT_STALE = 3600, 24 * 3600          # отчёт недельный
MACRO_TTL, MACRO_STALE = 300, 6 * 3600
ETF_TTL, ETF_STALE = 600, 6 * 3600
WARM_EVERY = 240                               # чуть чаще самого короткого срока


@router.get("/cot/{asset}")
async def cot_positions(asset: str, weeks: int = 10, demo: bool = False):
    """CFTC COT — позиции хедж-фондов (NC) и коммерческих игроков на фьючерсах CME."""
    asset = asset.upper()
    if asset not in ("BTC", "ETH"):
        raise HTTPException(400, "Поддерживаются: BTC, ETH")

    items = None
    is_demo = demo
    stale = False

    if not demo:
        # Пустой ответ источника - не значение: в кэш не кладём, отдаём прежнее.
        async def live():
            return await _fetch_cftc(asset, weeks) or None

        items, stale = await cache.cached(
            f"institutional:cot:{asset}:{weeks}", COT_TTL, live, stale_ttl=COT_STALE,
        )

    if items is None:
        is_demo = True
        items_demo = DEMO_COT[asset][:weeks]
        return {
            "asset": asset,
            "cot": items_demo,
            "demo": True,
            "as_of": items_demo[0]["date"] if items_demo else None,
        }

    rows = []
    for item in items:
        def i(key: str, _item: dict = item) -> int:
            return int(_item.get(key) or 0)
        def f(key: str, _item: dict = item) -> float:
            return float(_item.get(key) or 0.0)

        # TFF report: Leveraged Money = hedge funds, Asset Manager = institutions
        nc_long  = i("lev_money_positions_long")
        nc_short = i("lev_money_positions_short")
        c_long   = i("asset_mgr_positions_long")
        c_short  = i("asset_mgr_positions_short")
        nr_long  = i("nonrept_positions_long_all")
        nr_short = i("nonrept_positions_short_all")
        oi       = i("open_interest_all")

        rows.append({
            "date":         str(item.get("report_date_as_yyyy_mm_dd", ""))[:10],
            "oi":           oi,
            "nc_long":      nc_long,
            "nc_short":     nc_short,
            "nc_net":       nc_long - nc_short,
            "nc_net_chg":   i("change_in_lev_money_long") - i("change_in_lev_money_short"),
            "nc_long_pct":  f("pct_of_oi_lev_money_long"),
            "nc_short_pct": f("pct_of_oi_lev_money_short"),
            "c_long":       c_long,
            "c_short":      c_short,
            "c_net":        c_long - c_short,
            "c_net_chg":    i("change_in_asset_mgr_long") - i("change_in_asset_mgr_short"),
            "c_long_pct":   f("pct_of_oi_asset_mgr_long"),
            "c_short_pct":  f("pct_of_oi_asset_mgr_short"),
            "nr_long":      nr_long,
            "nr_short":     nr_short,
            "nr_net":       nr_long - nr_short,
        })

    # За какое число цифры. Отчёт выходит в пятницу за вторник, и без этой
    # подписи ученик принимает позиции недельной давности за сегодняшние.
    return {
        "asset": asset,
        "cot": rows,
        "demo": False,
        "as_of": rows[0]["date"] if rows else None,
        "stale": stale,
    }


# ── Macro Indicators ──────────────────────────────────────────────────────────

@router.get("/macro")
async def macro_indicators(demo: bool = False):
    """Макро индикаторы: DXY, US10Y, S&P500, Gold, Oil, VIX."""

    if demo:
        return {"indicators": DEMO_MACRO, "demo": True}

    async def fetch_one(key: str, sym: str, label: str) -> dict:
        for base in [
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
            f"https://query2.finance.yahoo.com/v8/finance/chart/{sym}",
        ]:
            data = await _get(base,
                              params={"interval": "1d", "range": "5d"},
                              headers=YAHOO_HEADERS)
            try:
                meta  = data["chart"]["result"][0]["meta"]
                price = float(meta.get("regularMarketPrice") or 0)
                prev  = float(meta.get("chartPreviousClose") or price)
                chg   = price - prev
                chg_p = (chg / prev * 100) if prev else 0
                return {"key": key, "label": label,
                        "price": round(price, 4),
                        "change": round(chg, 4),
                        "changePct": round(chg_p, 2)}
            except Exception:
                continue
        # Не ответил - так и говорим. Раньше здесь возвращалась демо-строка, и
        # её ненулевая цена считалась живой: при молчащем Yahoo весь блок
        # уходил с `demo: false` на выдуманных цифрах.
        return None

    async def live():
        tasks = [fetch_one(k, sym, label) for k, (sym, label) in MACRO_SYMBOLS.items()]
        results = await asyncio.gather(*tasks)
        real = {r["key"]: r for r in results if r and r["price"] > 0}
        # Меньше двух живых цен - источник молчит; в кэш такое не кладём.
        if len(real) < 2:
            return None
        # Недостающие строки добираем демо-значениями, но с пометкой на самой
        # строке: блок в целом живой, а про эту цифру честно сказано, что она
        # не из источника.
        indicators = {}
        for key, (_, label) in MACRO_SYMBOLS.items():
            if key in real:
                indicators[key] = real[key]
            else:
                fallback = DEMO_MACRO.get(
                    key, {"key": key, "label": label, "price": 0, "change": 0, "changePct": 0}
                )
                indicators[key] = {**fallback, "demo": True}
        return indicators

    indicators, stale = await cache.cached(
        "institutional:macro", MACRO_TTL, live, stale_ttl=MACRO_STALE,
    )
    if indicators is None:
        return {"indicators": DEMO_MACRO, "demo": True}

    return {"indicators": indicators, "demo": False, "stale": stale}


# ── ETF Holdings ──────────────────────────────────────────────────────────────

import re as _re


async def _fetch_btc_price() -> float:
    """BTC/USD price from CoinGecko."""
    data = await _get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "bitcoin", "vs_currencies": "usd"},
    )
    try:
        return float(data["bitcoin"]["usd"])
    except Exception:
        return 0.0


async def _fetch_etf_aum(ticker: str) -> float:
    """AUM in USD from Nasdaq public API. Returns 0 on failure."""
    data = await _get(
        f"https://api.nasdaq.com/api/quote/{ticker}/summary",
        params={"assetclass": "etf"},
        headers=NASDAQ_H,
    )
    try:
        aum_str = data["data"]["summaryData"]["AUM"]["value"]
        aum_k = float(_re.sub(r"[^0-9.]", "", aum_str))
        return aum_k * 1_000  # value is in thousands of USD
    except Exception:
        return 0.0


@router.get("/etf-flows")
async def etf_flows():
    """Bitcoin spot ETF — AUM live (Nasdaq) + BTC holdings derived from AUM/BTC price."""
    payload, stale = await cache.cached(
        "institutional:etf-flows", ETF_TTL, _etf_flows_live, stale_ttl=ETF_STALE,
    )
    if payload is None:
        # Источники молчат и помнить нечего: страница покажет демо-цифры.
        return {"etfs": [], "total_btc": 0, "btc_price": 0, "stale": False}
    return {**payload, "stale": stale}


async def _etf_flows_live() -> dict | None:
    """Сборка потоков ETF из живых источников. `None` - Nasdaq не ответил."""
    btc_price, *aum_values = await asyncio.gather(
        _fetch_btc_price(),
        *[_fetch_etf_aum(e["ticker"]) for e in ETF_LIST],
    )

    enriched_base = []
    for etf, aum_usd in zip(ETF_LIST, aum_values):
        btc = int(aum_usd / btc_price) if btc_price and aum_usd else 0
        enriched_base.append({**etf, "btc": btc, "aum_usd": aum_usd})

    total_btc = sum(e["btc"] for e in enriched_base) or 1

    async def add_price(etf: dict) -> dict:
        for base in [
            f"https://query1.finance.yahoo.com/v8/finance/chart/{etf['ticker']}",
            f"https://query2.finance.yahoo.com/v8/finance/chart/{etf['ticker']}",
        ]:
            data = await _get(base, params={"interval": "1d", "range": "5d"}, headers=YAHOO_HEADERS)
            try:
                meta  = data["chart"]["result"][0]["meta"]
                price = float(meta.get("regularMarketPrice") or 0)
                prev  = float(meta.get("chartPreviousClose") or price)
                chg   = price - prev
                return {**etf,
                        "price": round(price, 2),
                        "change": round(chg, 2),
                        "changePct": round((chg / prev * 100) if prev else 0, 2),
                        "sharePct": round(etf["btc"] / total_btc * 100, 1)}
            except Exception:
                continue
        return {**etf, "price": 0, "change": 0, "changePct": 0,
                "sharePct": round(etf["btc"] / total_btc * 100, 1)}

    enriched = await asyncio.gather(*[add_price(e) for e in enriched_base])
    if not any(e["btc"] > 0 for e in enriched):
        return None
    return {"etfs": list(enriched), "total_btc": total_btc, "btc_price": btc_price}


async def warm() -> None:
    """Держать ответы свежими до того, как за ними придут.

    Кэш сам по себе спасает только второго ученика: первый после истечения
    срока всё равно ждёт Yahoo и Nasdaq. Фоновый прогрев обновляет ответы чуть
    раньше срока, и ждать не приходится никому. Упавший источник прогрев не
    роняет - просто остаётся прежний ответ.
    """
    while True:
        for job in (
            etf_flows(),
            macro_indicators(),
            cot_positions("BTC"),
            cot_positions("ETH"),
        ):
            try:
                await job
            except Exception:
                log.warning("Прогрев институционалов: источник не ответил", exc_info=True)
        await asyncio.sleep(WARM_EVERY)


# ── AI Analysis ───────────────────────────────────────────────────────────────
#
# Ручка платная: каждый вызов идёт к Anthropic по нашему ключу. Поэтому на ней
# три замка сразу (ТЗ «источники рыночных данных», этап 3):
#
#   токен  - разбор доступен ученику кабинета, а не всему интернету;
#   счёт   - несколько разборов за окно и за сутки, ключом ученик, не адрес;
#   монеты - списываются до вызова и возвращаются той же книгой, если вызов
#            не удался.
#
# Монеты здесь надёжнее предела по времени: счёт попыток живёт в памяти
# процесса и обнуляется перезапуском, а списание записано в базе.


# Пределы на присланное. Цена разбора в монетах постоянная, а счёт Anthropic
# считается по входным токенам: без предела на размер тела один оплаченный
# разбор превращается в сколь угодно дорогой вызов. Значения с запасом - на
# экране аналитики в запрос уходит десяток недель COT и шесть макро-строк.
MAX_EXTRA_CTX = 2_000
MAX_BLOCK_CHARS = 16_384


class AnalyzeRequest(BaseModel):
    cot_btc:   dict | None = None
    cot_eth:   dict | None = None
    macro:     dict | None = None
    extra_ctx: str = Field(default="", max_length=MAX_EXTRA_CTX)

    @field_validator("cot_btc", "cot_eth", "macro")
    @classmethod
    def _не_больше_предела(cls, value: dict | None) -> dict | None:
        if value is None:
            return value
        size = len(json.dumps(value, ensure_ascii=False, default=str))
        if size > MAX_BLOCK_CHARS:
            raise ValueError(f"Блок данных больше {MAX_BLOCK_CHARS} знаков")
        return value


class ClaudeError(RuntimeError):
    """Anthropic не ответил разбором. Текст - для лога, а не для ответа."""


def _human_wait(seconds: int) -> str:
    """Ожидание словами: «45 с», «12 мин», «3 ч»."""
    if seconds < 60:
        return f"{seconds} с"
    if seconds < 3600:
        return f"{-(-seconds // 60)} мин"
    return f"{-(-seconds // 3600)} ч"


def _analyze_prompt(req: AnalyzeRequest) -> str:
    """Собрать запрос к модели из присланных данных."""
    parts: list[str] = [
        "Ты старший аналитик институциональных рынков. "
        "Проанализируй данные ниже и дай торговый инсайт НА РУССКОМ."
    ]

    for label, cot_data in [("BTC", req.cot_btc), ("ETH", req.cot_eth)]:
        if cot_data and cot_data.get("cot"):
            w = cot_data["cot"]
            cur  = w[0]
            prev = w[1] if len(w) > 1 else w[0]
            demo_mark = " [демо]" if cot_data.get("demo") else ""
            parts.append(
                f"\nCOT {label} (CFTC{demo_mark}):\n"
                f"  Хедж-фонды нетто: {cur['nc_net']:+,} (Δ неделя: {cur['nc_net_chg']:+,})\n"
                f"  NC: {cur['nc_long_pct']:.1f}% лонг / {cur['nc_short_pct']:.1f}% шорт от ОИ\n"
                f"  Коммерческие нетто: {cur['c_net']:+,}\n"
                f"  ОИ: {cur['oi']:,} контрактов · прошлая неделя NC нетто: {prev['nc_net']:+,}"
            )

    if req.macro and req.macro.get("indicators"):
        demo_mark = " [демо]" if req.macro.get("demo") else ""
        lines = []
        for k, v in req.macro["indicators"].items():
            lines.append(f"  {v['label']}: {v['price']} ({v['changePct']:+.2f}%)")
        parts.append(f"\nМакро{demo_mark}:\n" + "\n".join(lines))

    if req.extra_ctx:
        parts.append(f"\nДоп. контекст: {req.extra_ctx}")

    parts.append(
        "\nДай структурированный брифинг:\n"
        "## Позиция институционалов\n"
        "(хедж-фонды - аккумулируют/распродают/нейтральны, почему это важно)\n"
        "## Макро фон\n"
        "(DXY, ставки, VIX → влияние на крипто, 2-3 предложения)\n"
        "## Куда движется капитал\n"
        "(чёткий вывод о направлении рынка на 1-2 недели)\n"
        "## Активы под наблюдением\n"
        "(2-4 конкретных тикера с обоснованием каждого)\n"
        "## Ключевые риски\n"
        "(1-2 главных риска на горизонте 2 недели)\n"
        "Стиль: сжато, без воды, как брифинг для трейдера."
    )
    return "\n".join(parts)


def _anthropic_ssl() -> ssl.SSLContext:
    """Проверка сертификата для запроса, который несёт наш ключ.

    Соседние публичные источники этого модуля ходят с `ssl=False` - там нет
    ни ключей, ни данных ученика. Здесь в заголовке уходит `x-api-key`, и
    отключённая проверка означает, что подменивший сертификат по дороге
    прочитает ключ. Корни берём тем же способом, что и общая сессия: набор
    этой машины из `SSL_CERT_FILE`, если он собран, иначе `certifi`. До
    хранилища Windows Python не достаёт, и запрос падает с «unable to get
    local issuer certificate».
    """
    return ssl.create_default_context(cafile=session.roots())


async def _call_claude(api_key: str, prompt: str) -> str:
    """Один запрос к Anthropic. Отдельной функцией: её подменяют тесты."""
    s = await _sess()
    async with s.post(
        "https://api.anthropic.com/v1/messages",
        json={
            "model": "claude-sonnet-4-6",
            "max_tokens": 1500,
            "messages": [{"role": "user", "content": prompt}],
        },
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        ssl=_anthropic_ssl(),
    ) as r:
        if r.status != 200:
            raise ClaudeError(f"HTTP {r.status}: {(await r.text())[:300]}")
        resp = await r.json(content_type=None)
    try:
        return resp["content"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ClaudeError(f"неожиданный ответ: {str(resp)[:300]}") from exc


def _refund_quietly(session, student_id: int, price: int, ref: str) -> bool:
    """Вернуть монеты за несостоявшийся разбор. False - вернуть не вышло.

    Возврат и сам может не удаться: обрыв базы, занятый SQLite. Молчать об
    этом нельзя - монеты уже списаны и закоммичены, и ученик остался и без
    разбора, и без монет. Поэтому громко в лог со ссылкой списания, по ней
    наставник вернёт руками, и честное сообщение на экран вместо обещания
    возврата, которого не было.
    """
    if not price:
        return True
    try:
        coin_ledger.refund(session, student_id, price, "ai_refund", f"{ref}_back")
        session.commit()
        return True
    except Exception:
        session.rollback()
        log.error(
            "Монеты за ИИ-разбор списаны, но не возвращены: ученик %s, списание %s, %s монет",
            student_id, ref, price, exc_info=True,
        )
        return False


@router.post("/analyze")
async def ai_analysis(
    req: AnalyzeRequest,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    config: BackendConfig = Depends(get_config),
    quota: AnalyzeQuota = Depends(get_ai_quota),
):
    """ИИ-анализ через Claude API. Требует токен, укладывается в лимит и стоит монет."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY не настроен в .env")

    wait = quota.retry_after(student.id)
    if wait:
        raise HTTPException(
            429,
            f"Разборов пока достаточно. Следующий - через {_human_wait(wait)}",
            headers={"Retry-After": str(wait)},
        )

    price = int(config.ai_analyze_price or 0)
    ref = f"ai_{uuid.uuid4().hex[:16]}"
    if price and not coin_ledger.spend(session, student.id, price, "ai_analyze", ref):
        raise HTTPException(400, f"Разбор стоит {price} NMNH, на балансе меньше")
    session.commit()
    # Попытка засчитывается после списания: отказ по балансу не должен стоить
    # ученику места в окне.
    quota.record(student.id)

    try:
        analysis = await _call_claude(api_key, _analyze_prompt(req))
    except Exception as exc:
        # В тексте ошибки Anthropic бывают куски запроса и подсказки о ключе.
        # Наружу - общее сообщение, подробность - в лог сервера.
        log.warning("ИИ-разбор не удался (ученик %s, %s): %s", student.id, ref, exc)
        returned = _refund_quietly(session, student.id, price, ref)
        raise HTTPException(
            502,
            "ИИ-разбор сейчас недоступен, монеты возвращены. Попробуйте позже"
            if returned
            else "ИИ-разбор сейчас недоступен. Монеты вернёт наставник, разбор не состоялся",
        ) from exc

    return {
        "analysis": analysis,
        "price": price,
        "balance": int(session.get(Student, student.id).coins or 0),
    }
