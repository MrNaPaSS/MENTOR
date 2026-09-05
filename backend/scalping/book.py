"""Локальная копия стакана: снимок + поток изменений.

Биржа не шлёт стакан целиком — она отдаёт снимок по REST и дальше только
изменившиеся уровни. Полную книгу собираем и держим у себя: это единственный
способ показать глубину в сотни уровней, не выбивая лимит запросов.

Порядок синхронизации (правила биржи для фьючерсов):

    1. подписаться на поток изменений и копить события;
    2. взять снимок, у него есть `lastUpdateId`;
    3. выбросить события, целиком лежащие раньше снимка (``u`` < lastUpdateId);
    4. первое подходящее событие обязано накрывать снимок: ``U`` <= lastUpdateId <= ``u``;
    5. дальше каждое событие продолжает предыдущее: ``pu`` == прошлый ``u``.

Разрыв на шаге 5 означает потерянное событие — книга больше не совпадает с
биржей, и её нужно пересобирать со снимка. Молча продолжать нельзя: расхождение
не самоисправляется, а трейдер будет видеть плиту, которой давно нет.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.scalping.metrics import Level


@dataclass
class OrderBook:
    """Книга заявок одного инструмента.

    Изменяемая по устройству: поток обновляет её десять раз в секунду, и копия
    словаря на каждое событие была бы чистой тратой. Наружу книга отдаёт только
    неизменяемые срезы (`Level`), поэтому мутация не расходится по коду.
    """

    symbol: str
    bids: dict[float, float] = field(default_factory=dict)
    asks: dict[float, float] = field(default_factory=dict)
    last_update_id: int = 0
    ready: bool = False
    synced: bool = False

    def apply_snapshot(self, bids: list, asks: list, last_update_id: int) -> None:
        """Заменить книгу снимком REST."""
        self.bids = _to_map(bids)
        self.asks = _to_map(asks)
        self.last_update_id = last_update_id
        self.ready = True
        # Первое событие после снимка проверяется иначе, чем последующие.
        self.synced = False

    def apply_diff(self, event: dict) -> bool:
        """Применить событие изменения. False — книга рассинхронизирована.

        Вызывающий обязан отреагировать на False пересборкой со снимка.
        """
        if not self.ready:
            return False

        first, final = int(event.get("U", 0)), int(event.get("u", 0))

        # Событие целиком старше снимка — уже учтено в нём.
        if final < self.last_update_id:
            return True

        if not self.synced:
            # Первое событие после снимка обязано его накрывать. Проверять его
            # по `pu` нельзя: снимок берётся отдельным запросом и в цепочке
            # событий потока не участвует.
            if not (first <= self.last_update_id <= final):
                return False
            self.synced = True
        else:
            prev = event.get("pu")
            if prev is not None and int(prev) != self.last_update_id:
                # Между этим и прошлым событием потерялось ещё одно.
                return False

        _merge(self.bids, event.get("b") or [])
        _merge(self.asks, event.get("a") or [])
        self.last_update_id = final
        return True

    def levels(self, side: str, limit: int | None = None) -> list[Level]:
        """Уровни стороны от лучшей цены вглубь."""
        source = self.bids if side == "bid" else self.asks
        prices = sorted(source, reverse=(side == "bid"))
        if limit is not None:
            prices = prices[:limit]
        return [Level(price=p, size=source[p]) for p in prices]

    def levels_in_band(self, side: str, band_bp: float) -> list[Level]:
        """Уровни в полосе `band_bp` базисных пунктов вокруг текущей цены.

        Считать метрики по всей книге нельзя: поток приносит уровни за проценты
        от цены, они копятся, и на их фоне медиана уходит в ноль — тогда плитой
        выглядит любая обычная заявка рядом с ценой.
        """
        mid = self.mid
        if mid <= 0:
            return []
        edge = mid * band_bp / 10_000
        low, high = mid - edge, mid + edge
        return [l for l in self.levels(side) if low <= l.price <= high]

    def prune(self, band_bp: float) -> int:
        """Выбросить уровни дальше полосы. Возвращает число удалённых.

        Поток изменений присылает и очень далёкие уровни, а снятие приходит
        только по тем, что биржа считает актуальными. Без чистки книга растёт
        неограниченно: за минуту наблюдения она прибавила треть объёма.
        """
        mid = self.mid
        if mid <= 0:
            return 0
        edge = mid * band_bp / 10_000
        low, high = mid - edge, mid + edge
        removed = 0
        for source in (self.bids, self.asks):
            for price in [p for p in source if p < low or p > high]:
                del source[price]
                removed += 1
        return removed

    @property
    def best_bid(self) -> float:
        return max(self.bids) if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return min(self.asks) if self.asks else 0.0

    @property
    def mid(self) -> float:
        bid, ask = self.best_bid, self.best_ask
        if bid <= 0 or ask <= 0:
            return 0.0
        return (bid + ask) / 2

    def reset(self) -> None:
        self.bids.clear()
        self.asks.clear()
        self.last_update_id = 0
        self.ready = False
        self.synced = False


def _to_map(rows: list) -> dict[float, float]:
    out: dict[float, float] = {}
    for row in rows or []:
        parsed = _parse_row(row)
        if parsed and parsed[1] > 0:
            out[parsed[0]] = parsed[1]
    return out


def _merge(target: dict[float, float], rows: list) -> None:
    """Применить изменения: нулевой объём означает снятие уровня."""
    for row in rows:
        parsed = _parse_row(row)
        if not parsed:
            continue
        price, size = parsed
        if size <= 0:
            target.pop(price, None)
        else:
            target[price] = size


def _parse_row(row) -> tuple[float, float] | None:
    try:
        return float(row[0]), float(row[1])
    except (TypeError, ValueError, IndexError):
        return None
