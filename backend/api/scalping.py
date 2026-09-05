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

from backend.scalping.collector import ScalpingCollector
from backend.scalping.ladder import DEFAULT_ROWS, MAX_ROWS, build_ladder
from backend.scalping.state import BAND_BP, DEFAULT_SORT, SORT_KEYS, biggest_wall

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
        "tape": asdict(tape),
    }


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
    }
