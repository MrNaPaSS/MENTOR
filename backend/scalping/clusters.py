"""История прошедших объёмов: сколько наторговано на каждой цене за интервал.

Это левая половина экрана DOM Trader. Стакан показывает намерения — заявки,
которые стоят прямо сейчас и могут быть сняты. Кластеры показывают факт: где
сделки действительно прошли и в какую сторону. Трейдер смотрит на них вместе:
плита в стакане ценна ровно настолько, насколько цена уже отбивалась от этого
уровня раньше.

Храним двумерно — цена на шаге биржи против временного интервала. Объём каждой
сделки раскладывается в свою ячейку отдельно по покупкам и продажам: в
референсе это две подколонки внутри одного интервала.

Копим всегда на базовом шаге биржи, а под экран схлопываем при отдаче. Иначе
пришлось бы обнулять историю каждый раз, когда трейдер меняет укрупнение, да и
двое клиентов с разным шагом на одной монете не ужились бы.

История ведётся только для открытой монеты. По всем тридцати инструментам
скринера это были бы сотни тысяч ячеек ради данных, которых никто не видит.
"""

from __future__ import annotations

import bisect
from collections import OrderedDict
from dataclasses import dataclass, field

# Ширина одной колонки истории и сколько их держим: минута на пятнадцати
# колонках — четверть часа назад, столько же, сколько помнит лента.
#
# В терминале-референсе колонки пятиминутные, но там сессия идёт часами. У нас
# история начинает копиться в момент открытия монеты, и с пятиминутным шагом
# правая колонка почти всегда пустая — трейдер ждёт минуты, прежде чем увидит
# хоть что-то. Минутные колонки наполняются сразу, а для скальпинга ближняя
# история и важнее дальней.
DEFAULT_BUCKET_SECONDS = 60
DEFAULT_COLUMNS = 15


@dataclass(frozen=True)
class Cell:
    """Объём на одной цене внутри одного интервала."""

    buy: float
    sell: float

    @property
    def total(self) -> float:
        return self.buy + self.sell


@dataclass(frozen=True)
class Column:
    """Один временной интервал: с какой секунды начался и что в нём наторговали."""

    start: int
    cells: dict[float, Cell]
    buy: float
    sell: float

    @property
    def total(self) -> float:
        return self.buy + self.sell


@dataclass
class ClusterHistory:
    """Кластеры одного инструмента.

    Структура изменяемая: в неё пишет поток сделок несколько раз в секунду.
    Наружу отдаются неизменяемые срезы (`Column`).
    """

    tick: float
    bucket_seconds: int = DEFAULT_BUCKET_SECONDS
    columns: int = DEFAULT_COLUMNS
    # Интервал → цена → [покупки, продажи]. OrderedDict, чтобы выбрасывать
    # самый старый интервал за одну операцию.
    _data: OrderedDict[int, dict[float, list[float]]] = field(default_factory=OrderedDict)

    def ensure_tick(self, tick: float) -> None:
        """Задать шаг, если он ещё не известен.

        В момент открытия монеты книга может быть не собрана, и шаг тогда
        неизвестен. Раньше он так и оставался нулевым, а история молча не
        копилась вовсе — снаружи это выглядело как пустые колонки.
        """
        if self.tick <= 0 and tick > 0:
            self.tick = tick

    def add(self, ts_ms: int, price: float, qty: float, is_buy: bool) -> None:
        """Разложить сделку в ячейку. Объём считаем в деньгах, как и везде."""
        if price <= 0 or qty <= 0 or self.tick <= 0:
            return

        start = (ts_ms // 1000) // self.bucket_seconds * self.bucket_seconds
        column = self._data.get(start)
        if column is None:
            # Сделка из интервала, который уже вытеснен из истории.
            if self._data and start < next(iter(self._data)):
                return
            column = {}
            self._data[start] = column
            self._trim()

        level = round(price / self.tick) * self.tick
        level = round(level, _decimals(self.tick))
        cell = column.get(level)
        if cell is None:
            cell = [0.0, 0.0]
            column[level] = cell
        cell[0 if is_buy else 1] += price * qty

    def _trim(self) -> None:
        """Оставить только последние `columns` интервалов."""
        while len(self._data) > self.columns:
            self._data.popitem(last=False)

    def snapshot(self) -> list[Column]:
        """Срез истории от старой колонки к свежей, на базовом шаге."""
        out: list[Column] = []
        for start, column in self._data.items():
            cells = {price: Cell(buy=b, sell=s) for price, (b, s) in column.items()}
            buy = sum(c.buy for c in cells.values())
            sell = sum(c.sell for c in cells.values())
            out.append(Column(start=start, cells=cells, buy=buy, sell=sell))
        return out


def fit_to_rows(columns: list[Column], row_prices: list[float], step: float) -> list[Column]:
    """Схлопнуть кластеры под строки экрана.

    Строки лестницы стоят на своём шаге, а биды и аски округляются в разные
    стороны — поэтому цену сделки не пересчитываем формулой, а привязываем к
    ближайшей строке. Всё, что дальше половины шага от крайних строк, на экран
    не попадает, но в итоги интервала входит: трейдер должен видеть полный
    оборот, а не только его видимую часть.
    """
    if not row_prices or step <= 0:
        return [Column(start=c.start, cells={}, buy=c.buy, sell=c.sell) for c in columns]

    ordered = sorted(row_prices)
    half = step / 2
    out: list[Column] = []
    for column in columns:
        cells: dict[float, list[float]] = {}
        for price, cell in column.cells.items():
            row = _nearest(ordered, price)
            if row is None or abs(row - price) > half:
                continue
            acc = cells.setdefault(row, [0.0, 0.0])
            acc[0] += cell.buy
            acc[1] += cell.sell
        out.append(
            Column(
                start=column.start,
                cells={p: Cell(buy=b, sell=s) for p, (b, s) in cells.items()},
                buy=column.buy,
                sell=column.sell,
            )
        )
    return out


def _nearest(ordered: list[float], price: float) -> float | None:
    """Ближайшая строка к цене. Список должен быть отсортирован по возрастанию."""
    i = bisect.bisect_left(ordered, price)
    if i == 0:
        return ordered[0]
    if i >= len(ordered):
        return ordered[-1]
    before, after = ordered[i - 1], ordered[i]
    return before if price - before <= after - price else after


def _decimals(tick: float) -> int:
    """Знаков после запятой у шага — чтобы цены ячеек ложились на сетку ровно."""
    if tick <= 0:
        return 8
    return len(f"{tick:.10f}".rstrip("0").partition(".")[2])
