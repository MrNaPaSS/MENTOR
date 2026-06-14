"""Серверный сборщик цен (решение A-12).

Один процесс следит за ценами символов активных сигналов и раздаёт обновления клиентам через
WebSocket (``price_update``). Клиенты не ходят на биржу напрямую — это исключает упор в лимиты WEEX.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from core.db import SessionLocal
from core.models import Signal
from core.weex.base import WeexClient
from backend.ws.manager import ConnectionManager

logger = logging.getLogger("nmnh.prices")


def active_symbols() -> list[str]:
    """Уникальные символы активных сигналов."""
    with SessionLocal() as session:
        rows = session.execute(
            select(Signal.symbol).where(Signal.status == "active").distinct()
        ).scalars().all()
    return list(rows)


async def collect_once(weex: WeexClient, manager: ConnectionManager) -> int:
    """Один цикл: получить цены активных символов и разослать. Возвращает число символов."""
    symbols = active_symbols()
    for symbol in symbols:
        try:
            price = await weex.get_price(symbol)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Не удалось получить цену %s: %s", symbol, exc)
            continue
        await manager.broadcast("price_update", {"symbol": symbol, "price": str(price)})
    return len(symbols)


class PriceCollector:
    """Фоновый цикл сбора цен."""

    def __init__(self, weex: WeexClient, manager: ConnectionManager, interval: float = 5.0):
        self.weex = weex
        self.manager = manager
        self.interval = interval
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        while True:
            try:
                await collect_once(self.weex, self.manager)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Сбой цикла сбора цен: %s", exc)
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
