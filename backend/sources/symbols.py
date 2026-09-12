"""Соответствие пар между биржами (ТЗ этап 2, §5.3).

Пары совпадают не всегда: `MATICUSDT` на Binance давно `POLUSDT`, часть мелких
монет торгуется с множителем (`1000PEPEUSDT`). Поэтому карта явная, а правило
жёсткое: **пары нет в карте и она не совпадает буквально - фолбэка для неё
нет**.

Угадывать имя пары нельзя. Неверно угаданная пара даёт не ошибку, а чужую
цену: ученик увидит число, поверит ему и посчитает по нему позицию.

«Совпадает буквально» проверяется по живому списку пар второй биржи, а не по
нашему представлению о нём: список меняется без предупреждения, а захардкоженный
перечень устаревает молча.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Collection


@dataclass(frozen=True)
class Mapped:
    """Пара на второй бирже и во сколько раз её цена крупнее нашей."""

    symbol: str
    # 1000PEPEUSDT котируется за тысячу монет. Без деления график прыгнул бы
    # в тысячу раз, и это выглядело бы как движение рынка, а не как ошибка.
    divisor: float = 1.0


SYMBOL_MAP: dict[str, Mapped] = {
    # Переименования.
    "MATICUSDT": Mapped("POLUSDT"),
    # Множители: у нас пара за монету, у них за тысячу.
    "PEPEUSDT": Mapped("1000PEPEUSDT", divisor=1000),
    "SHIBUSDT": Mapped("1000SHIBUSDT", divisor=1000),
    "BONKUSDT": Mapped("1000BONKUSDT", divisor=1000),
    "FLOKIUSDT": Mapped("1000FLOKIUSDT", divisor=1000),
    "LUNCUSDT": Mapped("1000LUNCUSDT", divisor=1000),
    "XECUSDT": Mapped("1000XECUSDT", divisor=1000),
    "SATSUSDT": Mapped("1000SATSUSDT", divisor=1000),
    "RATSUSDT": Mapped("1000RATSUSDT", divisor=1000),
    "CATUSDT": Mapped("1000CATUSDT", divisor=1000),
}


def to_binance(symbol: str, known: Collection[str] | None = None) -> Mapped | None:
    """Пара на Binance или `None` - фолбэка для неё нет.

    `known` - живой список пар биржи. Без него подменяем только то, что
    записано в карте руками: там каждая строка проверена человеком.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        return None

    mapped = SYMBOL_MAP.get(sym)
    if mapped is not None:
        if known is None or mapped.symbol in known:
            return mapped
        # Пара из карты исчезла у биржи - это не повод искать замену.
        return None

    if known is not None and sym in known:
        return Mapped(sym)
    return None


def divide(value: str | float | None, divisor: float) -> str | None:
    """Цена в нашем масштабе. Нечисловое значение отдаём как есть."""
    if value is None:
        return None
    if divisor == 1:
        return str(value)
    try:
        return f"{float(value) / divisor:.10f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return str(value)
