"""Лестница стакана: то, что видно на экране трейдера.

Книга заявок хранится по ценам биржи, а показывать её нужно ровной ценовой
шкалой с одинаковым шагом — иначе строки «пляшут» при каждом изменении и глазу
не за что зацепиться. Здесь уровни раскладываются по корзинам выбранного шага
и склеиваются в один список сверху вниз, как в терминале: аски выше, биды ниже.

Шаг по умолчанию берём у самой биржи — минимальный зазор между соседними
ценами. Укрупнение задаётся множителем: на BTC шаг в десять центов даёт стакан
шириной в три доллара, и трейдеру обычно нужнее шаг покрупнее.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from backend.scalping.book import OrderBook
from backend.scalping.metrics import Level, Wall, find_walls
from backend.scalping.state import BAND_BP

# Сколько ценовых строк показываем с каждой стороны по умолчанию.
DEFAULT_ROWS = 40

# Максимум строк на сторону: выше начинается не стакан, а таблица.
MAX_ROWS = 200


@dataclass(frozen=True)
class LadderRow:
    """Одна строка лестницы. На каждой цене живёт только одна сторона."""

    price: float
    bid: float          # объём в монете
    ask: float
    notional: float     # объём этой строки в деньгах
    is_wall: bool
    cum: float          # накопленный объём в деньгах от лучшей цены


def detect_tick(book: OrderBook, sample: int = 40) -> float:
    """Шаг ценовой сетки биржи — минимальный зазор между соседними ценами.

    Считаем по уровням рядом с ценой: в глубине книги встречаются разрывы, и по
    ним шаг определился бы неверно.

    Разность двух дробных чисел точной не бывает: 79591.8 - 79591.7 даёт
    0.09999999999417923. Если оставить так, вся ценовая шкала поедет — цены в
    стакане превращаются в 79603.2999928357. Поэтому зазор приводится к чистому
    шагу: биржевые шаги — это единицы и пятёрки в каком-то разряде, шести
    значащих цифр на них хватает с запасом.
    """
    prices = sorted(
        {l.price for l in book.levels("bid", sample)}
        | {l.price for l in book.levels("ask", sample)}
    )
    gaps = [b - a for a, b in zip(prices, prices[1:]) if b > a]
    if not gaps:
        return 0.0
    return float(f"{min(gaps):.6g}")


def tick_decimals(tick: float) -> int:
    """Сколько знаков после запятой у шага — по ним округляются цены сетки."""
    if tick <= 0:
        return 8
    text = f"{tick:.10f}".rstrip("0")
    return len(text.partition(".")[2])


def snap(price: float, tick: float, side: str) -> float:
    """Положить цену на сетку шага. Бид вниз, аск вверх."""
    if tick <= 0:
        return price
    steps = price / tick
    k = math.floor(steps + 1e-9) if side == "bid" else math.ceil(steps - 1e-9)
    return round(k * tick, tick_decimals(tick))


def group(levels: list[Level], tick: float, side: str, rows: int) -> list[tuple[float, float]]:
    """Схлопнуть уровни в корзины шагом `tick`, от лучшей цены вглубь.

    Биды округляем вниз, аски вверх — корзина всегда «в пользу» стоящего в
    стакане, и лучшая цена не заезжает внутрь спреда.
    """
    if tick <= 0:
        return [(l.price, l.size) for l in levels[:rows]]

    buckets: dict[float, float] = {}
    for level in levels:
        price = snap(level.price, tick, side)
        buckets[price] = buckets.get(price, 0.0) + level.size

    ordered = sorted(buckets.items(), key=lambda kv: kv[0], reverse=(side == "bid"))
    return ordered[:rows]


def build_ladder(
    book: OrderBook,
    rows: int = DEFAULT_ROWS,
    tick: float | None = None,
    agg: int = 1,
) -> tuple[list[LadderRow], float]:
    """Собрать лестницу стакана. Возвращает строки сверху вниз и её шаг."""
    rows = max(1, min(rows, MAX_ROWS))
    if tick and tick > 0:
        step = tick
    else:
        # Умножение тоже округляем: 0.1 * 3 в двоичной арифметике даёт
        # 0.30000000000000004, и сетка снова поехала бы.
        base = detect_tick(book)
        step = float(f"{base * max(1, agg):.6g}") if base > 0 else 0.0

    bids = group(book.levels("bid"), step, "bid", rows)
    asks = group(book.levels("ask"), step, "ask", rows)

    wall_prices = _wall_prices(book, step)

    # Накопленный объём считается от лучшей цены вглубь, а показывается стакан
    # сверху вниз — поэтому аски считаем по порядку и переворачиваем.
    out: list[LadderRow] = []
    ask_rows: list[LadderRow] = []
    cum = 0.0
    for price, size in asks:
        cum += price * size
        ask_rows.append(LadderRow(price, 0.0, size, price * size, price in wall_prices, cum))
    out.extend(reversed(ask_rows))

    cum = 0.0
    for price, size in bids:
        cum += price * size
        out.append(LadderRow(price, size, 0.0, price * size, price in wall_prices, cum))
    return out, step


def _wall_prices(book: OrderBook, step: float) -> set[float]:
    """Цены плит, приведённые к шагу лестницы.

    Плиты ищем в той же полосе вокруг цены, что и метрики скринера. Иначе
    подсветка означала бы одно в списке и другое в стакане: заголовок сообщал
    бы про заявку на десять миллионов, а золотом горели бы соседние сто тысяч.

    Ищем по исходным уровням, а не по корзинам: укрупнение сетки размазывает
    крупную заявку по соседям и прячет её.
    """
    mid = book.mid
    if mid <= 0:
        return set()
    walls: list[Wall] = find_walls(
        book.levels_in_band("bid", BAND_BP), "bid", mid
    ) + find_walls(book.levels_in_band("ask", BAND_BP), "ask", mid)
    return {snap(w.price, step, w.side) for w in walls}
