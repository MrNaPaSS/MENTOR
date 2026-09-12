"""Кэш рыночных данных с отдельным сроком для устаревшего (ТЗ этап 1, §4.2).

Отдаёт **пару**: значение и признак свежести. Вызывающему нужно знать, отдал
он живые данные или последние известные, - на экране устаревшее значение
подписывается, молча подменять цифру в терминале нельзя.

Правила:

* свежее в пределах `ttl` - отдаём как есть;
* строитель вернул значение - кладём и отдаём;
* строитель упал или вернул `None` - отдаём последнее известное с пометкой;
* последнему известному больше `stale_ttl` - не отдаём ничего.

Предел устаревания - наше отличие от образца. У OpenTerminal устаревшее живёт
вечно; в продукте, где по этой цене считают позицию, пустота честнее старой
цифры. Для стакана и ленты предел нулевой: по устаревшему стакану нельзя
ставить заявку.
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

# Во сколько раз устаревшее живёт дольше свежего, если предел не задан явно.
# Для цен и стакана он задаётся явно и коротко - см. таблицу в ТЗ §4.2.
DEFAULT_STALE_FACTOR = 15

# Окно, за которое считаем отданное устаревшее для /api/market/status.
STALE_WINDOW_SECONDS = 3600

_store: dict[str, tuple[float, Any]] = {}
_stale_served: list[float] = []


async def cached(
    key: str,
    ttl: float,
    builder: Callable[[], Awaitable[Any]],
    *,
    stale_ttl: float | None = None,
    now: float | None = None,
) -> tuple[Any, bool]:
    """Значение и признак «это последнее известное, а не живое».

    `None` в значении означает «данных нет»; признак устаревания относится
    только к отданному значению, поэтому у пустоты он всегда `False`.
    """
    now = time.time() if now is None else now
    limit = ttl * DEFAULT_STALE_FACTOR if stale_ttl is None else stale_ttl

    hit = _store.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1], False

    try:
        value = await builder()
    except Exception:
        # Почему упал источник - забота реестра, он это и записал. Кэшу важно
        # одно: живого значения нет.
        value = None

    if value is not None:
        _store[key] = (now, value)
        return value, False

    if hit is None:
        return None, False

    if limit <= 0 or now - hit[0] > limit:
        return None, False

    _stale_served.append(now)
    return hit[1], True


def stats(*, now: float | None = None) -> dict[str, int]:
    """Состояние кэша для `/api/market/status`."""
    now = time.time() if now is None else now
    recent = [t for t in _stale_served if now - t < STALE_WINDOW_SECONDS]
    _stale_served[:] = recent
    return {"keys": len(_store), "stale_served_last_hour": len(recent)}


def reset() -> None:
    _store.clear()
    _stale_served.clear()
