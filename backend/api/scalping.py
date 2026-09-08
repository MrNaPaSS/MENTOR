"""Скринер и стакан для скальпинга (HTTP).

Эндпоинты только читают состояние, собранное фоновым сборщиком, и в биржу не
ходят. Поэтому они отвечают за микросекунды и выдерживают любую частоту опроса:
живое обновление идёт по WebSocket, а HTTP нужен для первой отрисовки и для
клиентов, которым сокет недоступен.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from backend.scalping.clusters import fit_to_rows
from backend.scalping.collector import ScalpingCollector
from backend.scalping.footprint import (
    build as build_footprint,
    collect,
    from_columns,
    guess_tick,
)
from backend.scalping.ladder import DEFAULT_ROWS, MAX_ROWS, build_ladder, detect_tick
from backend.scalping.metrics import SHELF_MAX_LIMIT, SHELF_MIN_LIMIT, SHELF_MIN_NOTIONAL
from backend.scalping.state import (
    BAND_BP,
    DEFAULT_SORT,
    SORT_KEYS,
    biggest_wall,
    liquidity_shelves,
)

router = APIRouter(prefix="/api/scalping", tags=["scalping"])


def get_collector(request: Request) -> ScalpingCollector:
    collector = getattr(request.app.state, "scalping", None)
    if collector is None:
        raise HTTPException(503, "Сборщик скальпинга не запущен")
    return collector


@router.get("/screener")
async def screener(
    request: Request,
    sort: str = Query(DEFAULT_SORT, description=f"Одно из: {', '.join(SORT_KEYS)}"),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Список монет с метриками скальпинга, отсортированный по выбранному полю."""
    collector = get_collector(request)
    rows = collector.state.rows(sort=sort)[:limit]
    return {
        "sort": sort if sort in SORT_KEYS else DEFAULT_SORT,
        "band_bp": BAND_BP,
        "count": len(rows),
        "rows": [asdict(r) for r in rows],
    }


@router.get("/dom/{symbol}")
async def dom(
    request: Request,
    symbol: str,
    rows: int = Query(DEFAULT_ROWS, ge=4, le=MAX_ROWS),
    tick: float | None = Query(None, gt=0, description="Шаг ценовой шкалы"),
    agg: int = Query(1, ge=1, le=100, description="Укрупнение шага биржи, разы"),
    shelf: float = Query(
        SHELF_MIN_NOTIONAL,
        ge=SHELF_MIN_LIMIT,
        le=SHELF_MAX_LIMIT,
        description="Порог полки ликвидности в деньгах",
    ),
) -> dict[str, Any]:
    """Лестница стакана с плитами и метриками по одному инструменту."""
    collector = get_collector(request)
    sym = symbol.upper()

    state = collector.state.get(sym)
    if state is None:
        raise HTTPException(404, f"{sym} не под наблюдением - откройте его через WebSocket")
    if not state.book.ready:
        raise HTTPException(503, f"Стакан {sym} ещё собирается")

    ladder, step = build_ladder(
        state.book, rows=rows, tick=tick, agg=agg, whale_notional=shelf
    )
    wall = biggest_wall(state)
    tape = state.tape.metrics(int(time.time()))

    return {
        "symbol": sym,
        "tick": step,
        "base_tick": step / max(1, agg) if not tick else step,
        "best_bid": state.book.best_bid,
        "best_ask": state.book.best_ask,
        "mid": state.book.mid,
        "book_ratio": state.book_ratio,
        "depth": {"bids": len(state.book.bids), "asks": len(state.book.asks)},
        "rows": [asdict(r) for r in ladder],
        "wall": asdict(wall) if wall else None,
        "shelves": [asdict(s) for s in liquidity_shelves(state, min_notional=shelf)],
        "tape": asdict(tape),
        "clusters": [
            {
                "start": c.start,
                "buy": c.buy,
                "sell": c.sell,
                "cells": [[p, x.buy, x.sell] for p, x in c.cells.items()],
            }
            for c in (
                fit_to_rows(state.clusters.snapshot(), [r.price for r in ladder], step)
                if state.clusters
                else []
            )
        ],
    }


