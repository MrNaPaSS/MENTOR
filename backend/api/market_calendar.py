"""Календарь событий недели (ТЗ этап 4, §7.1).

Ручка на месте встроенного календаря TradingView. Данные берутся раз в
пятнадцать минут на весь сервер: источник публичный и нам ничего не обещал.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.sources import econcalendar, feed

router = APIRouter(prefix="/api/market", tags=["market-data"])


@router.get("/calendar")
async def calendar():
    """События недели: важные и средние, по доллару и евро."""
    events, source, stale = await feed.fetch(
        "calendar", econcalendar.TTL,
        [(econcalendar.NAME, econcalendar.fetch)],
        stale_ttl=econcalendar.STALE_TTL,
    )
    return {
        "events": events or [],
        "source": source,
        "stale": stale,
    }
