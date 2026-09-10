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
import html
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
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


# ── Крипто-новости (RSS изданий) ──────────────────────────────────────────────
#
# Раньше раздел ТВ брал новости у CryptoCompare прямо из браузера. Тот закрыл
# бесплатный доступ ключом, и лента молча опустела. Здесь - открытые RSS самих
# изданий: ключа им не нужно, а через наш сервер браузеру не мешает CORS.
# Каждое издание - отдельный запрос: упало одно, лента остаётся из остальных.

NEWS_FEEDS: dict[str, list[tuple[str, str]]] = {
    "ru": [
        ("ForkLog", "https://forklog.com/feed"),
        ("Bits.media", "https://bits.media/rss2/"),
        ("Incrypted", "https://incrypted.com/feed/"),
    ],
    "en": [
        ("Cointelegraph", "https://cointelegraph.com/rss"),
        ("Decrypt", "https://decrypt.co/feed"),
        ("The Block", "https://www.theblock.co/rss.xml"),
    ],
}

NEWS_LIMIT = 40
_FEED_MAX_BYTES = 3 * 1024 * 1024
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


async def _get_text(url: str) -> str | None:
    try:
        session = await _get_session()
        async with session.get(url, headers={"User-Agent": "Mozilla/5.0 (nmnh-platform)"}) as r:
            if r.status != 200:
                return None
            # Кусками до конца: read(n) отдаёт то, что уже пришло, а не n
            # байт, и лента обрывалась на середине документа.
            raw = bytearray()
            async for chunk in r.content.iter_chunked(64 * 1024):
                raw.extend(chunk)
                if len(raw) > _FEED_MAX_BYTES:
                    return None
            return bytes(raw).decode(r.charset or "utf-8", errors="replace")
    except Exception:
        return None


def _plain(text: str | None, limit: int) -> str:
    """Текст без разметки: в описаниях RSS - HTML с картинками и ссылками."""
    clean = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", text or ""))).strip()
    return clean if len(clean) <= limit else clean[: limit - 1].rstrip() + "…"


def _parse_feed(source: str, body: str) -> list[dict]:
    # Объявления сущностей в новостной ленте не нужны никому, а раздуть
    # разбор ими может любой, кто подменит ответ. Такой документ не читаем.
    if "<!ENTITY" in body:
        return []
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    items = []
    for item in root.iter("item"):
        title = _plain(item.findtext("title"), 220)
        link = (item.findtext("link") or "").strip()
        if not title or not link.startswith(("https://", "http://")):
            continue
        try:
            published = int(parsedate_to_datetime(item.findtext("pubDate") or "").timestamp())
        except (TypeError, ValueError):
            published = 0
        items.append({
            "title": title,
            "url": link,
            "source": source,
            "published": published,
            "summary": _plain(item.findtext("description"), 180),
        })
    return items


async def _build_news(lang: str) -> dict | None:
    feeds = NEWS_FEEDS[lang]
    bodies = await asyncio.gather(*(_get_text(url) for _, url in feeds))
    seen: set[str] = set()
    items: list[dict] = []
    for (source, _), body in zip(feeds, bodies):
        for entry in _parse_feed(source, body) if body else []:
            if entry["url"] not in seen:
                seen.add(entry["url"])
                items.append(entry)
    if not items:
        return None
    items.sort(key=lambda e: e["published"], reverse=True)
    return {"lang": lang, "items": items[:NEWS_LIMIT]}


@router.get("/news")
async def market_news(lang: str = Query("ru")):
    lang = lang if lang in NEWS_FEEDS else "ru"
    return await _cached(f"news:{lang}", 300, lambda: _build_news(lang)) or {"lang": lang, "items": []}
