"""Цепочка источников через кэш - одно место, где сходятся реестр и кэш.

Ручке нужны три вещи разом: данные, имя сработавшего источника и признак
устаревания. Имя хранится в кэше вместе со значением, иначе последнее
известное потеряло бы происхождение и на экране было бы написано «данные
WEEX» там, где цифра пришла от второго источника час назад.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Iterable

from backend.sources import cache, registry


async def fetch(
    key: str,
    ttl: float,
    attempts: Iterable[tuple[str, Callable[[], Awaitable[Any]]]],
    *,
    stale_ttl: float | None = None,
) -> tuple[Any, str | None, bool]:
    """Значение, имя источника и признак устаревания.

    Значение `None` означает «данных нет»: все источники молчат, а отдавать
    последнее известное либо нечего, либо уже нельзя по сроку.
    """
    attempts = list(attempts)

    async def builder():
        value, source = await registry.with_fallback(attempts)
        return None if value is None else (value, source)

    pair, stale = await cache.cached(key, ttl, builder, stale_ttl=stale_ttl)
    if pair is None:
        return None, None, False
    value, source = pair
    return value, source, stale


def origin(parts: dict[str, str | None]) -> dict[str, Any]:
    """Происхождение ответа, собранного из нескольких запросов.

    Все части из одного места - пишем его имя. Из разных - `mixed` и разбор по
    полям: в терминале, где считают деньги, должно быть видно, какая именно
    цифра пришла со стороны.
    """
    known = {name for name in parts.values() if name}
    if not known:
        return {"source": None}
    if len(known) == 1:
        return {"source": known.pop()}
    return {"source": "mixed", "sources": {k: v for k, v in parts.items() if v}}
