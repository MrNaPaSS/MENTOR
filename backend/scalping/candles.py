"""Живая свеча из ленты сделок.

График подтягивал свечи опросом раз в пять секунд, и текущая свеча отставала
от биржи ровно на это время. Между тем лента сделок у нас уже идёт — из неё
свеча собирается сама, тик в тик.

Храним посекундные сводки, а не готовые свечи выбранного таймфрейма: трейдер
переключает минуту на пять минут и обратно, и пересобирать историю на каждое
переключение дороже, чем сложить секунды при отдаче. Час секунд на инструмент —
это тысячи чисел, то есть ничто.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Second:
    """Одна секунда торгов."""

    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


# Сколько секунд помним. Часа хватает на любой таймфрейм, который скальпер
# держит открытым; всё, что крупнее, приходит историей по REST.
HISTORY_SECONDS = 3600


class LiveCandles:
    """Посекундная история сделок одного инструмента."""

    def __init__(self, history: int = HISTORY_SECONDS):
        self.history = history
        self._seconds: dict[int, Second] = {}

    def add(self, ts_ms: int, price: float, qty: float) -> None:
        if not (price > 0) or qty < 0:
            return
        second = ts_ms // 1000
        bucket = self._seconds.get(second)
        if bucket is None:
            self._seconds[second] = Second(price, price, price, price, qty)
        else:
            bucket.high = max(bucket.high, price)
            bucket.low = min(bucket.low, price)
            bucket.close = price
            bucket.volume += qty

        # Чистим редко и сразу помногу: удалять по одной секунде на каждую
        # сделку — это тысячи проверок в секунду на активной монете.
        if len(self._seconds) > self.history * 2:
            edge = second - self.history
            for key in [k for k in self._seconds if k < edge]:
                del self._seconds[key]

    def current(self, interval_seconds: int, now_ms: int) -> Candle | None:
        """Текущая свеча выбранного таймфрейма.

        Границы интервалов у биржи выровнены по началу эпохи, поэтому начало
        свечи — это просто остаток от деления. `None`, если за эту свечу ещё не
        было ни одной сделки: рисовать пустую нечестно.
        """
        if interval_seconds <= 0:
            return None
        now = now_ms // 1000
        start = now - now % interval_seconds

        opened = None
        high = float("-inf")
        low = float("inf")
        close = 0.0
        volume = 0.0

        for second in range(start, now + 1):
            bucket = self._seconds.get(second)
            if bucket is None:
                continue
            if opened is None:
                opened = bucket.open
            high = max(high, bucket.high)
            low = min(low, bucket.low)
            close = bucket.close
            volume += bucket.volume

        if opened is None:
            return None
        return Candle(start, opened, high, low, close, volume)
