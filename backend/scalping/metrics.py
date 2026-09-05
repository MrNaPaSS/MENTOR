"""Метрики скальперского стакана: плиты, перевес, давление ленты, волатильность.

Модуль намеренно без сети и без состояния приложения — только чистые функции над
уже собранными уровнями. Так их можно считать и проверять тестами без биржи.

Термины (как их называет трейдер, а не биржа):
    плита      — заявка, объём которой резко выше соседей по своей стороне;
    перевес    — какая сторона стакана плотнее;
    дельта     — сколько прошло по рынку в покупку минус в продажу;
    всплеск    — текущая частота сделок против собственной средней.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median

# Плитой считаем уровень, чей объём в деньгах кратно выше медианы по стороне.
# Медиана, а не среднее: одна огромная заявка утягивает среднее вверх и прячет
# сама себя — по медиане она видна.
WALL_FACTOR = 6.0

# Лучшую заявку в расчёт не берём. На инструментах с мелким шагом цены она
# структурно крупнее остальных в сотню раз (замеры: BTC ×158, ETH ×60), то есть
# помечалась бы плитой всегда и никакого сигнала не несла. Плита — то, что
# стоит в стороне и до чего цена может дойти.
SKIP_BEST_LEVELS = 1

# Ниже этой суммы уровень не плита, даже если соседи совсем пустые. Отсекает
# «плиты» на неликвиде, где медиана уровня — пара долларов.
WALL_MIN_NOTIONAL = 50_000.0


@dataclass(frozen=True)
class Level:
    """Уровень стакана: цена, объём в монете и он же в деньгах."""

    price: float
    size: float

    @property
    def notional(self) -> float:
        return self.price * self.size


@dataclass(frozen=True)
class Wall:
    """Найденная плита и её положение относительно текущей цены."""

    price: float
    size: float
    notional: float
    side: str          # "bid" | "ask"
    distance_bp: float  # удаление от цены в базисных пунктах
    ratio: float        # во сколько раз крупнее медианы по своей стороне


def find_walls(
    levels: list[Level],
    side: str,
    mid: float,
    factor: float = WALL_FACTOR,
    min_notional: float = WALL_MIN_NOTIONAL,
    skip_best: int = SKIP_BEST_LEVELS,
) -> list[Wall]:
    """Плиты на одной стороне стакана, от самой крупной к мелкой.

    `levels` ожидаются от лучшей цены вглубь и уже ограниченными полосой вокруг
    цены — считать по всей книге нельзя, там медиана уходит в ноль.

    Сравниваем в деньгах, а не в монете: 10 BTC и 10 DOGE — величины разного
    порядка, а трейдеру важно, сколько денег стоит в уровне.
    """
    if mid <= 0:
        return []
    candidates = levels[skip_best:]
    if len(candidates) < 4:
        return []

    base = median([l.notional for l in candidates])
    if base <= 0:
        return []

    walls = [
        Wall(
            price=l.price,
            size=l.size,
            notional=l.notional,
            side=side,
            distance_bp=abs(l.price - mid) / mid * 10_000,
            ratio=l.notional / base,
        )
        for l in candidates
        if l.notional >= base * factor and l.notional >= min_notional
    ]
    return sorted(walls, key=lambda w: w.notional, reverse=True)


def book_imbalance(bids: list[Level], asks: list[Level]) -> float:
    """Перевес стакана в долях 0..1: >0.5 — плотнее заявки на покупку.

    Считаем в деньгах и по всей переданной глубине. Значение 0.5 отдаём и когда
    стакан пуст — «нейтрально» честнее, чем ноль, который читается как перекос.
    """
    bid_sum = sum(l.notional for l in bids)
    ask_sum = sum(l.notional for l in asks)
    total = bid_sum + ask_sum
    if total <= 0:
        return 0.5
    return bid_sum / total


def spread_bp(best_bid: float, best_ask: float) -> float:
    """Спред в базисных пунктах — во сколько обойдётся вход по рынку."""
    if best_bid <= 0 or best_ask <= 0:
        return 0.0
    mid = (best_bid + best_ask) / 2
    if mid <= 0:
        return 0.0
    return (best_ask - best_bid) / mid * 10_000
