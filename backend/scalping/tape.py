"""Скользящее окно ленты сделок: дельта, всплеск активности, волатильность.

Каждую сделку хранить нельзя: по BTC идёт ~14 сделок в секунду, и на 30 монетах
за 15 минут это сотни тысяч объектов в памяти сервера. Поэтому сделки
складываются в посекундные корзины — на монету выходит 900 маленьких записей,
а все нужные метрики из корзин считаются точно так же.

Волатильность берём отсюда же, а не из свечей: поток klines у биржи на нашем
эндпоинте молчит, а собственный размах цены по ленте не требует ни одного
запроса и обновляется мгновенно.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

# Глубина окна: по нему считается «нормальная» активность монеты, с которой
# сравнивается текущая минута.
WINDOW_SECONDS = 900

# Окно, которое считается «сейчас» — для дельты, частоты сделок и размаха цены.
RECENT_SECONDS = 60


@dataclass
class SecondBucket:
    """Сводка по всем сделкам одной секунды."""

    second: int
    buy_notional: float = 0.0
    sell_notional: float = 0.0
    trades: int = 0
    high: float = 0.0
    low: float = 0.0

    def add(self, price: float, qty: float, is_buy: bool) -> None:
        notional = price * qty
        if is_buy:
            self.buy_notional += notional
        else:
            self.sell_notional += notional
        self.trades += 1
        self.high = price if self.high == 0 else max(self.high, price)
        self.low = price if self.low == 0 else min(self.low, price)


@dataclass(frozen=True)
class TapeMetrics:
    """Что показываем трейдеру по ленте."""

    delta_notional: float   # покупки минус продажи в деньгах за RECENT_SECONDS
    buy_ratio: float        # доля покупок 0..1, 0.5 — равновесие
    trades_per_min: float   # текущая частота сделок
    spike: float            # во сколько раз частота выше обычной для этой монеты
    range_bp: float         # размах цены за окно, базисные пункты
    volume_notional: float  # оборот за RECENT_SECONDS, в деньгах


EMPTY_METRICS = TapeMetrics(0.0, 0.5, 0.0, 1.0, 0.0, 0.0)


@dataclass
class TapeWindow:
    """Посекундные корзины по одной монете с автоочисткой старых секунд.

    Структура намеренно изменяемая: в неё пишет поток биржи несколько раз в
    секунду, и копировать окно на каждую сделку было бы расточительно. Наружу
    отдаются неизменяемые снимки (`TapeMetrics`).
    """

    window_seconds: int = WINDOW_SECONDS
    buckets: deque[SecondBucket] = field(default_factory=deque)

    def add(self, ts_ms: int, price: float, qty: float, is_buy: bool) -> None:
        if price <= 0 or qty <= 0:
            return
        second = ts_ms // 1000
        if self.buckets and self.buckets[-1].second == second:
            bucket = self.buckets[-1]
        elif self.buckets and second < self.buckets[-1].second:
            # Сделка «из прошлого» — биржа изредка отдаёт события не по порядку.
            # Терять её не нужно, но и переупорядочивать окно ради неё дорого:
            # кладём в текущую корзину.
            bucket = self.buckets[-1]
        else:
            bucket = SecondBucket(second)
            self.buckets.append(bucket)
        bucket.add(price, qty, is_buy)
        self._trim(second)

    def _trim(self, now_second: int) -> None:
        edge = now_second - self.window_seconds
        while self.buckets and self.buckets[0].second < edge:
            self.buckets.popleft()

    def metrics(self, now_second: int, recent: int = RECENT_SECONDS) -> TapeMetrics:
        """Снимок метрик на момент `now_second`."""
        if not self.buckets:
            return EMPTY_METRICS

        edge = now_second - recent
        recent_buckets = [b for b in self.buckets if b.second >= edge]
        if not recent_buckets:
            return EMPTY_METRICS

        buy = sum(b.buy_notional for b in recent_buckets)
        sell = sum(b.sell_notional for b in recent_buckets)
        turnover = buy + sell
        trades = sum(b.trades for b in recent_buckets)

        highs = [b.high for b in recent_buckets if b.high > 0]
        lows = [b.low for b in recent_buckets if b.low > 0]
        range_bp = 0.0
        if highs and lows:
            hi, lo = max(highs), min(lows)
            mid = (hi + lo) / 2
            if mid > 0:
                range_bp = (hi - lo) / mid * 10_000

        trades_per_min = trades * 60 / recent if recent else 0.0

        return TapeMetrics(
            delta_notional=buy - sell,
            buy_ratio=buy / turnover if turnover > 0 else 0.5,
            trades_per_min=trades_per_min,
            spike=self._spike(trades_per_min),
            range_bp=range_bp,
            volume_notional=turnover,
        )

    def _spike(self, trades_per_min: float) -> float:
        """Текущая частота против средней по всему окну.

        Пока окно короче двух минут, сравнивать не с чем — отдаём 1.0
        («обычно»), чтобы монета не всплывала в топ скринера только потому,
        что мы недавно на неё подписались.
        """
        span = self.buckets[-1].second - self.buckets[0].second + 1
        if span < 120:
            return 1.0
        baseline = sum(b.trades for b in self.buckets) * 60 / span
        if baseline <= 0:
            return 1.0
        return trades_per_min / baseline
