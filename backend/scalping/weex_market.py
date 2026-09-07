"""Список монет WEEX для скринера.

Терминал торгует на WEEX, а список монет и метрики берёт с другой биржи. Пока
речь о ликвидных парах, разницы почти нет: цена та же с точностью до спреда.
Но торгует трейдер здесь, и монеты, которых на WEEX нет вовсе, ему в списке
незачем - как и обратное: пара, которую WEEX даёт, а сосед нет, из списка
пропадала.

Своего сборщика стаканов для WEEX у нас нет, и заводить его ради списка
незачем: биржа отдаёт суточную сводку по всем инструментам одним запросом.
Отсюда и берём то, что в ней есть - цену, изменение, оборот, спред по лучшим
ценам, - а поля, которые считаются только по стакану и ленте, оставляем
пустыми. Пустое поле честнее выдуманного: трейдер сортирует по обороту и
изменению, и врать ему про дельту ленты, которой мы не видим, нельзя.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import aiohttp

logger = logging.getLogger("nmnh.scalping.weex")

TICKERS_URL = "https://api-contract.weex.com/capi/v2/market/tickers"

# Сводка обновляется у биржи не чаще раза в секунду, а скринер спрашивают
# восемь раз в секунду. Держим ответ несколько секунд: список монет за это
# время не меняется, а запрос тяжёлый - под триста килобайт.
CACHE_SECONDS = 5.0

_cache: tuple[float, list[dict[str, Any]]] = (0.0, [])
_lock = asyncio.Lock()


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def symbol_of(raw: str) -> str:
    """Имя пары в привычном виде: `cmt_btcusdt` - это BTCUSDT."""
    name = str(raw or "").strip().lower()
    if name.startswith("cmt_"):
        name = name[4:]
    return name.upper()


def row_of(ticker: dict[str, Any]) -> dict[str, Any] | None:
    """Строка скринера из суточной сводки биржи.

    Поля, которых в сводке нет, остаются нулями: они считаются по стакану и
    ленте, а их для этих монет мы не собираем. Ноль здесь означает «не знаем», и
    в интерфейсе это видно - колонка пустая, а не выдуманная.
    """
    symbol = symbol_of(ticker.get("symbol"))
    if not symbol.endswith("USDT"):
        return None

    price = _f(ticker.get("last")) or _f(ticker.get("markPrice"))
    if price <= 0:
        return None

    bid = _f(ticker.get("best_bid"))
    ask = _f(ticker.get("best_ask"))
    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else price
    spread = (ask - bid) / mid * 10_000 if mid > 0 and ask > bid else 0.0

    high = _f(ticker.get("high_24h"))
    low = _f(ticker.get("low_24h"))
    # Размах за сутки, а не за минуту: минутного у нас здесь нет, а сутки -
    # это то, что биржа действительно сказала.
    span = (high - low) / mid * 10_000 if mid > 0 and high > low else 0.0

    return {
        "symbol": symbol,
        "price": price,
        # Биржа отдаёт долю, а не проценты: -0.009607 это -0.96%.
        "change_pct": _f(ticker.get("priceChangePercent")) * 100,
        "volume_24h": _f(ticker.get("volume_24h")),
        "spread_bp": spread,
        "book_ratio": 0.0,
        "delta_notional": 0.0,
        "buy_ratio": 0.0,
        "trades_per_min": 0.0,
        "spike": 0.0,
        "range_bp": span,
        "wall_notional": 0.0,
        "wall_side": "",
        "wall_price": 0.0,
        "wall_distance_bp": 0.0,
        # Стакан по этой монете мы не ведём: строка живая по цене, но не по
        # книге, и терминал должен это знать.
        "live": False,
    }


async def tickers(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    """Суточная сводка по всем инструментам WEEX, с коротким кэшем."""
    global _cache

    fresh_at, rows = _cache
    if rows and time.time() - fresh_at < CACHE_SECONDS:
        return rows

    async with _lock:
        # Пока ждали замок, сводку мог обновить другой запрос.
        fresh_at, rows = _cache
        if rows and time.time() - fresh_at < CACHE_SECONDS:
            return rows

        try:
            async with session.get(
                TICKERS_URL, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status != 200:
                    logger.warning("Сводка WEEX: ответ %s", resp.status)
                    return rows
                data = await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
            logger.warning("Сводка WEEX не получена: %s", exc)
            # Отдаём прошлую, если она есть: устаревший список полезнее пустого.
            return rows

        if not isinstance(data, list):
            return rows
        _cache = (time.time(), data)
        return data


async def screener_rows(
    session: aiohttp.ClientSession, sort: str, limit: int
) -> list[dict[str, Any]]:
    """Список монет WEEX, отсортированный так же, как основной скринер."""
    rows = [row for row in (row_of(t) for t in await tickers(session)) if row]
    return sorted(rows, key=_order(sort), reverse=True)[:limit]


def _order(sort: str):
    """Ключ сортировки. По полям, которых в сводке нет, сортируем по обороту.

    Молча отдать список в случайном порядке хуже, чем отдать его по обороту:
    трейдер видит, что сортировка не сработала, только если порядок осмысленный.
    """
    known = {
        "volume": lambda r: r["volume_24h"],
        "change": lambda r: abs(r["change_pct"]),
        "range": lambda r: r["range_bp"],
        "spread": lambda r: -r["spread_bp"],
    }
    return known.get(sort, known["volume"])
