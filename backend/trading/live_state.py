"""Короткая общая память чтений с биржи.

Терминал спрашивает позиции и защиту раз в три-четыре секунды, а после взятой
цели - каждые семь десятых; сопровождение обходит те же счета своим кругом. До
этого слоя каждый такой вопрос уходил на биржу отдельным запросом: на сотне
учеников это десятки запросов в секунду с одного адреса, и биржа начинает
резать - в том числе тогда, когда надо переставить стоп.

Здесь ответы живут секунду и достаются всем, кто спросит за это время. Секунда
выбрана не на глаз: обход сопровождения идёт раз в пять секунд, опрос терминала
- раз в 0.7-4, и внутри одной секунды ответ биржи всё равно один и тот же.

Одинаковые запросы не идут парой: пока первый в пути, остальные ждут его ответ
(замок на ключ). Так десять открытых вкладок одного ученика дают один запрос, а
не десять.

**Любая запись сбрасывает память счёта.** Поставили заявку, сняли стоп,
передвинули цель - следующий вопрос уходит на биржу. Иначе терминал секунду
показывал бы состояние до действия, а сопровождение приняло бы его за правду.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

logger = logging.getLogger("nmnh.trading.state")

# Сколько живёт ответ. Меньше секунды смысла не имеет - опрос терминала реже,
# больше нельзя: после взятой цели состояние меняется за доли секунды.
TTL = 1.0

# Что читаем через память. Всё остальное уходит на биржу как есть: справочник
# инструментов кэширует сам клиент, а исполнения нужны точные и редко.
READS = ("positions", "algo_orders", "open_orders")

# Что сбрасывает память счёта: всё, что меняет заявки, позиции или плечо.
WRITES = (
    "place_order",
    "place_tp_sl",
    "modify_tp_sl",
    "cancel_order",
    "cancel_algo_order",
    "cancel_all_algo",
    "set_leverage",
)

_cache: dict[tuple, tuple[float, Any]] = {}
_locks: dict[tuple, asyncio.Lock] = {}


def forget(account: tuple) -> None:
    """Забыть всё, что помним про этот счёт."""
    for key in [k for k in _cache if k[: len(account)] == account]:
        _cache.pop(key, None)


def clear() -> None:
    """Забыть всё. Нужно тестам и перезапуску."""
    _cache.clear()
    _locks.clear()


async def read(key: tuple, fetch: Callable[[], Awaitable[Any]], ttl: float = TTL) -> Any:
    """Ответ из памяти или с биржи. Одинаковые вопросы ждут один ответ."""
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]

    lock = _locks.get(key)
    if lock is None:
        lock = _locks[key] = asyncio.Lock()
    async with lock:
        # Пока ждали замок, ответ мог приехать к соседу.
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        value = await fetch()
        _cache[key] = (time.monotonic(), value)
        return value


class Cached:
    """Клиент биржи с общей памятью чтений на счёт.

    Прозрачная обёртка: всё, кроме чтений из `READS`, уходит клиенту как есть, и
    для остального кода это тот же самый клиент - включая `exchange` и прочие
    его свойства.
    """

    def __init__(self, client: Any, account: tuple, ttl: float = TTL):
        self._client = client
        self._account = tuple(account)
        self._ttl = ttl

    def __getattr__(self, name: str) -> Any:
        value = getattr(self._client, name)
        if name in WRITES and callable(value):

            async def written(*args, **kwargs):
                try:
                    return await value(*args, **kwargs)
                finally:
                    # Сбрасываем и после отказа: биржа могла успеть применить
                    # запрос и ответить ошибкой по дороге.
                    forget(self._account)

            return written
        return value

    async def positions(self) -> Any:
        return await read(
            (*self._account, "positions"), self._client.positions, self._ttl
        )

    async def algo_orders(self, symbol: str) -> Any:
        return await read(
            (*self._account, "algo_orders", str(symbol).upper()),
            lambda: self._client.algo_orders(symbol),
            self._ttl,
        )

    async def open_orders(self, symbol: str) -> Any:
        return await read(
            (*self._account, "open_orders", str(symbol).upper()),
            lambda: self._client.open_orders(symbol),
            self._ttl,
        )


def cached(client: Any, student_id: int, exchange: str, ttl: float = TTL) -> Any:
    """Обернуть клиент общей памятью счёта. Уже обёрнутый не оборачиваем дважды."""
    if isinstance(client, Cached):
        return client
    return Cached(client, (int(student_id), str(exchange)), ttl)
