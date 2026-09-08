"""Профиль объёма внутри одной свечи: где именно её наторговали.

Свеча говорит, куда цена сходила, но молчит о том, чем ход подкреплён. Одна и
та же зелёная минута бывает набрана ровным потоком по всей длине тела, а бывает
одной плитой у самого низа, после которой цену просто вынесли вверх на пустоте.
Различает их только профиль: сколько денег прошло на каждой цене и в какую
сторону били.

Считается это ровно из того же, из чего живут кластеры слева от стакана, —
из ленты сделок. Отличие в окне: у кластеров окно своё, минутное, а здесь оно
равно свече, на которую нажал трейдер.

Источников два, и выбор между ними не про удобство, а про лимит запросов
биржи:

    живая история  — сделки, которые уже прошли через наш поток. Стоит ноль
                     запросов, поэтому текущая свеча обновляется хоть каждую
                     секунду;
    aggTrades      — прошлое, которого в памяти нет. Стоит двадцать единиц веса
                     за страницу, зато закрытая свеча запрашивается один раз:
                     она больше не изменится, и ответ живёт в кэше.

Модуль ничего не запрашивает сам: он только раскладывает сделки по ценам.
Ходит на биржу вызывающий код — так эта, единственная ошибкоопасная часть,
проверяется тестами без сети.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

from backend.scalping.clusters import Column

# Сколько строк отдаём клиенту.
#
# На минутке биткойна проходит под три сотни шагов цены, и все они на экране не
# помещаются физически: строка footprint'а — это строка текста, ей нужно около
# дюжины точек по высоте. Что не влезло, схлопывается в более крупный шаг;
# итоги свечи при этом остаются полными, схлопывание их не трогает.
MAX_LEVELS = 240


@dataclass(frozen=True)
class Level:
    """Объём на одной цене внутри свечи, в деньгах."""

    price: float
    buy: float
    sell: float

    @property
    def total(self) -> float:
        return self.buy + self.sell

    @property
    def delta(self) -> float:
        return self.buy - self.sell


@dataclass(frozen=True)
class Footprint:
    """Разложенная свеча: строки профиля и её итоги."""

    time: int
    seconds: int
    tick: float
    levels: list[Level]
    buy: float
    sell: float
    # Окно разобрано не целиком: сделок оказалось больше, чем мы согласились
    # выкачать. Врать «вот весь объём» в этом случае нельзя, поэтому признак
    # уезжает на экран вместе с числами.
    partial: bool = False

    @property
    def total(self) -> float:
        return self.buy + self.sell

    @property
    def delta(self) -> float:
        return self.buy - self.sell


def decimals(step: float) -> int:
    """Знаков после запятой у шага — чтобы цены строк ложились на сетку ровно.

    Без округления цена 100.1 + 0.2 даёт 100.30000000000001, и две сделки на
    одной цене оказываются в разных строках.
    """
    if step <= 0:
        return 8
    return len(f"{step:.10f}".rstrip("0").partition(".")[2])


def _bucket(price: float, step: float) -> int:
    """Номер корзины, в которую попадает цена.

    Деление дробных чисел не бывает точным: 129.9 / 0.3 даёт 432.9999999, и
    цена, стоящая ровно на границе, оказывается корзиной ниже. Округление до
    шестого знака ставит её на место — и делает это одинаково там, где корзины
    считаются, и там, где они только пересчитываются в число строк.
    """
    return math.floor(round(price / step, 6))


def guess_tick(prices: Sequence[float]) -> float:
    """Шаг биржи по самим сделкам, когда книги под рукой нет.

    Книга есть только у монет под наблюдением, а профиль спрашивают и по тем,
    что открыли минуту назад. Наименьший зазор между ценами сделок — тот же
    шаг: за минуту цена проходит десятки шагов и хотя бы раз встаёт на соседний.

    Разность дробных чисел точной не бывает (79591.8 − 79591.7 даёт
    0.09999999999417923), поэтому зазор приводится к чистому шагу — как это
    делает `detect_tick` для стакана.
    """
    ordered = sorted({p for p in prices if p > 0})
    gaps = [b - a for a, b in zip(ordered, ordered[1:]) if b > a]
    if not gaps:
        return 0.0
    return float(f"{min(gaps):.6g}")


def collect(
    trades: Iterable[tuple[float, float, bool]], tick: float
) -> dict[float, list[float]]:
    """Разложить сделки по ценам: цена → [покупки, продажи].

    Объём считаем в деньгах, как и везде в разделе: сравнивать строки в монете
    можно только внутри одного инструмента, а трейдер держит на экране разные.

    `is_buy` — бил ли по рынку покупатель. Это не сторона сделки (их всегда
    две), а сторона агрессора: именно она двигает цену.
    """
    cells: dict[float, list[float]] = {}
    if tick <= 0:
        return cells
    digits = decimals(tick)
    for price, qty, is_buy in trades:
        if price <= 0 or qty <= 0:
            continue
        level = round(round(price / tick) * tick, digits)
        cell = cells.get(level)
        if cell is None:
            cell = [0.0, 0.0]
            cells[level] = cell
        cell[0 if is_buy else 1] += price * qty
    return cells


def from_columns(columns: list[Column], start: int, end: int) -> dict[float, list[float]]:
    """Сложить готовые кластеры за окно свечи.

    Колонки истории минутные, границы свечей выровнены по эпохе, поэтому минута
    целиком лежит либо внутри свечи, либо снаружи — делить колонку не приходится.
    """
    cells: dict[float, list[float]] = {}
    for column in columns:
        if not (start <= column.start < end):
            continue
        for price, cell in column.cells.items():
            acc = cells.get(price)
            if acc is None:
                acc = [0.0, 0.0]
                cells[price] = acc
            acc[0] += cell.buy
            acc[1] += cell.sell
    return cells


def fit_levels(
    cells: dict[float, list[float]], tick: float, max_levels: int = MAX_LEVELS
) -> tuple[float, list[Level]]:
    """Уложить профиль в потолок строк, укрупняя шаг цены.

    Шаг растёт целым числом биржевых шагов: половина шага биржи ценой не бывает,
    и строки на дробном укрупнении вставали бы между реальными ценами.

    Строки идут от старшей цены к младшей — тем же порядком, что и стакан.
    """
    if not cells or tick <= 0:
        return tick, []

    prices = sorted(cells)
    span = round((prices[-1] - prices[0]) / tick) + 1
    factor = max(1, math.ceil(span / max(1, max_levels)))
    # Корзины стоят на круглых ценах, а не от нижней строки профиля: одна и та
    # же цена обязана попадать в одну строку у соседних свечей. Из-за этого
    # крайние корзины бывают неполными, и расчётного укрупнения на один шаг не
    # хватает — доводим его по факту.
    while factor < span:
        step = tick * factor
        if _bucket(prices[-1], step) - _bucket(prices[0], step) + 1 <= max_levels:
            break
        factor += 1

    step = round(tick * factor, decimals(tick))
    digits = decimals(step)

    merged: dict[float, list[float]] = {}
    for price, (buy, sell) in cells.items():
        # Вниз, а не к ближайшей: корзина обязана быть непрерывной, иначе
        # соседние строки перекрываются и один и тот же объём виден дважды.
        level = round(_bucket(price, step) * step, digits)
        acc = merged.get(level)
        if acc is None:
            acc = [0.0, 0.0]
            merged[level] = acc
        acc[0] += buy
        acc[1] += sell

    levels = [
        Level(price=price, buy=buy, sell=sell)
        for price, (buy, sell) in sorted(merged.items(), reverse=True)
    ]
    return step, levels


def build(
    cells: dict[float, list[float]],
    *,
    time: int,
    seconds: int,
    tick: float,
    partial: bool = False,
    max_levels: int = MAX_LEVELS,
) -> Footprint:
    """Собрать готовый профиль свечи вместе с её итогами.

    Итоги считаем по исходным ячейкам, до укрупнения: схлопывание строк — дело
    экрана, а оборот свечи от него зависеть не может.
    """
    buy = sum(cell[0] for cell in cells.values())
    sell = sum(cell[1] for cell in cells.values())
    step, levels = fit_levels(cells, tick, max_levels)
    return Footprint(
        time=time,
        seconds=seconds,
        tick=step,
        levels=levels,
        buy=buy,
        sell=sell,
        partial=partial,
    )