# Свечи меняются раз в минуту, а график перерисовывается чаще — короткий кэш
# держит расход лимита биржи около нуля независимо от числа открытых вкладок.
_KLINE_TTL = 2.0
_klines_cache: dict[str, tuple[float, list]] = {}

# Длительности интервалов биржи в секундах: нужны, чтобы собрать из них те,
# которых у биржи нет.
_INTERVAL_SECONDS = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600}


def fold_candles(rows: list[dict], seconds: int) -> list[dict]:
    """Склеить свечи в корзины по `seconds`.

    Открытие берём у первой свечи корзины, закрытие у последней, край - по
    краям, объём складываем. Незакрытую корзину оставляем: на графике это
    текущая свеча, и обрезать её значило бы прятать движение, которое уже идёт.
    """
    if seconds <= 0 or not rows:
        return rows

    out: list[dict] = []
    for row in rows:
        start = row["time"] - row["time"] % seconds
        if out and out[-1]["time"] == start:
            last = out[-1]
            last["high"] = max(last["high"], row["high"])
            last["low"] = min(last["low"], row["low"])
            last["close"] = row["close"]
            last["volume"] += row["volume"]
        else:
            out.append({**row, "time": start})
    return out

# Запросы в полёте: ключ → ожидание. Нужно, чтобы одновременные обращения к
# одной монете складывались в один поход на биржу, а не в десять.
_klines_inflight: dict[str, Any] = {}


@router.get("/klines/{symbol}")
async def klines(
    request: Request,
    symbol: str,
    # Дневные, недельные и месячные нужны не для отрисовки свечей, а ради
    # уровней прошлого периода: индикатор рисует их на любом таймфрейме.
    interval: str = Query("1m", pattern=r"^(1m|3m|5m|10m|15m|30m|1h|4h|1d|1w|1M)$"),
    limit: int = Query(240, ge=2, le=500),
) -> dict[str, Any]:
    """Свечи для графика рядом со стаканом — из того же источника, что и книга."""
    collector = get_collector(request)
    sym = symbol.upper()
    key = f"{sym}:{interval}:{limit}"

    cached = _klines_cache.get(key)
    now = time.monotonic()

    # Десять человек на одной монете просят свечи почти одновременно. Без
    # общего ожидания это десять одинаковых запросов на биржу вместо одного —
    # ровно так и набирается лишний вес.
    pending = _klines_inflight.get(key)
    if pending is not None and not (cached and now - cached[0] < _KLINE_TTL):
        await pending
        cached = _klines_cache.get(key)
        now = time.monotonic()
    # Только свежие данные. Устаревшая свеча в скальпинге хуже пустого экрана:
    # по ней принимают решение, считая её текущей. Нет свежих — так и говорим.
    if cached and now - cached[0] < _KLINE_TTL:
        rows = cached[1]
    else:
        done = asyncio.get_running_loop().create_future()
        _klines_inflight[key] = done
        # Десятиминуток у биржи нет: просим пятиминутки и складываем парами.
        # Границы совпадают - десять минут это ровно две пятиминутки от той же
        # эпохи, - поэтому свечи получаются те же, что были бы у биржи.
        source, factor = ("5m", 2) if interval == "10m" else (interval, 1)
        try:
            raw = await collector.rest.klines(sym, source, limit * factor)
        finally:
            _klines_inflight.pop(key, None)
            if not done.done():
                done.set_result(None)
        rows = []
        for r in raw:
            try:
                rows.append(
                    {
                        # Секунды, а не миллисекунды: график ждёт их в секундах.
                        "time": int(r[0]) // 1000,
                        "open": float(r[1]),
                        "high": float(r[2]),
                        "low": float(r[3]),
                        "close": float(r[4]),
                        "volume": float(r[5]),
                    }
                )
            except (TypeError, ValueError, IndexError):
                continue

        if factor > 1:
            rows = fold_candles(rows, factor * _INTERVAL_SECONDS[source])
        # Пустой ответ не кэшируем: иначе секундный сбой биржи замирает на
        # экране кэшем и прячет восстановление.
        if rows:
            _klines_cache[key] = (now, rows)

    if not rows:
        if collector.rest.blocked:
            raise HTTPException(
                503,
                f"Биржа ограничила запросы, свечи появятся через "
                f"{collector.rest.blocked_for:.0f} с",
            )
        raise HTTPException(502, f"Свечи {sym} недоступны")
    return {"symbol": sym, "interval": interval, "candles": rows}


