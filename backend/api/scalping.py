"""Скальпинг — агрегированный стакан (DOM), лента сделок и метрики давления.

Один запрос вместо трёх: фронт опрашивает эндпоинт часто (2-4 раза в секунду),
и три отдельных round-trip до WEEX давали бы рассинхрон стакана с лентой —
на скальпинге это критично, кластеры «поехали бы» относительно цены.

Настройки по умолчанию сняты с рабочего пространства Tiger.Trade заказчика
(`Trading_*_Settings.xml`, окно «Стакан»), чтобы раздел вёл себя привычно:

    DomAutoscaleDepth      30    → глубина стакана
    BidAskImbalanceRatio   300   → порог сильного уровня, проценты
    PriceScaleMultiplier   10    → агрегация цен ×10 от шага биржи
    DomRuler               Percents, inside → гистограмма внутри строки
"""

from __future__ import annotations

import asyncio
import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.api.market_data import _weex

router = APIRouter(prefix="/api/scalping", tags=["scalping"])

# Значения по умолчанию — из конфига Tiger.Trade заказчика.
DEFAULT_IMBALANCE_RATIO = 300  # BidAskImbalanceRatio
DEFAULT_ROWS = 30              # DomAutoscaleDepth

# Во сколько раз укрупняем сетку биржи, если шаг не задан явно.
# У заказчика PriceScaleMultiplier = 10.
PRICE_SCALE_MULTIPLIER = 10

# Готовый шаг агрегации для основных пар: шаг биржи × PRICE_SCALE_MULTIPLIER.
TICK_HINTS: dict[str, float] = {
    "BTCUSDT": 1.0,
    "ETHUSDT": 0.1,
    "SOLUSDT": 0.01,
    "BNBUSDT": 0.01,
    "XRPUSDT": 0.0001,
    "DOGEUSDT": 0.00001,
}


def _to_level(raw: Any) -> tuple[float, float] | None:
    """WEEX отдаёт уровни то списком [price, size], то объектом — принимаем оба."""
    try:
        if isinstance(raw, (list, tuple)) and len(raw) >= 2:
            return float(raw[0]), float(raw[1])
        if isinstance(raw, dict):
            price = raw.get("price", raw.get("p"))
            size = raw.get("size", raw.get("s", raw.get("qty")))
            if price is None or size is None:
                return None
            return float(price), float(size)
    except (TypeError, ValueError):
        return None
    return None


def parse_levels(raw: Any) -> list[tuple[float, float]]:
    """Разобрать сырой список уровней, отбросив мусор и нулевые объёмы."""
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[tuple[float, float]] = []
    for item in raw:
        lvl = _to_level(item)
        if lvl and lvl[0] > 0 and lvl[1] > 0:
            out.append(lvl)
    return out


def aggregate(
    levels: list[tuple[float, float]],
    tick: float,
    side: str,
    rows: int,
) -> list[dict[str, float]]:
    """Схлопнуть уровни в ценовые корзины шагом `tick`.

    Биды округляем вниз, аски вверх — так корзина всегда «в пользу» стоящего
    в стакане, и лучшая цена не уезжает внутрь спреда.
    """
    buckets: dict[float, float] = {}
    if tick <= 0:
        for price, size in levels:
            buckets[price] = buckets.get(price, 0.0) + size
    else:
        for price, size in levels:
            steps = price / tick
            k = math.floor(steps + 1e-9) if side == "bid" else math.ceil(steps - 1e-9)
            bucket = round(k * tick, 10)
            buckets[bucket] = buckets.get(bucket, 0.0) + size

    ordered = sorted(buckets.items(), key=lambda kv: kv[0], reverse=(side == "bid"))
    ordered = ordered[:rows]

    out: list[dict[str, float]] = []
    cum = 0.0
    for price, size in ordered:
        cum += size
        out.append({"price": price, "size": round(size, 8), "cum": round(cum, 8)})
    return out


def mark_imbalance(
    bids: list[dict[str, float]],
    asks: list[dict[str, float]],
    ratio_percent: float,
) -> None:
    """Проставить флаг `strong` уровням, где сторона перевешивает соседнюю.

    Сравниваем уровни на одинаковом удалении от спреда: первый бид против
    первого аска и так далее. Так же считает кластерный имбаланс Tiger.Trade.
    """
    ratio = ratio_percent / 100.0
    for i in range(min(len(bids), len(asks))):
        b, a = bids[i], asks[i]
        b["strong"] = bool(a["size"] > 0 and b["size"] >= a["size"] * ratio)
        a["strong"] = bool(b["size"] > 0 and a["size"] >= b["size"] * ratio)
    for lvl in bids[min(len(bids), len(asks)):] + asks[min(len(bids), len(asks)):]:
        lvl["strong"] = False


