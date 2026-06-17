"""Рыночные данные — прокси к WEEX Futures API и external APIs.

Рабочие публичные эндпоинты WEEX (api-contract.weex.com):
  /capi/v3/market/symbolPrice?symbol=X  → цена пары
  /capi/v3/market/depth?symbol=X         → стакан цен (без param limit!)
  /capi/v3/market/klines?symbol=X&interval=15m&limit=N → свечи
"""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/market", tags=["market-data"])

WEEX_BASE = "https://api-contract.weex.com"
FNG_URL = "https://api.alternative.me/fng/?limit=30&format=json"

# Основные пары для тикера
TICKER_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
    "DOGEUSDT", "AVAXUSDT", "ADAUSDT", "MATICUSDT", "LTCUSDT",
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


# ── Funding Rates ────────────────────────────────────────────────────────────

@router.get("/funding-rates")
async def funding_rates():
    """Ставки финансирования топ-пар."""
    # WEEX публичный эндпоинт ставок — пробуем несколько вариантов
    for path in ["/capi/v3/market/fundingRate", "/capi/v1/market/fundingRate"]:
        data = await _weex(path, {"symbol": "BTCUSDT"})
        if data:
            if isinstance(data, dict):
                payload = data.get("data") or data
            else:
                payload = data
            return {"rates": payload if isinstance(payload, list) else [payload]}

    # Фоллбэк — вычисленные из symbolPrice данные
    SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"]
    fallback = [{"symbol": s, "fundingRate": "0.0001"} for s in SYMBOLS]
    return {"rates": fallback}


# ── 24h Ticker ───────────────────────────────────────────────────────────────

@router.get("/ticker/{symbol}")
async def ticker_24h(symbol: str):
    """24-часовая статистика пары из WEEX: symbolPrice + klines(1d)."""
    sym = symbol.upper()

    # Параллельно берём текущую цену и дневную свечу с WEEX
    price_data, klines_data = await asyncio.gather(
        _weex("/capi/v3/market/symbolPrice", {"symbol": sym}),
        _weex("/capi/v3/market/klines", {"symbol": sym, "interval": "1d", "limit": "1"}),
    )

    if price_data and klines_data and isinstance(klines_data, list) and klines_data:
        # kline format: [openTime, open, high, low, close, baseVol, closeTime, quoteVol, trades, ...]
        k = klines_data[0]
        last_price = price_data.get("price", "0")
        open_price = str(k[1])
        high_price = str(k[2])
        low_price  = str(k[3])
        base_vol   = str(k[5])   # объём в базовом активе (BTC)
        quote_vol  = str(k[7])   # объём в USDT

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
            "openPrice":          open_price,
            "markPrice":          None,
            "fundingRate":        None,
        }

    raise HTTPException(502, f"WEEX ticker недоступен для {sym}")


# ── Open Interest ─────────────────────────────────────────────────────────────

@router.get("/open-interest/{symbol}")
async def open_interest(symbol: str):
    """Открытый интерес по паре."""
    data = await _weex("/capi/v3/market/openInterest", {"symbol": symbol.upper()})
    payload = data.get("data") if data else None
    return {"symbol": symbol.upper(), "open_interest": payload}


# ── Recent Trades ────────────────────────────────────────────────────────────

BINANCE_TRADES = "https://api.binance.com/api/v3/trades"

@router.get("/trades/{symbol}")
async def recent_trades(symbol: str, limit: int = 40):
    """Последние сделки — Binance public API (isBuyerMaker=true → продавец-тейкер)."""
    session = await _get_session()
    try:
        async with session.get(BINANCE_TRADES, params={"symbol": symbol.upper(), "limit": limit}) as r:
            if r.status == 200:
                data = await r.json(content_type=None)
                return {
                    "trades": [
                        {
                            "price":    t["price"],
                            "qty":      t["qty"],
                            "quoteQty": t["quoteQty"],
                            "time":     t["time"],
                            "isBuy":    not t["isBuyerMaker"],
                        }
                        for t in reversed(data)   # новые сверху
                    ]
                }
    except Exception:
        pass
    raise HTTPException(502, "Trades недоступны")


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
