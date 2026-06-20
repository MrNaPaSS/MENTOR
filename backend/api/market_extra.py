"""Внешние бесплатные рыночные API (без ключа) — прокси с кэшем.

Источники (проверены на доступность, auth не требуется):
  • CoinGecko      — глобальные метрики рынка, трендовые монеты
  • Coinpaprika    — фолбэк для глобальных метрик
  • mempool.space  — комиссии сети BTC, ретаргет сложности
  • blockchain.info — хешрейт, кол-во транзакций, цена
  • Frankfurter    — курсы форекс

Все ответы кэшируются в памяти (TTL), чтобы не упереться в рейтлимиты
и не ходить во внешний мир на каждый запрос фронта.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/market", tags=["market-extra"])

_session: aiohttp.ClientSession | None = None
_cache: dict[str, tuple[float, Any]] = {}


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=10),
            connector=aiohttp.TCPConnector(ssl=False),
            headers={"User-Agent": "nmnh-platform/1.0"},
        )
    return _session


async def _get_json(url: str) -> Any:
    try:
        session = await _get_session()
        async with session.get(url) as r:
            if r.status != 200:
                return None
            return await r.json(content_type=None)
    except Exception:
        return None


async def _cached(key: str, ttl: float, builder) -> Any:
    """Вернуть значение из кэша или построить новое (с фолбэком на устаревший кэш)."""
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = await builder()
    if value is not None:
        _cache[key] = (now, value)
        return value
    # внешний источник упал — отдаём устаревшие данные, если есть
    return hit[1] if hit else None


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# ── Глобальные метрики рынка ──────────────────────────────────────────────────

async def _build_global() -> dict | None:
    cg = await _get_json("https://api.coingecko.com/api/v3/global")
    if cg and isinstance(cg.get("data"), dict):
        d = cg["data"]
        return {
            "total_market_cap_usd": _num(d.get("total_market_cap", {}).get("usd")),
            "total_volume_usd":     _num(d.get("total_volume", {}).get("usd")),
            "btc_dominance":        _num(d.get("market_cap_percentage", {}).get("btc")),
            "market_cap_change_24h": _num(d.get("market_cap_change_percentage_24h_usd")),
            "active_cryptos":       int(_num(d.get("active_cryptocurrencies"))),
            "source": "coingecko",
        }
    # Фолбэк: Coinpaprika
    cp = await _get_json("https://api.coinpaprika.com/v1/global")
    if cp and isinstance(cp, dict):
        return {
            "total_market_cap_usd":  _num(cp.get("market_cap_usd")),
            "total_volume_usd":      _num(cp.get("volume_24h_usd")),
            "btc_dominance":         _num(cp.get("bitcoin_dominance_percentage")),
            "market_cap_change_24h": _num(cp.get("market_cap_change_24h")),
            "active_cryptos":        int(_num(cp.get("cryptocurrencies_number"))),
            "source": "coinpaprika",
        }
    return None


@router.get("/global")
async def market_global():
    return await _cached("global", 60, _build_global)


# ── Трендовые монеты ──────────────────────────────────────────────────────────

async def _build_trending() -> dict | None:
    data = await _get_json("https://api.coingecko.com/api/v3/search/trending")
    if not data or not isinstance(data.get("coins"), list):
        return None
    coins = []
    for c in data["coins"][:10]:
        item = c.get("item", {}) if isinstance(c, dict) else {}
        coins.append({
            "id":     item.get("id"),
            "name":   item.get("name"),
            "symbol": (item.get("symbol") or "").upper(),
            "rank":   item.get("market_cap_rank"),
            "thumb":  item.get("thumb"),
            "price_btc": _num(item.get("price_btc")),
        })
    return {"coins": coins}


@router.get("/trending")
async def market_trending():
    return await _cached("trending", 120, _build_trending)


# ── On-chain BTC (mempool.space + blockchain.info) ────────────────────────────

async def _build_onchain() -> dict | None:
    fees, diff, stats = await asyncio.gather(
        _get_json("https://mempool.space/api/v1/fees/recommended"),
        _get_json("https://mempool.space/api/v1/difficulty-adjustment"),
        _get_json("https://api.blockchain.info/stats"),
    )
    if not (fees or stats):
        return None
    fees = fees or {}
    diff = diff or {}
    stats = stats or {}
    return {
        "fees": {
            "fastest":  int(_num(fees.get("fastestFee"))),
            "half_hour": int(_num(fees.get("halfHourFee"))),
            "hour":     int(_num(fees.get("hourFee"))),
            "economy":  int(_num(fees.get("economyFee"))),
        },
        "hash_rate_ehs":       round(_num(stats.get("hash_rate")) / 1e9, 1),  # GH/s → EH/s
        "tx_count_24h":        int(_num(stats.get("n_tx"))),
        "market_price_usd":    _num(stats.get("market_price_usd")),
        "difficulty_change_pct": round(_num(diff.get("difficultyChange")), 2),
        "retarget_progress_pct": round(_num(diff.get("progressPercent")), 1),
    }


@router.get("/onchain")
async def market_onchain():
    return await _cached("onchain", 60, _build_onchain)


# ── Форекс-курсы (Frankfurter) ────────────────────────────────────────────────

async def _build_forex(base: str, symbols: str) -> dict | None:
    url = f"https://api.frankfurter.app/latest?from={base}&to={symbols}"
    data = await _get_json(url)
    if not data or not isinstance(data.get("rates"), dict):
        return None
    return {"base": data.get("base", base), "date": data.get("date"), "rates": data["rates"]}


@router.get("/forex")
async def market_forex(
    base: str = Query("USD"),
    symbols: str = Query("EUR,GBP,JPY,CHF,CAD,AUD"),
):
    base = base.upper()
    symbols = symbols.upper()
    return await _cached(f"forex:{base}:{symbols}", 600, lambda: _build_forex(base, symbols))