# ── Профиль объёма внутри свечи ─────────────────────────────────────────────
#
# Трейдер нажимает на свечу и видит, из чего она собрана: сколько денег прошло
# на каждой цене и куда били. Данные те же, что кормят кластеры у стакана, —
# лента сделок; разница только в источнике за прошлое, которого в памяти нет.

FOOTPRINT_INTERVALS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "10m": 600,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
}

# Сколько страниц сделок готовы выкачать на одну свечу.
#
# Страница — тысяча сделок и двадцать единиц веса. Шести хватает на минуту
# биткойна в час пик; что не влезло, помечается неполным — молча показать
# половину объёма хуже, чем сказать, что он неполон.
_FOOT_PAGES = 6

# Свежесть кэша. Закрытая свеча не меняется никогда, поэтому живёт долго и
# больше не стоит бирже ни одного запроса; текущая пересобирается почти сразу.
_FOOT_LIVE_TTL = 2.0
_FOOT_DONE_TTL = 900.0
_FOOT_CACHE_MAX = 96
_foot_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()


def _foot_remember(key: str, payload: dict) -> None:
    """Положить ответ в кэш, вытеснив самый старый.

    Кэш ограничен: трейдер за сессию открывает сотни свечей, и без потолка
    память росла бы вместе с их числом.
    """
    _foot_cache[key] = (time.monotonic(), payload)
    _foot_cache.move_to_end(key)
    while len(_foot_cache) > _FOOT_CACHE_MAX:
        _foot_cache.popitem(last=False)


async def _load_trades(
    rest, symbol: str, start_ms: int, end_ms: int
) -> tuple[list[tuple[float, float, bool]], bool]:
    """Сделки за окно свечи постранично. Второе значение — окно неполно.

    Продолжение берём по номеру сделки, а не по времени: в одну миллисекунду
    попадает десяток сделок, и переход по времени терял бы часть из них на
    каждой границе страниц.
    """
    out: list[tuple[float, float, bool]] = []
    from_id: int | None = None

    for _ in range(_FOOT_PAGES):
        batch = await rest.agg_trades(symbol, start_ms, end_ms, from_id=from_id)
        if not batch:
            # Пустая страница — либо сделок больше нет, либо биржа отказала.
            # Отличать их здесь незачем: и там, и там читать дальше нечего.
            return out, False

        last_id: int | None = None
        done = False
        for row in batch:
            try:
                ts = int(row["T"])
                if ts >= end_ms:
                    done = True
                    break
                last_id = int(row["a"])
                if ts < start_ms:
                    continue
                # m=true — покупатель стоял лимитом, значит по рынку бил продавец.
                out.append((float(row["p"]), float(row["q"]), not bool(row["m"])))
            except (KeyError, TypeError, ValueError):
                continue

        if done or len(batch) < 1000 or last_id is None:
            return out, False
        from_id = last_id + 1

    return out, True


