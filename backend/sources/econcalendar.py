"""Календарь макроэкономических событий (ТЗ этап 4, §7.1).

Источник - недельный срез Forex Factory: `nfs.faireconomy.media`, бесплатно и
без ключа, с важностью, прогнозом и фактом. Раньше на этом месте стоял
встроенный скрипт TradingView: чужой бренд, своя тема и внешний скрипт на
странице ученика.

Оставляем только то, что двигает крипту: важность high и medium, валюты USD и
EUR. Решение Резервного банка Новой Зеландии биткоин не двигает, а список из
сотни строк читать невозможно.

Источник публичный и не лицензированный, поэтому ходим редко: один запрос на
срок жизни кэша на весь сервер, сколько бы учеников ни смотрело.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.sources import session

log = logging.getLogger(__name__)

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

# Живём 15 минут, устаревшее годится сутки: сутки старого календаря лучше
# пустой вкладки, а события на неделю вперёд за сутки не меняются.
TTL = 15 * 60
STALE_TTL = 24 * 3600

NAME = "faireconomy"

KEEP_CURRENCIES = frozenset({"USD", "EUR"})
KEEP_IMPACT = {"high": "high", "medium": "medium"}


def _iso_utc(raw: str | None) -> str | None:
    """Время события в UTC. Источник отдаёт его со смещением своей зоны."""
    if not raw:
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        # Без зоны считать нельзя: час ошибки в календаре это другое событие.
        return None
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def _text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def parse(rows: Any) -> list[dict]:
    """Разобрать ответ источника. Отдельной функцией: её проверяют тесты."""
    if not isinstance(rows, list):
        return []

    events: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        currency = _text(row.get("country") or row.get("currency")).upper()
        if currency not in KEEP_CURRENCIES:
            continue
        importance = KEEP_IMPACT.get(_text(row.get("impact")).lower())
        if importance is None:
            continue
        time_utc = _iso_utc(row.get("date"))
        if time_utc is None:
            continue
        title = _text(row.get("title"))
        if not title:
            continue
        events.append({
            "time": time_utc,
            "currency": currency,
            "title": title,
            "importance": importance,
            "forecast": _text(row.get("forecast")),
            "previous": _text(row.get("previous")),
            "actual": _text(row.get("actual")),
        })

    events.sort(key=lambda e: e["time"])
    return events


async def fetch() -> list[dict] | None:
    """Недельный срез событий. `None` - источник не ответил."""
    s = await session.insecure()
    async with s.get(URL) as r:
        if r.status != 200:
            raise RuntimeError(f"Календарь HTTP {r.status}")
        raw = await r.json(content_type=None)
    events = parse(raw)
    return events or None
