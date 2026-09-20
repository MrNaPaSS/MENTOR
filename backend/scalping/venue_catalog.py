"""Состав бирж, у которых нет своего сборщика книги.

Скринер один на всех и идёт с Binance. Монеты, которых на бирже ученика нет,
помечаются в нём чужими - стакан по ним общий, а сделку не поставить. Состав
для этой пометки берётся у сборщика биржи: он и так держит справочник
инструментов, чтобы читать книгу.

У WEEX сборщика нет - её поток мы не собираем, - и состав спросить было не у
кого. Поэтому на WEEX не помечалось ничего, и ученик выбирал монету, которую
биржа торговать через ключи не даёт. Отказ приходил после нажатия «Войти»:
«The trading pair is not supported via the API».

Разрыв здесь не в пару монет. На 19 сентября 2026 в справочнике WEEX 995 пар,
а через API торгуются 290 - три четверти списка биржа по ключам не примет.

Каталог закрывает эту дыру одним запросом к открытой ручке биржи. Он живёт
отдельно от сборщиков намеренно: поднимать поток биржи ради списка имён
слишком дорого, а список меняется раз в недели.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable

logger = logging.getLogger("nmnh.scalping.catalog")

# Как часто перечитывать состав. Пары добавляют и убирают редко, а список
# открытый и дешёвый: раз в шесть часов - это и не устаревшая правда, и не
# лишний стук в биржу.
REFRESH_EVERY_S = 6 * 3600

# Сколько ждать перед повтором, если биржа не ответила. Пустой каталог ничего
# не ломает - он просто не помечает монеты, - поэтому спешить некуда.
RETRY_AFTER_S = 300

# Откуда брать состав биржи. Возвращает имена пар или `None`, если не вышло.
Source = Callable[[], Awaitable[frozenset[str] | None]]


class VenueCatalog:
    """Списки торгуемых пар по биржам, в памяти.

    Спрашивают его на каждой рассылке скринера, поэтому `symbols` в сеть не
    ходит вовсе: он отдаёт то, что уже лежит. Обновлением занят отдельный круг.
    """

    def __init__(self, sources: dict[str, Source], every: float = REFRESH_EVERY_S):
        self._sources = dict(sources)
        self._every = every
        self._known: dict[str, frozenset[str]] = {}
        self._asked_at: dict[str, float] = {}
        self._task: asyncio.Task | None = None

    @property
    def venues(self) -> tuple[str, ...]:
        return tuple(sorted(self._sources))

    def symbols(self, exchange: str | None) -> frozenset[str] | None:
        """Пары биржи, какие знаем. `None` - ещё не знаем.

        Разница между `None` и пустым множеством здесь та же, что и у
        сборщиков: «не спросили» нельзя показывать как «биржа ничего не
        торгует», иначе ученик увидит весь скринер помеченным чужим.
        """
        code = (exchange or "").strip().lower()
        return self._known.get(code)

    async def refresh(self, exchange: str) -> frozenset[str] | None:
        """Перечитать состав одной биржи. Не ответила - оставляем прежнее."""
        code = (exchange or "").strip().lower()
        source = self._sources.get(code)
        if source is None:
            return None

        self._asked_at[code] = time.monotonic()
        try:
            names = await source()
        except Exception as exc:  # биржа, сеть, неожиданный формат
            logger.warning("Состав %s не получен: %s", code, exc)
            return self._known.get(code)

        if not names:
            # Пустой ответ не затирает прежний список: биржа могла моргнуть, а
            # мы бы на этом пометили чужими все монеты разом.
            return self._known.get(code)

        was = self._known.get(code)
        self._known[code] = names
        if was is None:
            logger.info("Состав %s: %s пар торгуются через API", code, len(names))
        elif was != names:
            logger.info(
                "Состав %s изменился: было %s пар, стало %s", code, len(was), len(names)
            )
        return names

    async def _loop(self) -> None:
        while True:
            soonest = self._every
            for code in self._sources:
                got = await self.refresh(code)
                if got is None:
                    soonest = min(soonest, RETRY_AFTER_S)
            await asyncio.sleep(soonest)

    def start(self) -> None:
        """Завести круг обновления. Первый проход идёт сразу."""
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
