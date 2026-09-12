"""Реестр источников: цепочка до первой удачи и счёт здоровья (ТЗ этап 1, §4.3).

`with_fallback` идёт по списку источников до первой удачи и возвращает имя
сработавшего. Имя уходит в ответ API и дальше на экран: цена из другого места
подписывается, а не подменяется молча.

`tracked` мерит время, считает удачи и отказы, помнит последнюю ошибку и время
последней удачи. Скользящая средняя задержки считается как у образца:
`avg = avg * 0.8 + ms * 0.2`.

Поле `blocked_until` - наше. Клиент фьючерсов Binance умеет самоблокироваться
по весу запросов, и реестр обязан это видеть, а не долбить заблокированный
источник на каждом запросе ученика.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from typing import Any, Awaitable, Callable, Iterable

# Подменяется в тестах: измерять задержку настоящими часами там нечем.
_monotonic = time.monotonic

# Вес нового измерения в скользящей средней.
LATENCY_WEIGHT = 0.2


class SourceFailed(RuntimeError):
    """Источник не дал данных. Текст - для журнала состояния, не для ученика."""


@dataclass(frozen=True)
class SourceStats:
    name: str
    ok: int = 0
    failed: int = 0
    last_latency_ms: float | None = None
    avg_latency_ms: float | None = None
    last_error: str | None = None
    last_success: float | None = None
    blocked_until: float | None = None


_stats: dict[str, SourceStats] = {}


def _row(name: str) -> SourceStats:
    return _stats.setdefault(name, SourceStats(name=name))


async def tracked(name: str, builder: Callable[[], Awaitable[Any]]) -> Any:
    """Вызвать источник, засчитав время и исход. Пустой ответ - тоже отказ."""
    row = _row(name)
    started = _monotonic()
    try:
        value = await builder()
    except Exception as exc:
        _record_failure(name, f"{type(exc).__name__}: {exc}")
        raise SourceFailed(str(exc)) from exc

    if value is None:
        _record_failure(name, "пустой ответ")
        raise SourceFailed("пустой ответ")

    ms = (_monotonic() - started) * 1000
    avg = ms if row.avg_latency_ms is None else (
        row.avg_latency_ms * (1 - LATENCY_WEIGHT) + ms * LATENCY_WEIGHT
    )
    _stats[name] = replace(
        row,
        ok=row.ok + 1,
        last_latency_ms=ms,
        avg_latency_ms=avg,
        last_error=None,
        last_success=time.time(),
    )
    return value


def _record_failure(name: str, error: str) -> None:
    row = _row(name)
    _stats[name] = replace(row, failed=row.failed + 1, last_error=error[:200])


async def with_fallback(
    attempts: Iterable[tuple[str, Callable[[], Awaitable[Any]]]],
    *,
    now: float | None = None,
) -> tuple[Any, str | None]:
    """Пройти источники по порядку. Возвращает значение и имя сработавшего."""
    for name, builder in attempts:
        if is_blocked(name, now=now):
            continue
        try:
            return await tracked(name, builder), name
        except SourceFailed:
            continue
    return None, None


def mark_blocked(name: str, seconds: float, *, now: float | None = None) -> None:
    """Не ходить в источник до срока. Так клиент Binance сообщает о своём весе."""
    now = time.time() if now is None else now
    _stats[name] = replace(_row(name), blocked_until=now + seconds)


def is_blocked(name: str, *, now: float | None = None) -> bool:
    row = _stats.get(name)
    if row is None or row.blocked_until is None:
        return False
    now = time.time() if now is None else now
    if now >= row.blocked_until:
        # Срок вышел - метку снимаем, чтобы она не путала картину в состоянии.
        _stats[name] = replace(row, blocked_until=None)
        return False
    return True


def stats() -> list[SourceStats]:
    return [_stats[name] for name in sorted(_stats)]


def reset() -> None:
    _stats.clear()
