"""Рыночные данные — прокси к WEEX Futures API и external APIs.

Рабочие публичные эндпоинты WEEX (api-contract.weex.com):
  /capi/v3/market/symbolPrice?symbol=X        → цена пары
  /capi/v3/market/depth?symbol=X              → стакан цен (без param limit!)
  /capi/v3/market/klines?symbol=X&interval=15m&limit=N → свечи
  /capi/v3/market/fundingRate?symbol=X        → ставка финансирования
  /capi/v3/market/openInterest?symbol=X       → открытый интерес
  /capi/v3/market/ticker?symbol=X             → расширенный тикер (прирост, объём)
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/market", tags=["market-data"])

WEEX_BASE = "https://api-contract.weex.com"
FNG_URL = "https://api.alternative.me/fng/?limit=30&format=json"

TICKER_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
    "DOGEUSDT", "AVAXUSDT", "ADAUSDT", "MATICUSDT", "LTCUSDT",
]

FUNDING_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
    "LTCUSDT", "TRXUSDT", "TONUSDT", "SUIUSDT", "NEARUSDT",
]

_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=8),
            connector=aiohttp.TCPConnector(ssl=False),
        )
    return _session


async def _weex(path: str, params: dict | None = None) -> Any:
    session = await _get_session()
    url = f"{WEEX_BASE}{path}"
    try:
        async with session.get(url, params=params) as r:
            if r.status != 200:
                return None
            return await r.json(content_type=None)
    except Exception:
        return None


# ── Order Book ──────────────────────────────────────────────────────────────

@router.get("/orderbook/{symbol}")
async def orderbook(symbol: str, limit: int = 20):
    """Стакан цен (биды/аски) через WEEX Futures API.
    Важно: WEEX возвращает 400, если передать param `limit` — посылаем без него.
    """
    data = await _weex("/capi/v3/market/depth", {"symbol": symbol.upper()})
    if not data:
        raise HTTPException(502, f"WEEX depth недоступен для {symbol}")

    payload = data.get("data") or data
    bids = payload.get("bids") or payload.get("bid") or []
    asks = payload.get("asks") or payload.get("ask") or []

    return {
        "symbol": symbol.upper(),
        "bids": bids[:limit],
        "asks": asks[:limit],
    }


# ── Тикеры (несколько пар параллельно) ─────────────────────────────────────

@router.get("/tickers")
async def tickers():
    """Лайв-цены для нескольких пар (параллельные запросы к symbolPrice)."""

    async def fetch_one(sym: str) -> dict | None:
        data = await _weex("/capi/v3/market/symbolPrice", {"symbol": sym})
        if not data:
            return None
        return {
            "symbol": sym,
            "price": data.get("price", "0"),
            "priceChangePercent": "0",  # WEEX symbolPrice не возвращает %
            "time": data.get("time"),
        }

    results = await asyncio.gather(*[fetch_one(s) for s in TICKER_SYMBOLS])
    return {"tickers": [r for r in results if r]}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_funding(raw: Any) -> str | None:
    """Вытащить fundingRate из ответа WEEX (структура варьируется)."""
    if not raw:
        return None
    payload = raw.get("data") if isinstance(raw, dict) else raw
    if isinstance(payload, dict):
        for key in ("fundingRate", "funding_rate", "rate"):
            if key in payload:
                return str(payload[key])
    if isinstance(payload, list) and payload:
        item = payload[0]
        if isinstance(item, dict):
            for key in ("fundingRate", "funding_rate", "rate"):
                if key in item:
                    return str(item[key])
    # иногда rate лежит прямо в корне
    for key in ("fundingRate", "funding_rate", "rate"):
        if isinstance(raw, dict) and key in raw:
            return str(raw[key])
    return None


def _extract_next_funding(raw: Any) -> int | None:
    if not raw:
        return None
    payload = raw.get("data") if isinstance(raw, dict) else raw
    if isinstance(payload, dict):
        for key in ("nextFundingTime", "next_funding_time", "nextSettle"):
            if key in payload:
                return int(payload[key])
    return None


async def _fetch_funding_one(sym: str) -> dict:
    for path in ["/capi/v3/market/fundingRate", "/capi/v1/market/fundingRate",
                 "/capi/v3/market/ticker"]:
        raw = await _weex(path, {"symbol": sym})
        fr = _extract_funding(raw)
        if fr and fr != "0":
            return {
                "symbol":          sym,
                "fundingRate":     fr,
                "nextFundingTime": _extract_next_funding(raw),
            }
    return {"symbol": sym, "fundingRate": "0", "nextFundingTime": None}


# ── Funding Rates ────────────────────────────────────────────────────────────

@router.get("/funding-rates")
async def funding_rates():
    """Ставки финансирования для всех основных пар из WEEX."""
    results = await asyncio.gather(*[_fetch_funding_one(s) for s in FUNDING_SYMBOLS])
    return {"rates": list(results)}


# ── 24h Ticker ───────────────────────────────────────────────────────────────

@router.get("/ticker/{symbol}")
async def ticker_24h(symbol: str):
    """24-часовая статистика пары из WEEX: symbolPrice + klines(1d) + fundingRate."""
    sym = symbol.upper()

    price_data, klines_data, funding_raw = await asyncio.gather(
        _weex("/capi/v3/market/symbolPrice", {"symbol": sym}),
        _weex("/capi/v3/market/klines", {"symbol": sym, "interval": "1d", "limit": "14"}),
        _weex("/capi/v3/market/fundingRate", {"symbol": sym}),
    )

    if price_data and klines_data and isinstance(klines_data, list) and klines_data:
        # Текущая свеча — с наибольшим таймстемпом (порядок ответа API не гарантирован)
        rows = [r for r in klines_data if isinstance(r, (list, tuple)) and len(r) > 7]
        rows.sort(key=lambda r: float(r[0]), reverse=True)
        k = rows[0] if rows else klines_data[0]

        last_price = price_data.get("price", "0")
        open_price = str(k[1])
        high_price = str(k[2])
        low_price  = str(k[3])
        base_vol   = str(k[5])
        quote_vol  = str(k[7])

        # Средний дневной объём за прошлые дни (без текущего) — для оценки активности
        avg_quote_vol = "0"
        prior = rows[1:]
        prior_vols: list[float] = []
        for row in prior:
            try:
                prior_vols.append(float(row[7]))
            except (ValueError, TypeError, IndexError):
                pass
        if prior_vols:
            avg_quote_vol = f"{sum(prior_vols) / len(prior_vols):.8f}"

        try:
            change = float(last_price) - float(open_price)
            change_pct = (change / float(open_price)) * 100 if float(open_price) else 0
        except (ValueError, ZeroDivisionError):
            change, change_pct = 0.0, 0.0

        return {
            "symbol":             sym,
            "lastPrice":          last_price,
            "priceChange":        f"{change:.4f}",
            "priceChangePercent": f"{change_pct:.2f}",
            "highPrice":          high_price,
            "lowPrice":           low_price,
            "volume":             base_vol,
            "quoteVolume":        quote_vol,
            "avgQuoteVolume":     avg_quote_vol,
            "openPrice":          open_price,
            "markPrice":          None,
            "fundingRate":        _extract_funding(funding_raw),
            "nextFundingTime":    _extract_next_funding(funding_raw),
        }

    raise HTTPException(502, f"WEEX ticker недоступен для {sym}")


# ── Open Interest ─────────────────────────────────────────────────────────────

@router.get("/open-interest/{symbol}")
async def open_interest(symbol: str):
    """Открытый интерес по паре из WEEX."""
    sym = symbol.upper()
    data = await _weex("/capi/v3/market/openInterest", {"symbol": sym})
    payload = (data.get("data") or data) if data else None
    oi_value = None
    if isinstance(payload, dict):
        for key in ("openInterest", "open_interest", "oi", "value"):
            if key in payload:
                oi_value = str(payload[key])
                break
    elif isinstance(payload, (int, float, str)):
        oi_value = str(payload)
    return {"symbol": sym, "open_interest": oi_value, "raw": payload}


# ── Derivatives (OI + Funding) ────────────────────────────────────────────────

@router.get("/derivatives/{symbol}")
async def derivatives(symbol: str):
    """OI + ставка финансирования + 24ч изменение из WEEX для одной пары."""
    sym = symbol.upper()

    oi_raw, funding_raw, price_raw, klines_raw = await asyncio.gather(
        _weex("/capi/v3/market/openInterest", {"symbol": sym}),
        _weex("/capi/v3/market/fundingRate",  {"symbol": sym}),
        _weex("/capi/v3/market/symbolPrice",  {"symbol": sym}),
        _weex("/capi/v3/market/klines", {"symbol": sym, "interval": "1d", "limit": "1"}),
    )

    last_price = float(price_raw.get("price", 0)) if price_raw else 0

    # Открытый интерес — WEEX возвращает OI в корне ответа, не в data
    oi_value = None
    if oi_raw:
        oi_payload = oi_raw.get("data") or oi_raw
        if isinstance(oi_payload, dict):
            for key in ("openInterest", "open_interest", "oi", "value"):
                if key in oi_payload:
                    try:
                        oi_value = float(oi_payload[key]) * last_price
                    except (ValueError, TypeError):
                        pass
                    break

    # 24ч изменение
    change_pct = 0.0
    if klines_raw and isinstance(klines_raw, list) and klines_raw:
        k = klines_raw[0]
        try:
            open_p = float(k[1])
            change_pct = ((last_price - open_p) / open_p * 100) if open_p else 0
        except (ValueError, TypeError, IndexError):
            pass

    return {
        "symbol":          sym,
        "openInterestUsd": oi_value,
        "fundingRate":     _extract_funding(funding_raw),
        "nextFundingTime": _extract_next_funding(funding_raw),
        "lastPrice":       last_price,
        "priceChangePct":  round(change_pct, 2),
    }


# ── Recent Trades ────────────────────────────────────────────────────────────

@router.get("/trades/{symbol}")
async def recent_trades(symbol: str, limit: int = 40):
    """Последние сделки — WEEX Futures API /capi/v3/market/trades."""
    sym = symbol.upper()
    data = await _weex("/capi/v3/market/trades", {"symbol": sym, "limit": min(limit, 100)})
    if data and isinstance(data, list):
        return {
            "trades": [
                {
                    "price":    t.get("price"),
                    "qty":      t.get("qty"),
                    "quoteQty": t.get("quoteQty"),
                    "time":     t.get("time"),
                    "isBuy":    not t.get("isBuyerMaker", True),
                }
                for t in data
            ]
        }
    raise HTTPException(502, "Trades недоступны")


# ── Все доступные символы WEEX ────────────────────────────────────────────────

@router.get("/symbols")
async def symbols():
    """Список всех фьючерсных пар WEEX."""
    data = await _weex("/capi/v3/market/contracts")
    items: list[dict] = []
    if isinstance(data, dict):
        payload = data.get("data") or data
        if isinstance(payload, list):
            items = payload
        elif isinstance(payload, dict):
            for v in payload.values():
                if isinstance(v, list):
                    items = v
                    break
    elif isinstance(data, list):
        items = data

    result = []
    for item in items:
        sym = item.get("symbol") or item.get("contractName") or item.get("instrumentId")
        if sym and str(sym).endswith("USDT"):
            result.append(str(sym).upper())

    if not result:
        # запасной список если WEEX не вернул контракты
        result = [
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
            "DOGEUSDT", "AVAXUSDT", "ADAUSDT", "LINKUSDT", "DOTUSDT",
            "MATICUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT", "FTMUSDT",
        ]

    return {"symbols": sorted(result)}


# ── Fear & Greed ──────────────────────────────────────────────────────────────

@router.get("/fear-greed")
async def fear_greed():
    """Fear & Greed Index из alternative.me (последние 30 дней)."""
    session = await _get_session()
    try:
        async with session.get(FNG_URL) as r:
            if r.status != 200:
                raise HTTPException(502, f"FNG API HTTP {r.status}")
            data = await r.json(content_type=None)
            items = data.get("data", [])
            return {
                "current": items[0] if items else None,
                "history": items[:30],
            }
    except aiohttp.ClientError as e:
        raise HTTPException(502, f"FNG error: {e}") from e