@router.get("/footprint/{symbol}")
async def footprint(
    request: Request,
    symbol: str,
    interval: str = Query("1m", pattern=r"^(1m|3m|5m|10m|15m|30m|1h)$"),
    at: int = Query(..., alias="time", ge=0, description="Начало свечи, секунды"),
) -> dict[str, Any]:
    """Объём внутри одной свечи: строки профиля и итоги.

    Крупнее часа профиля не даём: за сутки сделок миллионы, выкачивать их ради
    картинки нечестно по отношению к лимиту биржи, а строки такой свечи всё
    равно схлопнулись бы в неразличимую кашу.
    """
    collector = get_collector(request)
    sym = symbol.upper()
    seconds = FOOTPRINT_INTERVALS[interval]
    start = at - at % seconds
    end = start + seconds
    now = int(time.time())
    if start > now:
        raise HTTPException(400, "Эта свеча ещё не началась")

    state = collector.state.get(sym)
    live = state.clusters if state else None

    # Своя лента — первым делом: она не стоит бирже ни одного запроса, а на
    # текущую свечу трейдер смотрит чаще всего.
    if live is not None and live.tick > 0 and live.first_second and live.first_second <= start:
        columns = live.snapshot()
        if columns and columns[0].start <= start:
            cells = from_columns(columns, start, end)
            shot = build_footprint(
                cells, time=start, seconds=seconds, tick=live.tick, partial=False
            )
            return _foot_payload(sym, interval, shot, source="tape")

    key = f"{sym}:{interval}:{start}"
    cached = _foot_cache.get(key)
    ttl = _FOOT_LIVE_TTL if end > now else _FOOT_DONE_TTL
    if cached and time.monotonic() - cached[0] < ttl:
        _foot_cache.move_to_end(key)
        return cached[1]

    if collector.rest.blocked:
        raise HTTPException(
            503,
            f"Биржа ограничила запросы, профиль появится через "
            f"{collector.rest.blocked_for:.0f} с",
        )

    trades, partial = await _load_trades(collector.rest, sym, start * 1000, end * 1000)
    if not trades:
        # Пустая свеча бывает на неликвиде, и это ответ, а не ошибка: сделок в
        # эту минуту не было вовсе.
        shot = build_footprint({}, time=start, seconds=seconds, tick=0.0, partial=False)
        return _foot_payload(sym, interval, shot, source="exchange")

    tick = detect_tick(state.book) if state else 0.0
    if tick <= 0:
        tick = guess_tick([p for p, _, _ in trades])
    cells = collect(trades, tick)
    shot = build_footprint(cells, time=start, seconds=seconds, tick=tick, partial=partial)
    payload = _foot_payload(sym, interval, shot, source="exchange")
    _foot_remember(key, payload)
    return payload


def _foot_payload(symbol: str, interval: str, shot, source: str) -> dict[str, Any]:
    """Ответ клиенту. Строки тройками — по той же причине, что и у кластеров:
    ключи JSON обязаны быть строками, а str(1e-05) в Python и в JavaScript
    выглядит по-разному, и ячейки монет с мелким шагом просто не нашлись бы."""
    return {
        "symbol": symbol,
        "interval": interval,
        "time": shot.time,
        "seconds": shot.seconds,
        "tick": shot.tick,
        "buy": shot.buy,
        "sell": shot.sell,
        "partial": shot.partial,
        "source": source,
        "levels": [[l.price, l.buy, l.sell] for l in shot.levels],
    }


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    """Состояние сборщика — что под наблюдением и жив ли поток биржи."""
    collector = get_collector(request)
    ready = sum(1 for s in collector.state.values() if s.book.ready)
    return {
        "connected": collector.stream.connected,
        "tracked": sorted(collector.tracked),
        "books_ready": ready,
        "streams": len(collector.stream.streams),
        # Сколько секунд биржа держит нас закрытыми. Ноль — всё в порядке;
        # больше нуля значит 418 или 429, и до конца паузы книги не соберутся.
        "throttled_for": round(collector.rest.blocked_for, 1),
    }
