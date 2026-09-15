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

Поверх памяти живёт второй, более быстрый источник - **приватный поток биржи**
(`core/okx/stream.py`). Пока он подключён, позиции счёта не спрашиваются вовсе:
биржа сама присылает их при каждом изменении. Источник привязывается к счёту
(`attach`) и отвязывается при обрыве - решает он сам, свойством `ready`, и
поэтому здесь нет ни срока жизни, ни отдельного сердцебиения.

Сразу после нашей записи потоку выдерживается пауза недоверия: событие о новой
заявке идёт к нам доли секунды, и в это окно правду знает только биржа.
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
    # Закрытие позиции своей ручкой (OKX): после него позиции уже нет.
    "close_position",
)

# Сколько после своей записи не доверяем потоку. Событие о новой заявке идёт
# от биржи доли секунды, и в это окно её ответ на запрос правдивее push-а.
DISTRUST = 1.0

_cache: dict[tuple, tuple[float, Any]] = {}
_locks: dict[tuple, asyncio.Lock] = {}
# Приватные потоки по счетам: объект со свойством `ready` и методом
# `positions()`. Держим ссылку, а не снимок: поток сам знает, жив ли он.
_sources: dict[tuple, Any] = {}
# До какого момента счёт читаем только с биржи - после своей же записи.
_distrust: dict[tuple, float] = {}


def forget(account: tuple) -> None:
    """Забыть всё, что помним про этот счёт."""
    for key in [k for k in _cache if k[: len(account)] == account]:
        _cache.pop(key, None)
    # И потоку в это окно не верим: он ещё не знает о том, что мы сделали.
    _distrust[tuple(account)] = time.monotonic() + DISTRUST


def attach(account: tuple, source: Any) -> None:
    """Подключить приватный поток счёта: пока он жив, позиции не опрашиваются."""
    _sources[tuple(account)] = source


def detach(account: tuple) -> None:
    """Поток закрыт - возвращаемся к опросу биржи."""
    _sources.pop(tuple(account), None)
    forget(account)


def live_positions(account: tuple) -> Any | None:
    """Позиции из приватного потока. `None` - потока нет, доверять нечему."""
    key = tuple(account)
    if time.monotonic() < _distrust.get(key, 0.0):
        return None
    source = _sources.get(key)
    if source is None or not getattr(source, "ready", False):
        return None
    return source.positions()


def clear() -> None:
    """Забыть всё. Нужно тестам и перезапуску."""
    _cache.clear()
    _locks.clear()
    _sources.clear()
    _distrust.clear()


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
        # Приватный поток биржи знает позиции точнее и раньше: он присылает их
        # в момент изменения, а не через секунду опроса.
        live = live_positions(self._account)
        if live is not None:
            return live
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
