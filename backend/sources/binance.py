"""Binance вторым источником рыночных данных (ТЗ этап 2, §5).

Второго клиента не пишем. Берём тот, что уже работает в скальпинге
([backend/scalping/binance.py](../scalping/binance.py)): у него есть стакан,
свечи, лента и суточная сводка, счёт веса запросов и самоблокировка при бане.
Он смотрит в `fapi.binance.com` - это фьючерсы, тот же инструмент, что у WEEX,
а не спот.

Здесь только переклад: ответы Binance приводятся к той форме, в которой наши
ручки ждут ответ WEEX, а цены делятся на множитель пары, если он есть.

Чего здесь нет намеренно - **финансирования и открытого интереса**. Ученик
платит фандинг WEEX, и показать вместо него чужой значит соврать о его
расходах; открытый интерес - величина по бирже, а не по рынку (ТЗ §5.2).
"""

from __future__ import annotations

import logging
import time

from backend.scalping.binance import BinanceRest
from backend.sources import cache, registry, session, symbols

log = logging.getLogger(__name__)

NAME = "binance"

# Отказ на старте - метка на час, а не попытка при каждом запросе ученика.
# Биржа отвечает не из любой сети: часть регионов получает 451, и наш бэкенд
# приходит на фронт туннелем с рабочего стола (ТЗ §5.4).
UNAVAILABLE_BLOCK_SECONDS = 3600

# Суточная сводка - один запрос на все пары. Из неё берём и цену для подмены,
# и живой список пар: карта соответствия без него угадывала бы.
TICKERS_TTL = 5
TICKERS_KEY = "binance:tickers24"

# Лента: сколько прошлого просим у биржи, если наших сделок нет в потоке.
TRADES_WINDOW_MS = 5 * 60 * 1000

_rest: BinanceRest | None = None


def rest() -> BinanceRest:
    """Клиент биржи. Один на процесс, общий с остальными источниками."""
    global _rest
    if _rest is None:
        _rest = BinanceRest(session.insecure)
    return _rest


def reset() -> None:
    """Забыть клиента. Нужно тестам, которые подставляют свой."""
    global _rest
    _rest = None


def _blocked() -> bool:
    """Клиент сам закрылся по весу запросов - реестр обязан это увидеть."""
    client = rest()
    if not client.blocked:
        return False
    registry.mark_blocked(NAME, client.blocked_for)
    return True


# ── Суточная сводка ──────────────────────────────────────────────────────────


async def _tickers() -> list[dict] | None:
    async def builder():
        rows = await rest().tickers_24h()
        return rows or None

    rows, _ = await cache.cached(TICKERS_KEY, TICKERS_TTL, builder, stale_ttl=60)
    return rows


async def known_symbols() -> set[str] | None:
    """Живой список пар биржи. `None` - спросить не удалось."""
    rows = await _tickers()
    if not rows:
        return None
    return {str(r.get("symbol", "")).upper() for r in rows}


async def _mapped(symbol: str) -> symbols.Mapped | None:
    """Пара на Binance или `None`, если подменять нечем."""
    return symbols.to_binance(symbol, await known_symbols())


async def _row(symbol: str) -> tuple[dict, symbols.Mapped] | None:
    pair = await _mapped(symbol)
    if pair is None:
        return None
    rows = await _tickers()
    for r in rows or []:
        if str(r.get("symbol", "")).upper() == pair.symbol:
            return r, pair
    return None


# ── Источники для цепочки ────────────────────────────────────────────────────


def price(symbol: str):
    """Цена пары в форме ответа WEEX `symbolPrice`."""

    async def builder():
        if _blocked():
            return None
        found = await _row(symbol)
        if found is None:
            return None
        row, pair = found
        value = symbols.divide(row.get("lastPrice"), pair.divisor)
        if value is None:
            return None
        return {"price": value, "time": int(row.get("closeTime") or 0)}

    return builder


def depth(symbol: str, limit: int = 100):
    """Стакан в форме ответа WEEX `depth`."""

    async def builder():
        if _blocked():
            return None
        pair = await _mapped(symbol)
        if pair is None:
            return None
        book = await rest().depth(pair.symbol, limit=limit, background=False)
        if not book:
            return None
        return {
            "bids": _levels(book.get("bids"), pair.divisor),
            "asks": _levels(book.get("asks"), pair.divisor),
        }

    return builder


def klines(symbol: str, interval: str, limit: int):
    """Свечи в той же раскладке колонок, что у WEEX."""

    async def builder():
        if _blocked():
            return None
        pair = await _mapped(symbol)
        if pair is None:
            return None
        rows = await rest().klines(pair.symbol, interval=interval, limit=limit)
        if not rows:
            return None
        return [_candle(row, pair.divisor) for row in rows]

    return builder


def trades(symbol: str, limit: int = 40):
    """Лента сделок в форме ответа WEEX `trades`."""

    async def builder():
        if _blocked():
            return None
        pair = await _mapped(symbol)
        if pair is None:
            return None
        now_ms = int(time.time() * 1000)
        rows = await rest().agg_trades(
            pair.symbol, now_ms - TRADES_WINDOW_MS, now_ms, limit=min(limit, 1000)
        )
        if not rows:
            return None
        return [_trade(row, pair.divisor) for row in rows[-limit:]]

    return builder


# ── Переклад ответов ─────────────────────────────────────────────────────────


def _levels(rows, divisor: float) -> list[list[str]]:
    out: list[list[str]] = []
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        price_value = symbols.divide(row[0], divisor)
        if price_value is None:
            continue
        out.append([price_value, str(row[1])])
    return out


def _candle(row, divisor: float) -> list:
    """Свеча Binance и WEEX совпадают по колонкам: цены делим, прочее как есть."""
    if not isinstance(row, (list, tuple)) or len(row) < 8:
        return list(row) if isinstance(row, (list, tuple)) else []
    out = list(row)
    for i in (1, 2, 3, 4):
        out[i] = symbols.divide(out[i], divisor)
    return out


def _trade(row: dict, divisor: float) -> dict:
    price_value = symbols.divide(row.get("p"), divisor)
    qty = str(row.get("q", "0"))
    try:
        quote = f"{float(price_value or 0) * float(qty):.8f}"
    except (TypeError, ValueError):
        quote = "0"
    return {
        "price": price_value,
        "qty": qty,
        "quoteQty": quote,
        "time": row.get("T"),
        "isBuyerMaker": bool(row.get("m")),
    }


# ── Доступность ──────────────────────────────────────────────────────────────


async def probe() -> bool:
    """Один запрос на старте: отвечает биржа из нашей сети или нет.

    Не отвечает - метка в реестре на час. Иначе каждый запрос ученика тратил бы
    восемь секунд ожидания на источник, которого в этой сети нет вовсе.
    """
    try:
        rows = await rest().tickers_24h()
    except Exception as exc:
        log.warning("Binance недоступен, второго источника не будет: %s", exc)
        rows = None

    if not rows:
        registry.mark_blocked(NAME, UNAVAILABLE_BLOCK_SECONDS)
        return False

    log.info("Binance отвечает: %d пар", len(rows))
    return True
