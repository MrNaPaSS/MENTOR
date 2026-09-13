"""Рыночные данные по биржам: какой сборщик кому отдаёт книгу.

До мультибиржи сборщик был один - Binance, - и стакан у всех был его. Ученик,
торгующий на WEEX или OKX, смотрел чужую книгу: плиты, спред и лента там
другие, а заявка исполняется не по ним (ТЗ мультибиржи, §4.4).

Здесь сборщик заводится **на биржу**, а не на ученика: десять учеников на
одной паре дали бы десять одинаковых соединений и десять раз одну и ту же
книгу в памяти. Реестр решает три вопроса и больше ничего не делает:

* чей стакан отдать - биржи ученика, если она умеет книгу, иначе Binance;
* когда включить поток биржи - при первом открытом стакане;
* что ответить, когда инструмента на бирже нет - назвать причину, а не
  показать пустую книгу.

Binance остаётся постоянным источником: с него идёт скринер и книга тех, у
кого биржа не подключена вовсе (§10.3).
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Protocol

from backend.scalping.state import MarketState

logger = logging.getLogger("nmnh.scalping.hub")

# Биржа, с которой идут скринер и книга по умолчанию.
PRIMARY = "binance"


class Collector(Protocol):
    """Что реестр требует от сборщика биржи. Больше он о них ничего не знает."""

    exchange: str
    state: MarketState

    def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def pin(self, symbol: str) -> None: ...

    async def unpin(self, symbol: str) -> None: ...


class Pinned:
    """Чей стакан открыт у клиента: биржа, инструмент и почему именно эта биржа.

    Причина нужна интерфейсу: «на OKX этой монеты нет» объясняет подмену книги,
    а молчаливая подмена выглядит ошибкой терминала.
    """

    __slots__ = ("exchange", "symbol", "asked", "reason")

    def __init__(self, exchange: str, symbol: str, asked: str, reason: str = ""):
        self.exchange = exchange
        self.symbol = symbol
        self.asked = asked
        self.reason = reason

    @property
    def fallback(self) -> bool:
        return self.exchange != self.asked


class MarketHub:
    """Сборщики по биржам: постоянный Binance и остальные по требованию."""

    def __init__(
        self,
        primary: Any,
        factories: dict[str, Callable[[], Any]] | None = None,
    ):
        self.primary = primary
        self._factories = dict(factories or {})
        self._collectors: dict[str, Any] = {}
        if primary is not None:
            self._collectors[PRIMARY] = primary

    # ── состав ──────────────────────────────────────────────────────────────

    @property
    def exchanges(self) -> tuple[str, ...]:
        """Биржи, книгу которых мы умеем показывать."""
        codes = [PRIMARY] if self.primary is not None else []
        return tuple(codes + sorted(self._factories))

    def knows(self, exchange: str) -> bool:
        code = _code(exchange)
        return code in self._factories or (code == PRIMARY and self.primary is not None)

    def state_of(self, exchange: str | None) -> MarketState | None:
        collector = self._collectors.get(_code(exchange))
        return collector.state if collector is not None else None

    def collector(self, exchange: str | None) -> Any | None:
        return self._collectors.get(_code(exchange))

    def listed(self, exchange: str | None) -> frozenset[str] | None:
        """Монеты биржи, какие знаем прямо сейчас. `None` - не знаем.

        Спрашивается на каждой рассылке скринера, поэтому без сети: справочник
        инструментов сборщик держит у себя и обновляет сам. Пустого ответа нет
        намеренно - «мы ещё не спросили» и «биржа таких монет не торгует» это
        разные вещи, и вторую нельзя показывать вместо первой: ученик увидел бы
        весь список помеченным как чужой.
        """
        collector = self._collectors.get(_code(exchange))
        known = getattr(collector, "listed_symbols", None)
        if known is None:
            return None
        symbols = known()
        return frozenset(symbols) if symbols else None

    def _ensure(self, exchange: str) -> Any | None:
        """Поднять сборщик биржи, если он ещё не заведён.

        Заводим по факту первого открытого стакана: постоянное соединение
        стоит памяти и трафика, держать его ради никого незачем.
        """
        code = _code(exchange)
        collector = self._collectors.get(code)
        if collector is not None:
            return collector
        factory = self._factories.get(code)
        if factory is None:
            return None
        collector = factory()
        self._collectors[code] = collector
        collector.start()
        logger.info("Сборщик рынка %s включён", code)
        return collector

    # ── подписка клиента ────────────────────────────────────────────────────

    async def pin(self, exchange: str | None, symbol: str) -> Pinned:
        """Удержать инструмент на нужной бирже. Не вышло - Binance и причина."""
        sym = symbol.upper()
        asked = _code(exchange)
        if asked and asked != PRIMARY:
            collector = self._ensure(asked)
            if collector is None:
                return await self._primary(sym, asked, "no_feed")
            supports = getattr(collector, "supports", None)
            if supports is not None and not await supports(sym):
                # Наборы монет у бирж разные: монеты может не быть вовсе.
                return await self._primary(sym, asked, "no_symbol")
            await collector.pin(sym)
            return Pinned(asked, sym, asked)
        return await self._primary(sym, asked or PRIMARY, "")

    async def _primary(self, symbol: str, asked: str, reason: str) -> Pinned:
        if self.primary is None:
            return Pinned("", symbol, asked, reason or "no_feed")
        await self.primary.pin(symbol)
        return Pinned(PRIMARY, symbol, asked, reason)

    async def unpin(self, exchange: str | None, symbol: str) -> None:
        collector = self._collectors.get(_code(exchange))
        if collector is not None:
            await collector.unpin(symbol.upper())

    async def stop(self) -> None:
        """Погасить всё, кроме постоянного: его жизненным циклом ведает main."""
        for code, collector in list(self._collectors.items()):
            if collector is self.primary:
                continue
            self._collectors.pop(code, None)
            await collector.stop()


def _code(value: str | None) -> str:
    return (value or "").strip().lower()