def find_walls(levels: list[dict[str, float]], factor: float = 3.0) -> list[float]:
    """Цены «плит» — уровней, чей объём кратно выше среднего по своей стороне."""
    if len(levels) < 3:
        return []
    avg = sum(l["size"] for l in levels) / len(levels)
    if avg <= 0:
        return []
    return [l["price"] for l in levels if l["size"] >= avg * factor]


def tape_metrics(trades: list[dict[str, Any]]) -> dict[str, float]:
    """Дельта и объёмы по ленте: сколько прошло по рынку в каждую сторону."""
    buy = sell = 0.0
    for t in trades:
        try:
            qty = float(t.get("qty") or 0)
        except (TypeError, ValueError):
            continue
        if t.get("isBuy"):
            buy += qty
        else:
            sell += qty
    total = buy + sell
    return {
        "buy_volume": round(buy, 8),
        "sell_volume": round(sell, 8),
        "delta": round(buy - sell, 8),
        # Доля покупок от общего объёма, 0..1 — для полосы давления.
        "buy_ratio": round(buy / total, 4) if total > 0 else 0.5,
    }


def _resolve_tick(symbol: str, tick: float | None, bids: list, asks: list) -> float:
    """Шаг агрегации: явный из запроса → подсказка по паре → сетка биржи."""
    if tick is not None and tick > 0:
        return tick
    hint = TICK_HINTS.get(symbol.upper())
    if hint:
        return hint
    prices = sorted({p for p, _ in bids + asks})
    if len(prices) >= 2:
        gaps = [round(b - a, 10) for a, b in zip(prices, prices[1:]) if b > a]
        if gaps:
            return round(min(gaps) * PRICE_SCALE_MULTIPLIER, 10)
    return 0.0


@router.get("/dom/{symbol}")
async def dom(
    symbol: str,
    rows: int = Query(DEFAULT_ROWS, ge=4, le=60),
    tick: float | None = Query(None, gt=0, description="Шаг агрегации цен"),
    imbalance_ratio: float = Query(DEFAULT_IMBALANCE_RATIO, ge=100, le=1000),
    trades_limit: int = Query(40, ge=0, le=100),
) -> dict[str, Any]:
    """Стакан + лента + метрики давления одним снимком."""
    sym = symbol.upper()

    depth_raw, trades_raw = await asyncio.gather(
        _weex("/capi/v3/market/depth", {"symbol": sym}),
        _weex("/capi/v3/market/trades", {"symbol": sym, "limit": trades_limit})
        if trades_limit
        else asyncio.sleep(0, result=None),
    )

    if not depth_raw:
        raise HTTPException(502, f"WEEX depth недоступен для {sym}")

    payload = depth_raw.get("data") or depth_raw if isinstance(depth_raw, dict) else {}
    bids_raw = parse_levels(payload.get("bids") or payload.get("bid"))
    asks_raw = parse_levels(payload.get("asks") or payload.get("ask"))
    if not bids_raw or not asks_raw:
        raise HTTPException(502, f"Пустой стакан для {sym}")

    step = _resolve_tick(sym, tick, bids_raw, asks_raw)
    bids = aggregate(bids_raw, step, "bid", rows)
    asks = aggregate(asks_raw, step, "ask", rows)
    mark_imbalance(bids, asks, imbalance_ratio)

    best_bid = bids[0]["price"]
    best_ask = asks[0]["price"]
    mid = (best_bid + best_ask) / 2

    trades: list[dict[str, Any]] = []
    if isinstance(trades_raw, list):
        for t in trades_raw:
            try:
                trades.append({
                    "price": float(t.get("price") or 0),
                    "qty": float(t.get("qty") or 0),
                    "time": int(t.get("time") or 0),
                    "isBuy": not t.get("isBuyerMaker", True),
                })
            except (TypeError, ValueError):
                continue

    bid_vol = sum(l["size"] for l in bids)
    ask_vol = sum(l["size"] for l in asks)
    book_total = bid_vol + ask_vol

    return {
        "symbol": sym,
        "tick": step,
        "bids": bids,
        "asks": asks,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "mid": round(mid, 10),
        "spread": round(best_ask - best_bid, 10),
        "spread_bp": round((best_ask - best_bid) / mid * 10_000, 2) if mid else 0.0,
        "bid_volume": round(bid_vol, 8),
        "ask_volume": round(ask_vol, 8),
        # Перевес стакана 0..1: >0.5 — плотнее заявки на покупку.
        "book_ratio": round(bid_vol / book_total, 4) if book_total > 0 else 0.5,
        "bid_walls": find_walls(bids),
        "ask_walls": find_walls(asks),
        "trades": trades,
        "tape": tape_metrics(trades),
    }
