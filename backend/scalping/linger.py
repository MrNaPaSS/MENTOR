"""Монета, которую только что закрыли, отпускается не сразу.

Кластерная свеча собирается из своей ленты: сервер пишет каждую сделку в
историю, пока инструмент открыт у кого-то в стакане. Уходит последний
смотрящий - история выбрасывается, а на OKX, MEXC и BingX закрывается и сам
поток. Возвращается человек через минуту - собирать нечего, и крупная свеча
достраивается с биржи: OKX отдаёт сделки страницами по сотне (пятнадцатиминутная
свеча BTC набирается меньше чем наполовину), MEXC - только сто последних сделок
вообще. Профиль такой свечи - огрызок.

А ходят по монетам именно так: посмотрел BTC, ушёл на ETH, вернулся. Поэтому
последний смотрящий не отпускает монету мгновенно: она ещё живёт `delay` секунд
и продолжает копить ленту. Вернулись внутри этого срока - история целая, и
профиль крупной свечи собран нами, а не выпрошен у биржи кусками.

Держать так все монеты нельзя: история - самая объёмная структура на
инструмент, а на OKX и MEXC это ещё и живая подписка. Отсюда `limit`: сверх
него самая давняя отпускается немедленно.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger("nmnh.scalping")

# Сколько монета живёт после ухода последнего смотрящего.
#
# Пять минут покрывают обычный круг «посмотрел - ушёл - вернулся» и хватают на
# пятнадцатиминутную свечу целиком, если человек возвращается к ней в пределах
# этого же круга.
LINGER_SECONDS = 300.0

# То же для бирж, где ради своей ленты держится и подписка на книгу (OKX,
# MEXC, BingX): там срок короче и монет меньше - это уже не только память,
# но и поток с биржи, который никто не смотрит.
LINGER_SECONDS_STREAM = 120.0
LINGER_LIMIT_STREAM = 2

# Сколько отпускаемых монет держим разом. Трейдер ходит между двумя-тремя
# парами; четвёртая уже редкость, а память и подписки не бесплатны.
LINGER_LIMIT = 3


class Linger:
    """Отложенный отпуск инструментов: держит недавно закрытые ещё немного."""

    def __init__(
        self,
        release: Callable[[str], Awaitable[None]],
        delay: float = LINGER_SECONDS,
        limit: int = LINGER_LIMIT,
    ):
        self._release = release
        self.delay = delay
        self.limit = limit
        # Порядок вставки - порядок вытеснения: словарь его хранит сам.
        self._plans: dict[str, asyncio.Task] = {}

    @property
    def symbols(self) -> tuple[str, ...]:
        """Монеты, доживающие свой срок."""
        return tuple(self._plans)

    def waiting(self, symbol: str) -> bool:
        """Монета сейчас доживает свой срок."""
        return symbol in self._plans

    def keep(self, symbol: str) -> bool:
        """На монету снова смотрят. True - она не успела уйти, история цела."""
        task = self._plans.pop(symbol, None)
        if task is None:
            return False
        task.cancel()
        return True

    async def part(self, symbol: str) -> None:
        """Последний смотрящий ушёл: отпустить монету не сейчас, а через срок."""
        if self.delay <= 0 or self.limit <= 0:
            await self._release(symbol)
            return
        self.keep(symbol)
        while len(self._plans) >= self.limit:
            oldest = next(iter(self._plans))
            self._plans.pop(oldest).cancel()
            await self._release(oldest)
        self._plans[symbol] = asyncio.create_task(
            self._wait(symbol), name=f"linger-{symbol}"
        )

    async def _wait(self, symbol: str) -> None:
        try:
            await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            return
        self._plans.pop(symbol, None)
        try:
            await self._release(symbol)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - отпуск монеты не повод ронять сбор
            logger.exception("Не удалось отпустить %s после простоя", symbol)

    async def clear(self) -> None:
        """Отпустить всё сейчас: коллектор останавливается."""
        plans, self._plans = self._plans, {}
        for symbol, task in plans.items():
            task.cancel()
            await self._release(symbol)
