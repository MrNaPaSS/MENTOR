"""Канал скринера и стакана: рассылка по подписке.

Общий `ConnectionManager` шлёт событие всем подключённым — для сигналов и цен
это правильно. Здесь так нельзя: стакан обновляется десять раз в секунду, и
рассылать чужой инструмент каждому клиенту значит гонять мегабайты впустую.
Поэтому клиент явно говорит, какой стакан открыт, и получает только его.

Кадры собираются по таймеру, а не на каждое событие биржи: поток даёт до десяти
обновлений в секунду на инструмент, и слать их поштучно бессмысленно — глаз
столько не различает, а трафик и разбор JSON растут линейно.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict

from backend.scalping.collector import ScalpingCollector
from backend.scalping.ladder import DEFAULT_ROWS, build_ladder
from backend.scalping.state import DEFAULT_SORT, biggest_wall

logger = logging.getLogger("nmnh.scalping.ws")

# Частоты отправки кадров. Стакан — плотно, список — заметно реже: он меняется
# медленнее, а строк в нём десятки.
DOM_FPS = 8.0
SCREENER_INTERVAL = 1.0

SCREENER_LIMIT = 50


class Subscription:
    """Что именно смотрит один клиент."""

    def __init__(self) -> None:
        self.symbol: str | None = None
        self.rows: int = DEFAULT_ROWS
        self.agg: int = 1
        self.sort: str = DEFAULT_SORT
        self.screener: bool = True


class ScalpingHub:
    """Держит подписки клиентов и рассылает им кадры."""

    def __init__(self, collector: ScalpingCollector):
        self.collector = collector
        self._subs: dict[object, Subscription] = {}
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    @property
    def clients(self) -> int:
        return len(self._subs)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="scalping-hub")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    # ── подписки ────────────────────────────────────────────────────────────

    async def connect(self, ws) -> None:
        async with self._lock:
            self._subs[ws] = Subscription()
        self.start()

    async def disconnect(self, ws) -> None:
        async with self._lock:
            sub = self._subs.pop(ws, None)
        if sub and sub.symbol:
            await self.collector.unpin(sub.symbol)

    async def set_symbol(self, ws, symbol: str | None, rows: int, agg: int) -> None:
        """Переключить клиента на другой стакан.

        Прошлый инструмент отпускаем, новый удерживаем: пока хоть один клиент
        на него смотрит, сборщик не выбросит его из наблюдения.
        """
        async with self._lock:
            sub = self._subs.get(ws)
        if sub is None:
            return

        old, new = sub.symbol, symbol.upper() if symbol else None
        sub.rows, sub.agg = rows, agg
        if old == new:
            return

        sub.symbol = new
        if new:
            await self.collector.pin(new)
        if old:
            await self.collector.unpin(old)

    async def set_sort(self, ws, sort: str) -> None:
        async with self._lock:
            sub = self._subs.get(ws)
        if sub:
            sub.sort = sort

    # ── рассылка ────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        """Один цикл на всех: кадр стакана часто, список — раз в секунду."""
        tick = 1.0 / DOM_FPS
        since_screener = 0.0
        while True:
            try:
                await asyncio.sleep(tick)
                since_screener += tick
                send_screener = since_screener >= SCREENER_INTERVAL
                if send_screener:
                    since_screener = 0.0
                await self._broadcast(send_screener)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Сбой рассылки скальпинга: %s", exc)

    async def _broadcast(self, with_screener: bool) -> None:
        async with self._lock:
            targets = list(self._subs.items())
        if not targets:
            return

        # Список одинаков для всех с одной сортировкой — считаем по разу.
        screener_cache: dict[str, dict] = {}
        dead: list[object] = []

        for ws, sub in targets:
            try:
                if with_screener and sub.screener:
                    frame = screener_cache.get(sub.sort)
                    if frame is None:
                        frame = self._screener_frame(sub.sort)
                        screener_cache[sub.sort] = frame
                    await ws.send_json({"event": "screener", "payload": frame})
                if sub.symbol:
                    dom = self._dom_frame(sub)
                    if dom:
                        await ws.send_json({"event": "dom", "payload": dom})
            except Exception:  # noqa: BLE001 — соединение закрыто или битое
                dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

    def _screener_frame(self, sort: str) -> dict:
        rows = self.collector.state.rows(sort=sort)[:SCREENER_LIMIT]
        return {"sort": sort, "rows": [asdict(r) for r in rows]}

    def _dom_frame(self, sub: Subscription) -> dict | None:
        state = self.collector.state.get(sub.symbol or "")
        if state is None or not state.book.ready:
            return None
        ladder, step = build_ladder(state.book, rows=sub.rows, agg=sub.agg)
        wall = biggest_wall(state)
        return {
            "symbol": state.symbol,
            "tick": step,
            "best_bid": state.book.best_bid,
            "best_ask": state.book.best_ask,
            "mid": state.book.mid,
            "book_ratio": state.book_ratio,
            "rows": [asdict(r) for r in ladder],
            "wall": asdict(wall) if wall else None,
        }
