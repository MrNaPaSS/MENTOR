"""Скринер и стакан для скальпинга (HTTP).

Эндпоинты только читают состояние, собранное фоновым сборщиком, и в биржу не
ходят. Поэтому они отвечают за микросекунды и выдерживают любую частоту опроса:
живое обновление идёт по WebSocket, а HTTP нужен для первой отрисовки и для
клиентов, которым сокет недоступен.
"""

from __future__ import annotations

import time
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from backend.scalping.clusters import fit_to_rows
from backend.scalping.collector import ScalpingCollector
from backend.scalping.ladder import DEFAULT_ROWS, MAX_ROWS, build_ladder
from backend.scalping.metrics import SHELF_MAX_LIMIT, SHELF_MIN_LIMIT, SHELF_MIN_NOTIONAL
from backend.scalping.state import (
    BAND_BP,
    DEFAULT_SORT,
    SORT_KEYS,
    biggest_wall,
    liquidity_shelves,
)

router = APIRouter(prefix="/api/scalping", tags=["scalping"])


def get_collector(request: Request) -> ScalpingCollector:
    collector = getattr(request.app.state, "scalping", None)
    if collector is None:
        raise HTTPException(503, "Сборщик скальпинга не запущен")
    return collector


@router.get("/screener")
async def screener(
    request: Request,
    sort: str = Query(DEFAULT_SORT, description=f"Одно из: {', '.join(SORT_KEYS)}"),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Список монет с метриками скальпинга, отсортированный по выбранному полю."""
    collector = get_collector(request)
    rows = collector.state.rows(sort=sort)[:limit]
    return {
        "sort": sort if sort in SORT_KEYS else DEFAULT_SORT,
        "band_bp": BAND_BP,
        "count": len(rows),
        "rows": [asdict(r) for r in rows],
    }


@router.get("/dom/{symbol}")
async def dom(
    request: Request,
    symbol: str,
    rows: int = Query(DEFAULT_ROWS, ge=4, le=MAX_ROWS),
    tick: float | None = Query(None, gt=0, description="Шаг ценовой шкалы"),
    agg: int = Query(1, ge=1, le=100, description="Укрупнение шага биржи, разы"),
    shelf: float = Query(
        SHELF_MIN_NOTIONAL,
        ge=SHELF_MIN_LIMIT,
        le=SHELF_MAX_LIMIT,
        description="Порог полки ликвидности в деньгах",
    ),
) -> dict[str, Any]:
    """Лестница стакана с плитами и метриками по одному инструменту."""
    collector = get_collector(request)
    sym = symbol.upper()

    state = collector.state.get(sym)
    if state is None:
        raise HTTPException(404, f"{sym} не под наблюдением — откройте его через WebSocket")
    if not state.book.ready:
        raise HTTPException(503, f"Стакан {sym} ещё собирается")

    ladder, step = build_ladder(state.book, rows=rows, tick=tick, agg=agg)
    wall = biggest_wall(state)
    tape = state.tape.metrics(int(time.time()))

    return {
        "symbol": sym,
        "tick": step,
        "base_tick": step / max(1, agg) if not tick else step,
        "best_bid": state.book.best_bid,
        "best_ask": state.book.best_ask,
        "mid": state.book.mid,
        "book_ratio": state.book_ratio,
        "depth": {"bids": len(state.book.bids), "asks": len(state.book.asks)},
        "rows": [asdict(r) for r in ladder],
        "wall": asdict(wall) if wall else None,
        "shelves": [asdict(s) for s in liquidity_shelves(state, min_notional=shelf)],
        "tape": asdict(tape),
        "clusters": [
            {
                "start": c.start,
                "buy": c.buy,
                "sell": c.sell,
                "cells": [[p, x.buy, x.sell] for p, x in c.cells.items()],
            }
            for c in (
                fit_to_rows(state.clusters.snapshot(), [r.price for r in ladder], step)
                if state.clusters
                else []
            )
        ],
    }


# Свечи меняются раз в минуту, а график перерисовывается чаще — короткий кэш
# держит расход лимита биржи около нуля независимо от числа открытых вкладок.
_KLINE_TTL = 2.0
_klines_cache: dict[str, tuple[float, list]] = {}


@router.get("/klines/{symbol}")
async def klines(
    request: Request,
    symbol: str,
    # Дневные, недельные и месячные нужны не для отрисовки свечей, а ради
    # уровней прошлого периода: индикатор рисует их на любом таймфрейме.
    interval: str = Query("1m", pattern=r"^(1m|3m|5m|15m|30m|1h|4h|1d|1w|1M)$"),
    limit: int = Query(240, ge=2, le=500),
) -> dict[str, Any]:
    """Свечи для графика рядом со стаканом — из того же источника, что и книга."""
    collector = get_collector(request)
    sym = symbol.upper()
    key = f"{sym}:{interval}:{limit}"

    cached = _klines_cache.get(key)
    now = time.monotonic()
    # Только свежие данные. Устаревшая свеча в скальпинге хуже пустого экрана:
    # по ней принимают решение, считая её текущей. Нет свежих — так и говорим.
    if cached and now - cached[0] < _KLINE_TTL:
        rows = cached[1]
    else:
        raw = await collector.rest.klines(sym, interval, limit)
        rows = []
        for r in raw:
            try:
                rows.append(
                    {
                        # Секунды, а не миллисекунды: график ждёт их в секундах.
                        "time": int(r[0]) // 1000,
                        "open": float(r[1]),
                        "high": float(r[2]),
                        "low": float(r[3]),
                        "close": float(r[4]),
                        "volume": float(r[5]),
                    }
                )
            except (TypeError, ValueError, IndexError):
                continue
        _klines_cache[key] = (now, rows)

    if not rows:
        if collector.rest.blocked:
            raise HTTPException(
                503,
                f"Биржа ограничила запросы, свечи появятся через "
                f"{collector.rest.blocked_for:.0f} с",
            )
        raise HTTPException(502, f"Свечи {sym} недоступны")
    return {"symbol": sym, "interval": interval, "candles": rows}


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    """Состояние сборщика — что под наблюдением и жив ли поток биржи."""
    collector = get_collector(request)
    ready = sum(1 for s in collector.state.values() if s.book.ready)
    return {
        "connected": collector.stream.connected,
        "tracked": sorted(collector.tracked),
        "books_ready": ready,
        "streams": len(collector.stream.streams),
        # Сколько секунд биржа держит нас закрытыми. Ноль — всё в порядке;
        # больше нуля значит 418 или 429, и до конца паузы книги не соберутся.
        "throttled_for": round(collector.rest.blocked_for, 1),
    }
