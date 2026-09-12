"""Состояние источников рыночных данных (ТЗ этап 1, §4.5).

Открыта без авторизации и только на чтение: ни адресов, ни ключей в ответе
нет, а знать, откуда сейчас приходят цены и не подсовываем ли мы устаревшее,
полезно и наставнику, и разработчику - выводится в DevBar.

Приём взят из OpenTerminal (MIT), https://github.com/ErTasselli/OpenTerminal -
там это `GET /api/status`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from backend.sources import cache, registry

router = APIRouter(prefix="/api/market", tags=["market-data"])


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _ms(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


@router.get("/status")
async def market_status():
    """Здоровье источников и кэша. Без авторизации, только чтение."""
    return {
        "sources": [
            {
                "name": s.name,
                "ok": s.ok,
                "failed": s.failed,
                "last_latency_ms": _ms(s.last_latency_ms),
                "avg_latency_ms": _ms(s.avg_latency_ms),
                "last_error": s.last_error,
                "last_success": _iso(s.last_success),
                "blocked_until": _iso(s.blocked_until),
            }
            for s in registry.stats()
        ],
        "cache": cache.stats(),
    }
