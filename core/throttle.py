"""Бюджет запросов к бирже: сколько их можно в секунду и что делать сверх того.

У каждой биржи свои пределы, и считает она их на пользователя и на адрес. У OKX
это 10 запросов за 2 секунды на позиции, 20 на условные заявки, 60 на обычные
(документация v5, «Rate Limit» у каждой ручки). Пока учеников десяток, упереться
в них трудно; на сотне - легко, и отказ приходит ровно тогда, когда терминал
опрашивает биржу чаще всего: после взятой цели.

Здесь один общий счётчик на процесс, двумя окнами:

* **на счёт** - чтобы один ученик с десятью вкладками не съел общий предел;
* **на биржу** - потому что все ученики выходят к ней с одного адреса сервера,
  и биржа считает это одним клиентом.

Сверх бюджета запрос не отклоняется, а ждёт своей очереди: отказ биржи стоит
дороже задержки в доли секунды, а в очереди он окажется первым, как только окно
сдвинется.

Числа заданы с запасом вниз: лучше подождать, чем получить запрет на минуту.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass

logger = logging.getLogger("nmnh.throttle")


@dataclass(frozen=True)
class Budget:
    """Сколько запросов и за какое окно."""

    limit: int
    window: float


# Бюджеты бирж. Первое - на счёт ученика, второе - на всю биржу с этого сервера.
BUDGETS: dict[str, tuple[Budget, Budget]] = {
    # OKX считает лимиты на пользователя; самая узкая нужная нам ручка -
    # позиции, 10 за 2 секунды. Берём 8, чтобы осталось место сопровождению.
    "okx": (Budget(8, 2.0), Budget(60, 2.0)),
    # BingX считает частоту и по счёту, и по адресу: у рыночных ручек 500
    # запросов за 10 секунд с адреса, у торговых свой предел на каждую. Берём
    # тот же порядок, что у OKX: сверх бюджета ждём очереди, а не ловим бан на
    # пять минут. Остаток биржа называет сама, заголовком ответа, и клиент
    # пишет его в журнал, когда он подходит к концу (core/bingx/futures.py).
    "bingx": (Budget(8, 2.0), Budget(60, 2.0)),
    # MEXC называет предел торговых ручек прямо: четыре заявки за две
    # секунды. Это самый узкий бюджет из четырёх бирж, и заявку он касается
    # в первую очередь - берём его как есть, а чтение живёт в общем окне
    # биржи (core/mexc/market.py, ORDER_LIMIT).
    "mexc": (Budget(4, 2.0), Budget(40, 2.0)),
    # WEEX пределов в документации не называет. Ставим тот же порядок, что
    # выдерживал терминал до мультибиржи: около запроса в секунду на ключ.
    "weex": (Budget(10, 2.0), Budget(60, 2.0)),
}

DEFAULT = (Budget(8, 2.0), Budget(60, 2.0))

# Дольше этого не ждём: очередь длиной в секунды означает, что бюджет подобран
# неверно, и молча тормозить стопы нельзя - лучше сказать об этом в журнал.
LOUD_WAIT = 1.0


class Window:
    """Окно запросов: помнит время последних и ждёт, когда место освободится."""

    def __init__(self, budget: Budget):
        self.budget = budget
        self._at: deque[float] = deque()

    def _drop_old(self, now: float) -> None:
        while self._at and now - self._at[0] >= self.budget.window:
            self._at.popleft()

    def delay(self, now: float) -> float:
        """Сколько ждать до свободного места. Ноль - можно сейчас."""
        self._drop_old(now)
        if len(self._at) < self.budget.limit:
            return 0.0
        return self.budget.window - (now - self._at[0])

    def took(self, now: float) -> None:
        self._at.append(now)


_windows: dict[tuple, Window] = {}
_locks: dict[str, asyncio.Lock] = {}


def clear() -> None:
    """Забыть счётчики. Нужно тестам."""
    _windows.clear()
    _locks.clear()


def _window(key: tuple, budget: Budget) -> Window:
    window = _windows.get(key)
    if window is None or window.budget != budget:
        window = _windows[key] = Window(budget)
    return window


async def take(exchange: str, account: str, budgets: tuple[Budget, Budget] | None = None) -> float:
    """Занять место в очереди к бирже. Возвращает, сколько пришлось ждать.

    Под замком на биржу: без него десять задач разом увидели бы свободное место
    и ушли на биржу все сразу - ровно то, от чего этот счётчик и заведён.
    """
    code = (exchange or "").lower() or "weex"
    own, shared = budgets or BUDGETS.get(code, DEFAULT)
    lock = _locks.get(code)
    if lock is None:
        lock = _locks[code] = asyncio.Lock()

    waited = 0.0
    async with lock:
        mine = _window((code, account), own)
        all_of_them = _window((code,), shared)
        while True:
            now = time.monotonic()
            delay = max(mine.delay(now), all_of_them.delay(now))
            if delay <= 0:
                mine.took(now)
                all_of_them.took(now)
                break
            waited += delay
            await asyncio.sleep(delay)

    if waited >= LOUD_WAIT:
        logger.warning("Очередь к %s: ждали %.2f с - бюджет запросов на пределе", code, waited)
    return waited
