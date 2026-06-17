"""Institutional intelligence: CFTC COT, macro indicators, Bitcoin ETFs, AI analysis."""

from __future__ import annotations

import asyncio
import os
from typing import Any
from urllib.parse import quote

import aiohttp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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

_session: aiohttp.ClientSession | None = None


async def _sess() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15),
            connector=aiohttp.TCPConnector(limit=20),
        )
    return _session


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


@router.get("/cot/{asset}")
async def cot_positions(asset: str, weeks: int = 10, demo: bool = False):
    """CFTC COT — позиции хедж-фондов (NC) и коммерческих игроков на фьючерсах CME."""
    asset = asset.upper()
    if asset not in ("BTC", "ETH"):
        raise HTTPException(400, "Поддерживаются: BTC, ETH")

    items = None
    is_demo = demo

    if not demo:
        raw = await _fetch_cftc(asset, weeks)
        if raw:
            items = raw

    if items is None:
        is_demo = True
        items_demo = DEMO_COT[asset]
        return {"asset": asset, "cot": items_demo[:weeks], "demo": True}

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

    return {"asset": asset, "cot": rows, "demo": False}


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
        return DEMO_MACRO.get(key, {"key": key, "label": label, "price": 0, "change": 0, "changePct": 0})

    tasks = [fetch_one(k, sym, label) for k, (sym, label) in MACRO_SYMBOLS.items()]
    results = await asyncio.gather(*tasks)
    indicators = {r["key"]: r for r in results}

    # If all zeros — return demo
    non_zero = sum(1 for v in indicators.values() if v["price"] > 0)
    if non_zero < 2:
        return {"indicators": DEMO_MACRO, "demo": True}

    return {"indicators": indicators, "demo": False}


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
    return {"etfs": list(enriched), "total_btc": total_btc, "btc_price": btc_price}


# ── AI Analysis ───────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    cot_btc:   dict | None = None
    cot_eth:   dict | None = None
    macro:     dict | None = None
    extra_ctx: str = ""


@router.post("/analyze")
async def ai_analysis(req: AnalyzeRequest):
    """AI-анализ через Claude API. Требует ANTHROPIC_API_KEY в .env."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY не настроен в .env")

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
        "(хедж-фонды — аккумулируют/распродают/нейтральны, почему это важно)\n"
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

    s = await _sess()
    try:
        async with s.post(
            "https://api.anthropic.com/v1/messages",
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 1500,
                "messages": [{"role": "user", "content": "\n".join(parts)}],
            },
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            ssl=False,
        ) as r:
            if r.status != 200:
                err = await r.text()
                raise HTTPException(502, f"Claude API: {err[:300]}")
            resp = await r.json(content_type=None)
            return {"analysis": resp["content"][0]["text"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI error: {e}") from e
