"""Состояние рынка в памяти: по инструменту — стакан, лента и суточная сводка.

Всё, что показывает скринер, считается отсюда, без обращения к бирже. Строка
скринера — чистая функция от состояния: так её поведение проверяется тестами,
а под нагрузкой не появляется скрытых запросов в сеть.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from backend.scalping.book import OrderBook
from backend.scalping.metrics import Wall, book_imbalance, find_walls, spread_bp
from backend.scalping.tape import TapeWindow

# Полоса вокруг цены, в которой считаются метрики стакана, базисные пункты.
# 25 б.п. — это четверть процента: примерно та дистанция, внутри которой живёт
# скальперская сделка. Считать по всей книге нельзя, там метрики размываются.
BAND_BP = 25.0

# Сглаживание перевеса стакана. Мгновенное значение скачет между тиками от 0.51
# до 0.87 (замеры на BTC/XAU) — в колонке это мигало бы без всякого смысла.
# 0.05 при десяти обновлениях в секунду даёт постоянную времени около двух секунд.
RATIO_ALPHA = 0.05


@dataclass
class SymbolState:
    """Живые данные по одному инструменту."""

    symbol: str
    book: OrderBook = field(default=None)  # type: ignore[assignment]
    tape: TapeWindow = field(default_factory=TapeWindow)

    # Суточная сводка приходит по REST и обновляется редко.
    last_price: float = 0.0
    change_pct: float = 0.0
    quote_volume: float = 0.0
    trade_count: int = 0

    # Сглаженный перевес стакана. Обновляется на каждом событии глубины, здесь
    # хранится готовым, чтобы сборка строки оставалась чистой функцией.
    book_ratio: float = 0.5

    def __post_init__(self) -> None:
        if self.book is None:
            self.book = OrderBook(self.symbol)

    @property
    def price(self) -> float:
        """Цена из стакана, пока он жив; иначе последняя суточная."""
        return self.book.mid or self.last_price

    def update_book_ratio(self, band_bp: float = BAND_BP, alpha: float = RATIO_ALPHA) -> float:
        """Досчитать сглаженный перевес по текущему состоянию книги."""
        instant = book_imbalance(
            self.book.levels_in_band("bid", band_bp),
            self.book.levels_in_band("ask", band_bp),
        )
        self.book_ratio = self.book_ratio + alpha * (instant - self.book_ratio)
        return self.book_ratio


@dataclass(frozen=True)
class ScreenerRow:
    """Строка скринера — снимок, отдаваемый наружу."""

    symbol: str
    price: float
    change_pct: float
    volume_24h: float
    spread_bp: float
    book_ratio: float        # перевес стакана 0..1, >0.5 — плотнее покупки
    delta_notional: float    # дельта ленты за минуту, в деньгах
    buy_ratio: float
    trades_per_min: float
    spike: float             # активность против собственной нормы
    range_bp: float          # размах цены за минуту
    wall_notional: float     # крупнейшая заявка рядом с ценой, в деньгах
    wall_side: str           # "bid" | "ask" | ""
    wall_price: float
    wall_distance_bp: float
    live: bool               # стакан собран и синхронизирован


def biggest_wall(state: SymbolState, band_bp: float = BAND_BP) -> Wall | None:
    """Самая крупная плита в полосе вокруг цены — с любой стороны."""
    mid = state.book.mid
    if mid <= 0:
        return None
    walls = find_walls(state.book.levels_in_band("bid", band_bp), "bid", mid) + find_walls(
        state.book.levels_in_band("ask", band_bp), "ask", mid
    )
    return max(walls, key=lambda w: w.notional) if walls else None


def build_row(
    state: SymbolState, now_second: int | None = None, band_bp: float = BAND_BP
) -> ScreenerRow:
    """Собрать строку скринера из текущего состояния инструмента."""
    now_second = int(time.time()) if now_second is None else now_second

    book = state.book
    mid = book.mid
    tape = state.tape.metrics(now_second)
    wall = biggest_wall(state, band_bp)

    return ScreenerRow(
        symbol=state.symbol,
        price=state.price,
        change_pct=state.change_pct,
        volume_24h=state.quote_volume,
        spread_bp=spread_bp(book.best_bid, book.best_ask),
        book_ratio=state.book_ratio,
        delta_notional=tape.delta_notional,
        buy_ratio=tape.buy_ratio,
        trades_per_min=tape.trades_per_min,
        spike=tape.spike,
        range_bp=tape.range_bp,
        wall_notional=wall.notional if wall else 0.0,
        wall_side=wall.side if wall else "",
        wall_price=wall.price if wall else 0.0,
        wall_distance_bp=wall.distance_bp if wall else 0.0,
        live=book.ready and mid > 0,
    )


# Поля, по которым скринер умеет сортировать. Значение — как достать число из
# строки; знак учитывается сортировкой по убыванию модуля там, где важна сила,
# а не направление (дельта одинаково интересна в обе стороны).
SORT_KEYS: dict[str, callable] = {
    "volume": lambda r: r.volume_24h,
    "walls": lambda r: r.wall_notional,
    "spike": lambda r: r.spike,
    "delta": lambda r: abs(r.delta_notional),
    "range": lambda r: r.range_bp,
    "imbalance": lambda r: abs(r.book_ratio - 0.5),
    "spread": lambda r: -r.spread_bp,   # чем спред меньше, тем монета лучше
    "change": lambda r: abs(r.change_pct),
}

DEFAULT_SORT = "volume"


def sort_rows(rows: list[ScreenerRow], sort: str = DEFAULT_SORT) -> list[ScreenerRow]:
    """Отсортировать строки. Неизвестный ключ — сортировка по умолчанию."""
    key = SORT_KEYS.get(sort) or SORT_KEYS[DEFAULT_SORT]
    return sorted(rows, key=key, reverse=True)


class MarketState:
    """Реестр инструментов под наблюдением."""

    def __init__(self) -> None:
        self._symbols: dict[str, SymbolState] = {}

    def __contains__(self, symbol: str) -> bool:
        return symbol.upper() in self._symbols

    @property
    def symbols(self) -> list[str]:
        return list(self._symbols)

    def get(self, symbol: str) -> SymbolState | None:
        return self._symbols.get(symbol.upper())

    def ensure(self, symbol: str) -> SymbolState:
        sym = symbol.upper()
        state = self._symbols.get(sym)
        if state is None:
            state = SymbolState(symbol=sym)
            self._symbols[sym] = state
        return state

    def drop(self, symbol: str) -> None:
        self._symbols.pop(symbol.upper(), None)

    def rows(self, sort: str = DEFAULT_SORT, now_second: int | None = None) -> list[ScreenerRow]:
        now_second = int(time.time()) if now_second is None else now_second
        return sort_rows([build_row(s, now_second) for s in self._symbols.values()], sort)

    def values(self) -> list[SymbolState]:
        return list(self._symbols.values())
