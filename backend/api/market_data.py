"""Рыночные данные — прокси к WEEX Futures API и external APIs.

Рабочие публичные эндпоинты WEEX (api-contract.weex.com):
  /capi/v3/market/symbolPrice?symbol=X        → цена пары
  /capi/v3/market/depth?symbol=X              → стакан цен (без param limit!)
  /capi/v3/market/klines?symbol=X&interval=15m&limit=N → свечи
  /capi/v3/market/fundingRate?symbol=X        → ставка финансирования
  /capi/v3/market/openInterest?symbol=X       → открытый интерес
  /capi/v3/market/ticker?symbol=X             → расширенный тикер (прирост, объём)

Все запросы идут через общий слой источников ([backend/sources](../sources)):
своей сессии и своего кэша здесь больше нет. Каждый ответ несёт два поля -
`source` (имя сработавшего источника) и `stale` (это последнее известное
значение, а не живое). Молча подменять или показывать старую цифру в
терминале, где считают деньги, нельзя - её подписывают (ТЗ этап 1, §4.4).
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.sources import feed, session

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

# ── Сроки жизни данных (ТЗ §4.2) ─────────────────────────────────────────────
#
# Первое число - сколько значение считается живым, второе - сколько оно ещё
# годится, когда источник упал. У стакана второе нулевое: по устаревшему
# стакану нельзя ставить заявку, пустота честнее.
TTL_BOOK,    STALE_BOOK    = 1,   0
TTL_PRICE,   STALE_PRICE   = 2,   30
TTL_KLINES,  STALE_KLINES  = 5,   5 * 60
TTL_FUNDING, STALE_FUNDING = 60,  15 * 60
TTL_SYMBOLS, STALE_SYMBOLS = 300, 24 * 3600
TTL_FNG,     STALE_FNG     = 300, 6 * 3600


async def _weex_raw(path: str, params: dict | None = None) -> Any:
    """Один запрос к публичному API WEEX.

    Сессия без проверки сертификата: на рабочем столе, откуда ходит бэкенд,
    HTTPS перехватывается, и проверка по корням certifi обрывает запрос. Здесь
    это допустимо - в публичных котировках нет ни ключей, ни данных ученика.
    Запросы со счётом ученика идут другим клиентом, там проверка включена.
    """
    s = await session.insecure()
    async with s.get(f"{WEEX_BASE}{path}", params=params) as r:
        if r.status != 200:
            raise RuntimeError(f"WEEX HTTP {r.status}")
        return await r.json(content_type=None)


def _weex(path: str, params: dict | None = None):
    """Источник для цепочки. Время и отказы считает реестр, не мы."""

    async def builder() -> Any:
        return await _weex_raw(path, params)

    return builder


# ── Order Book ──────────────────────────────────────────────────────────────

@router.get("/orderbook/{symbol}")
async def orderbook(symbol: str, limit: int = 20):
    """Стакан цен (биды/аски) через WEEX Futures API.
    Важно: WEEX возвращает 400, если передать param `limit` — посылаем без него.
    """
    sym = symbol.upper()
    data, source, stale = await feed.fetch(
        f"depth:{sym}", TTL_BOOK,
        [("weex", _weex("/capi/v3/market/depth", {"symbol": sym}))],
        stale_ttl=STALE_BOOK,
    )
    if data is None:
        # Пустой стакан вместо 502. Ученик видит, что данных нет, а не
        # сломанную страницу; старый стакан не показываем никогда.
        return {"symbol": sym, "bids": [], "asks": [], "source": None, "stale": False}

    payload = data.get("data") or data
    bids = payload.get("bids") or payload.get("bid") or []
    asks = payload.get("asks") or payload.get("ask") or []

    return {
        "symbol": sym,
        "bids": bids[:limit],
        "asks": asks[:limit],
        "source": source,
        "stale": stale,
    }


# ── Тикеры (несколько пар параллельно) ─────────────────────────────────────

@router.get("/tickers")
async def tickers():
    """Лайв-цены для нескольких пар (параллельные запросы к symbolPrice)."""

    async def fetch_one(sym: str) -> tuple[dict | None, str | None, bool]:
        data, source, stale = await feed.fetch(
            f"price:{sym}", TTL_PRICE,
            [("weex", _weex("/capi/v3/market/symbolPrice", {"symbol": sym}))],
            stale_ttl=STALE_PRICE,
        )
        if not data:
            return None, None, False
        return (
            {
                "symbol": sym,
                "price": data.get("price", "0"),
                "priceChangePercent": "0",  # WEEX symbolPrice не возвращает %
                "time": data.get("time"),
            },
            source,
            stale,
        )

    results = await asyncio.gather(*[fetch_one(s) for s in TICKER_SYMBOLS])
    rows = [(row, source, stale) for row, source, stale in results if row]
    origin = feed.origin({row["symbol"]: source for row, source, _ in rows})

    return {
        "tickers": [row for row, _, _ in rows],
        **origin,
        "stale": any(stale for _, _, stale in rows),
    }


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


def _weex_funding(path: str, sym: str):
    """Путь WEEX, у которого ставка бывает пустой.

    Пустая или нулевая ставка здесь - не ответ, а отказ: у пары, которая
    торгуется, фандинг есть, просто этот путь его не отдал. Реестр считает
    такой ответ отказом и идёт к следующему пути, как было до общего слоя.
    """

    async def builder() -> Any:
        raw = await _weex_raw(path, {"symbol": sym})
        rate = _extract_funding(raw)
        return raw if rate and rate != "0" else None

    return builder


async def _funding_raw(sym: str) -> tuple[Any, str | None, bool]:
    """Сырой ответ по финансированию: три пути WEEX, один кэш."""
    return await feed.fetch(
        f"funding:{sym}", TTL_FUNDING,
        [
            ("weex", _weex_funding("/capi/v3/market/fundingRate", sym)),
            ("weex", _weex_funding("/capi/v1/market/fundingRate", sym)),
            ("weex", _weex_funding("/capi/v3/market/ticker", sym)),
        ],
        stale_ttl=STALE_FUNDING,
    )


async def _fetch_funding_one(sym: str) -> tuple[dict, str | None, bool]:
    raw, source, stale = await _funding_raw(sym)
    rate = _extract_funding(raw)
    return (
        {
            "symbol":          sym,
            "fundingRate":     rate if rate and rate != "0" else "0",
            "nextFundingTime": _extract_next_funding(raw),
        },
        source,
        stale,
    )


# ── Funding Rates ────────────────────────────────────────────────────────────

@router.get("/funding-rates")
async def funding_rates():
    """Ставки финансирования для всех основных пар из WEEX.

    Второго источника здесь не будет никогда: ученик платит фандинг WEEX, и
    показать вместо него чужой значит соврать о его расходах (ТЗ §5.2).
    """
    results = await asyncio.gather(*[_fetch_funding_one(s) for s in FUNDING_SYMBOLS])
    origin = feed.origin({row["symbol"]: source for row, source, _ in results})
    return {
        "rates": [row for row, _, _ in results],
        **origin,
        "stale": any(stale for _, _, stale in results),
    }


# ── 24h Ticker ───────────────────────────────────────────────────────────────

@router.get("/ticker/{symbol}")
async def ticker_24h(symbol: str):
    """24-часовая статистика пары из WEEX: symbolPrice + klines(1d) + fundingRate."""
    sym = symbol.upper()

    (price_data, price_src, price_stale), (klines_data, klines_src, klines_stale), funding = await asyncio.gather(
        feed.fetch(
            f"price:{sym}", TTL_PRICE,
            [("weex", _weex("/capi/v3/market/symbolPrice", {"symbol": sym}))],
            stale_ttl=STALE_PRICE,
        ),
        feed.fetch(
            f"klines:{sym}:1d:14", TTL_KLINES,
            [("weex", _weex("/capi/v3/market/klines", {"symbol": sym, "interval": "1d", "limit": "14"}))],
            stale_ttl=STALE_KLINES,
        ),
        _funding_raw(sym),
    )
    funding_raw, funding_src, funding_stale = funding

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
            **feed.origin({"price": price_src, "klines": klines_src, "funding": funding_src}),
            "stale": price_stale or klines_stale or funding_stale,
        }

    raise HTTPException(502, f"WEEX ticker недоступен для {sym}")


# ── Open Interest ─────────────────────────────────────────────────────────────

@router.get("/open-interest/{symbol}")
async def open_interest(symbol: str):
    """Открытый интерес по паре из WEEX.

    Второго источника не будет: открытый интерес - величина по бирже, а не по
    рынку (ТЗ §5.2).
    """
    sym = symbol.upper()
    data, source, stale = await feed.fetch(
        f"oi:{sym}", TTL_FUNDING,
        [("weex", _weex("/capi/v3/market/openInterest", {"symbol": sym}))],
        stale_ttl=STALE_FUNDING,
    )
    payload = (data.get("data") or data) if data else None
    oi_value = None
    if isinstance(payload, dict):
        for key in ("openInterest", "open_interest", "oi", "value"):
            if key in payload:
                oi_value = str(payload[key])
                break
    elif isinstance(payload, (int, float, str)):
        oi_value = str(payload)
    return {
        "symbol": sym,
        "open_interest": oi_value,
        "raw": payload,
        "source": source,
        "stale": stale,
    }


# ── Derivatives (OI + Funding) ────────────────────────────────────────────────

@router.get("/derivatives/{symbol}")
async def derivatives(symbol: str):
    """OI + ставка финансирования + 24ч изменение из WEEX для одной пары."""
    sym = symbol.upper()

    (oi_raw, oi_src, oi_stale), funding, (price_raw, price_src, price_stale), (klines_raw, klines_src, klines_stale) = await asyncio.gather(
        feed.fetch(
            f"oi:{sym}", TTL_FUNDING,
            [("weex", _weex("/capi/v3/market/openInterest", {"symbol": sym}))],
            stale_ttl=STALE_FUNDING,
        ),
        _funding_raw(sym),
        feed.fetch(
            f"price:{sym}", TTL_PRICE,
            [("weex", _weex("/capi/v3/market/symbolPrice", {"symbol": sym}))],
            stale_ttl=STALE_PRICE,
        ),
        feed.fetch(
            f"klines:{sym}:1d:1", TTL_KLINES,
            [("weex", _weex("/capi/v3/market/klines", {"symbol": sym, "interval": "1d", "limit": "1"}))],
            stale_ttl=STALE_KLINES,
        ),
    )
    funding_raw, funding_src, funding_stale = funding

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
        **feed.origin({
            "oi": oi_src, "funding": funding_src,
            "price": price_src, "klines": klines_src,
        }),
        "stale": oi_stale or funding_stale or price_stale or klines_stale,
    }


# ── Recent Trades ────────────────────────────────────────────────────────────

@router.get("/trades/{symbol}")
async def recent_trades(symbol: str, limit: int = 40):
    """Последние сделки — WEEX Futures API /capi/v3/market/trades.

    Лента, как и стакан, устаревшей не бывает: `stale_ttl` нулевой.
    """
    sym = symbol.upper()
    data, source, stale = await feed.fetch(
        f"trades:{sym}", TTL_BOOK,
        [("weex", _weex("/capi/v3/market/trades", {"symbol": sym, "limit": min(limit, 100)}))],
        stale_ttl=STALE_BOOK,
    )
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
            ],
            "source": source,
            "stale": stale,
        }
    raise HTTPException(502, "Trades недоступны")


# ── Все доступные символы WEEX ────────────────────────────────────────────────

@router.get("/symbols")
async def symbols():
    """Список всех фьючерсных пар WEEX."""
    data, source, stale = await feed.fetch(
        "symbols", TTL_SYMBOLS,
        [("weex", _weex("/capi/v3/market/contracts"))],
        stale_ttl=STALE_SYMBOLS,
    )
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
        source, stale = None, False

    return {"symbols": sorted(result), "source": source, "stale": stale}


# ── Fear & Greed ──────────────────────────────────────────────────────────────

async def _fng_raw() -> Any:
    s = await session.get()
    async with s.get(FNG_URL) as r:
        if r.status != 200:
            raise RuntimeError(f"FNG HTTP {r.status}")
        return await r.json(content_type=None)


@router.get("/fear-greed")
async def fear_greed():
    """Fear & Greed Index из alternative.me (последние 30 дней)."""
    data, source, stale = await feed.fetch(
        "fng", TTL_FNG, [("alternative.me", _fng_raw)], stale_ttl=STALE_FNG,
    )
    if not data:
        raise HTTPException(502, "FNG API недоступен")
    items = data.get("data", [])
    return {
        "current": items[0] if items else None,
        "history": items[:30],
        "source": source,
        "stale": stale,
    }
