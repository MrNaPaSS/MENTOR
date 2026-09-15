"""Скринер и стакан для скальпинга (HTTP).

Эндпоинты только читают состояние, собранное фоновым сборщиком, и в биржу не
ходят. Поэтому они отвечают за микросекунды и выдерживают любую частоту опроса:
живое обновление идёт по WebSocket, а HTTP нужен для первой отрисовки и для
клиентов, которым сокет недоступен.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from backend import tools
from backend.sources import session as sources_session

from backend.scalping.clusters import DEFAULT_COLUMNS as CLUSTER_COLUMNS, fit_to_rows
from backend.scalping.collector import ScalpingCollector
from backend.scalping.market_hub import PRIMARY, MarketHub
from backend.scalping.bingx import BingxPublicRest
from backend.scalping.mexc import BARS as MEXC_BARS, MexcPublicRest
from backend.scalping.okx import OkxPublicRest
from core.bingx.futures import symbol_id
from core.mexc.futures import symbol_id as mexc_symbol_id
from core.okx.futures import inst_id
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


def get_market(request: Request) -> MarketHub:
    """Реестр бирж. Его может не быть у сервера, собранного до мультибиржи."""
    market = getattr(request.app.state, "market_hub", None)
    if market is None:
        market = MarketHub(get_collector(request))
    return market


def venue_state(request: Request, exchange: str | None):
    """Состояние рынка нужной биржи и её код.

    Биржа не заведена или её стакан никто не открывал - отдаём Binance и
    говорим об этом кодом в ответе: ученик должен видеть, чью книгу читает.
    """
    market = get_market(request)
    code = (exchange or "").strip().lower()
    if code and code != PRIMARY:
        state = market.state_of(code)
        if state is not None:
            return state, code
    return get_collector(request).state, PRIMARY


@router.get("/screener")
async def screener(
    request: Request,
    sort: str = Query(DEFAULT_SORT, description=f"Одно из: {', '.join(SORT_KEYS)}"),
    limit: int = Query(50, ge=1, le=200),
    exchange: str | None = Query(None, description="Биржа ученика: чужие монеты будут помечены"),
) -> dict[str, Any]:
    """Список монет с метриками скальпинга, отсортированный по выбранному полю.

    Список один на всех и собирается с Binance: там все монеты и самый живой
    объём. `exchange` добавляет к нему `absent` - монеты, которых на бирже
    ученика нет: стакан по ним будет общий, а сделку не поставить. Состав биржи
    ещё не известен - поля нет вовсе, помечать весь список чужим нельзя.
    """
    collector = get_collector(request)
    rows = collector.state.rows(sort=sort)[:limit]
    body = {
        "sort": sort if sort in SORT_KEYS else DEFAULT_SORT,
        "band_bp": BAND_BP,
        "count": len(rows),
        "rows": [asdict(r) for r in rows],
    }
    code = (exchange or "").strip().lower()
    listed = get_market(request).listed(code) if code and code != PRIMARY else None
    if listed is not None:
        body["exchange"] = code
        body["absent"] = [r.symbol for r in rows if r.symbol not in listed]
    return body


def tool_rights(
    request: Request, authorization: str | None = Header(default=None)
) -> frozenset[str]:
    """Купленные инструменты того, кто спрашивает. Без токена - ничего."""
    config = getattr(request.app.state, "config", None)
    if config is None:
        return frozenset()
    return tools.rights_from_header(authorization, config.jwt_secret)


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
    exchange: str = Query("", description="Биржа книги; пусто - Binance"),
    rights: frozenset[str] = Depends(tool_rights),
) -> dict[str, Any]:
    """Лестница стакана с плитами и метриками по одному инструменту.

    Глубина и шаг - по купленным инструментам: без них бесплатный уровень.
    Книга - той биржи, где ученик торгует: плиты и спред у каждой свои.
    """
    rows = tools.limit_rows(rows, rights)
    agg = tools.limit_agg(agg, rights)
    market_state, venue = venue_state(request, exchange)
    sym = symbol.upper()

    state = market_state.get(sym)
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
        "exchange": venue,
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
                fit_to_rows(
                    state.clusters.snapshot(CLUSTER_COLUMNS), [r.price for r in ladder], step
                )
                if state.clusters
                else []
            )
        ],
    }


# Свечи меняются раз в минуту, а график перерисовывается чаще — короткий кэш
# держит расход лимита биржи около нуля независимо от числа открытых вкладок.
_KLINE_TTL = 2.0
_klines_cache: dict[str, tuple[float, list]] = {}

# Сколько наборов свечей держать в памяти. Ручка открыта без входа, а ключ
# кэша собирается из монеты, таймфрейма и глубины - перебором глубины от 2 до
# 500 кэш раздувался без конца. Полтысячи наборов с запасом покрывают всех,
# кто сейчас смотрит график; вытесняется самый давний.
_KLINES_CACHE_MAX = 512

# Символ монеты: буквы и цифры (у Binance бывают и иероглифы), подчёркивание
# у квартальных контрактов. Остальное биржа всё равно отвергнет, а запрос
# потратит её лимит на адрес сервера.
_SYMBOL = re.compile(r"\w{2,40}")


def _remember_klines(key: str, at: float, rows: list) -> None:
    """Положить свечи в кэш, вытеснив самые давние сверх потолка."""
    _klines_cache.pop(key, None)
    _klines_cache[key] = (at, rows)
    while len(_klines_cache) > _KLINES_CACHE_MAX:
        _klines_cache.pop(next(iter(_klines_cache)))

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

# Названия таймфреймов у OKX. Дневные, недельные и месячные берём в UTC:
# по умолчанию биржа считает их от гонконгского времени, и уровни прошлого дня
# у ученика разъехались бы с теми, что рисует график Binance.
OKX_BARS = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1H",
    "4h": "4H",
    "1d": "1Dutc",
    "1w": "1Wutc",
    "1M": "1Mutc",
}


async def okx_klines(request: Request, symbol: str, interval: str, limit: int) -> list[list]:
    """Свечи OKX в том же виде, в каком их отдаёт Binance.

    Биржа присылает их от новых к старым и объём двумя мерами: в контрактах
    (``vol``) и в монетах (``volCcy``). Берём монеты - так же, как у Binance,
    иначе объём на графике был бы в сотню раз больше.
    """
    bar = OKX_BARS.get(interval)
    if not bar:
        return []
    collector = get_market(request).collector("okx")
    rest = getattr(collector, "rest", None) or OkxPublicRest(sources_session.get)
    rows = await rest.candles(inst_id(symbol), bar, min(limit, 300))
    out: list[list] = []
    for row in reversed(rows):
        try:
            out.append([int(row[0]), row[1], row[2], row[3], row[4], row[6]])
        except (TypeError, ValueError, IndexError):
            continue
    return out


# Названия таймфреймов у BingX. Свои совпадают с нашими знак в знак - кроме
# недели и месяца, которые биржа пишет заглавными.
BINGX_BARS = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1w": "1w",
    "1M": "1M",
}


async def bingx_klines(request: Request, symbol: str, interval: str, limit: int) -> list[list]:
    """Свечи BingX в том же виде, в каком их отдаёт Binance.

    Биржа отдаёт их словарями и от новых к старым; объём - в монетах, как и
    везде у неё, поэтому переводить его не нужно.
    """
    bar = BINGX_BARS.get(interval)
    if not bar:
        return []
    collector = get_market(request).collector("bingx")
    rest = getattr(collector, "rest", None) or BingxPublicRest(sources_session.get)
    rows = await rest.candles(symbol_id(symbol), bar, min(limit, 500))
    out: list[list] = []
    for row in reversed(rows):
        try:
            out.append(
                [
                    int(row["time"]),
                    row["open"],
                    row["high"],
                    row["low"],
                    row["close"],
                    row["volume"],
                ]
            )
        except (TypeError, ValueError, KeyError):
            continue
    return out


async def mexc_klines(request: Request, symbol: str, interval: str, limit: int) -> list[list]:
    """Свечи MEXC в том же виде, в каком их отдаёт Binance.

    Биржа отдаёт их столбцами, а не строками, и время - в секундах; складывает
    их в строки сам клиент (`backend/scalping/mexc.py`). Объём приходит в
    контрактах, а в свечу кладётся оборот в деньгах (`amount`): у графика
    объёма это честнее, чем контракты, которых у каждой пары свой размер.
    """
    bar = MEXC_BARS.get(interval)
    if not bar:
        return []
    collector = get_market(request).collector("mexc")
    rest = getattr(collector, "rest", None) or MexcPublicRest(sources_session.get)
    rows = await rest.candles(mexc_symbol_id(symbol), bar, min(limit, 500))
    out: list[list] = []
    for row in rows:
        try:
            out.append(
                [
                    int(row["time"]),
                    row["open"],
                    row["high"],
                    row["low"],
                    row["close"],
                    row.get("amount") or row["volume"],
                ]
            )
        except (TypeError, ValueError, KeyError):
            continue
    return out


@router.get("/klines/{symbol}")
async def klines(
    request: Request,
    symbol: str,
    # Дневные, недельные и месячные нужны не для отрисовки свечей, а ради
    # уровней прошлого периода: индикатор рисует их на любом таймфрейме.
    interval: str = Query("1m", pattern=r"^(1m|3m|5m|10m|15m|30m|1h|4h|1d|1w|1M)$"),
    limit: int = Query(240, ge=2, le=500),
    exchange: str = Query("", description="Биржа свечей; пусто - Binance"),
) -> dict[str, Any]:
    """Свечи для графика рядом со стаканом — из того же источника, что и книга.

    Биржа та же, что у стакана: оставить график на Binance рядом со своей
    книгой значит показать рядом две разные истории одной монеты
    (ТЗ мультибиржи, §4.4).
    """
    collector = get_collector(request)
    venue = (exchange or "").strip().lower()
    if venue and venue not in get_market(request).exchanges:
        venue = ""
    sym = symbol.upper()
    if not _SYMBOL.fullmatch(sym):
        raise HTTPException(422, "Неверный символ монеты")
    key = f"{venue or PRIMARY}:{sym}:{interval}:{limit}"

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
            if venue == "okx":
                raw = await okx_klines(request, sym, source, limit * factor)
            elif venue == "bingx":
                raw = await bingx_klines(request, sym, source, limit * factor)
            elif venue == "mexc":
                raw = await mexc_klines(request, sym, source, limit * factor)
            else:
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
            _remember_klines(key, now, rows)

    if not rows:
        if not venue and collector.rest.blocked:
            raise HTTPException(
                503,
                f"Биржа ограничила запросы, свечи появятся через "
                f"{collector.rest.blocked_for:.0f} с",
            )
        raise HTTPException(502, f"Свечи {sym} недоступны")
    return {"symbol": sym, "interval": interval, "exchange": venue or PRIMARY, "candles": rows}


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
# Пять секунд, а не две: страница сделок стоит двадцать единиц веса, а профиль
# внутри идущей свечи от двух лишних секунд не устаревает. Своя лента, когда
# она эту свечу закрывает, обновляет профиль восемь раз в секунду и даром.
_FOOT_LIVE_TTL = 5.0
_FOOT_DONE_TTL = 900.0
_FOOT_CACHE_MAX = 96
_foot_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()

# Сделки текущей свечи, уже выкачанные с биржи: когда свеча кончается, номер
# последней сделки и сами сделки. Следующий запрос дочитывает только новое.
#
# Без этого текущая свеча каждые две секунды выкачивалась заново с самого
# начала - до шести страниц по двадцать единиц веса. Две вкладки, смотрящие на
# одну свечу, выбирали так весь бюджет запросов за минуту, и стакан со свечами
# графика в эту минуту получали отказ.
_foot_live: dict[str, tuple[int, int, list[tuple[float, float, bool]], bool]] = {}


def _foot_live_prune(now: int) -> None:
    """Забыть сделки закрывшихся свечей: дальше их профиль отдаёт кэш."""
    for key in [k for k, v in _foot_live.items() if v[0] <= now]:
        _foot_live.pop(key, None)


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
    rest, symbol: str, start_ms: int, end_ms: int, from_id: int | None = None
) -> tuple[list[tuple[float, float, bool]], bool, int | None]:
    """Сделки за окно свечи постранично.

    Возвращает сделки, признак «окно неполно» и номер последней прочитанной
    сделки - с него следующий запрос дочитывает текущую свечу. `from_id` -
    начать не с начала свечи, а с этой сделки.

    Продолжение берём по номеру сделки, а не по времени: в одну миллисекунду
    попадает десяток сделок, и переход по времени терял бы часть из них на
    каждой границе страниц.
    """
    out: list[tuple[float, float, bool]] = []
    last: int | None = None

    for _ in range(_FOOT_PAGES):
        batch = await rest.agg_trades(symbol, start_ms, end_ms, from_id=from_id)
        if not batch:
            # Пустая страница — либо сделок больше нет, либо биржа отказала.
            # Отличать их здесь незачем: и там, и там читать дальше нечего.
            return out, False, last

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

        if last_id is not None:
            last = last_id
        if done or len(batch) < 1000 or last_id is None:
            return out, False, last
        from_id = last_id + 1

    return out, True, last


@router.get("/footprint/{symbol}")
async def footprint(
    request: Request,
    symbol: str,
    interval: str = Query("1m", pattern=r"^(1m|3m|5m|10m|15m|30m|1h)$"),
    at: int = Query(..., alias="time", ge=0, description="Начало свечи, секунды"),
    exchange: str = Query("", description="Биржа ленты; пусто - Binance"),
    rights: frozenset[str] = Depends(tool_rights),
) -> dict[str, Any]:
    """Объём внутри одной свечи: строки профиля и итоги.

    Инструмент маркета «Кластерная свеча»: без покупки - отказ.

    Крупнее часа профиля не даём: за сутки сделок миллионы, выкачивать их ради
    картинки нечестно по отношению к лимиту биржи, а строки такой свечи всё
    равно схлопнулись бы в неразличимую кашу.
    """
    if not tools.can_footprint(rights):
        raise HTTPException(403, "Кластерная свеча продаётся в маркете, в разделе «Инструменты»")
    collector = get_collector(request)
    market_state, venue = venue_state(request, exchange)
    sym = symbol.upper()
    seconds = FOOTPRINT_INTERVALS[interval]
    start = at - at % seconds
    end = start + seconds
    now = int(time.time())
    if start > now:
        raise HTTPException(400, "Эта свеча ещё не началась")

    state = market_state.get(sym)
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
            return _foot_payload(sym, interval, shot, source="tape", exchange=venue)

    # Своей ленты не хватило. Сделки Binance под книгу другой биржи не
    # подставить - это разные цены и разные объёмы, и профиль вышел бы чужим.
    # Поэтому у OKX добираем её собственные сделки, а у остальных бирж честно
    # отдаём пустую свечу до следующей, которую лента застанет целиком.
    if venue == OKX_VENUE:
        payload = await _okx_footprint(request, state, sym, interval, start, end, now)
        if payload is not None:
            return payload
    if venue != PRIMARY:
        shot = build_footprint({}, time=start, seconds=seconds, tick=0.0, partial=True)
        return _foot_payload(sym, interval, shot, source="tape", exchange=venue)

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

    # Текущую свечу дочитываем с последней уже скачанной сделки, а не заново:
    # обычно это одна страница вместо шести.
    live_candle = end > now
    _foot_live_prune(now)
    known = _foot_live.get(key) if live_candle else None
    if known is not None:
        _, last_id, earlier, _ = known
        fresh, partial, last = await _load_trades(
            collector.rest, sym, start * 1000, end * 1000, from_id=last_id + 1
        )
        trades = earlier + fresh
        if last is None:
            last = last_id
    else:
        trades, partial, last = await _load_trades(collector.rest, sym, start * 1000, end * 1000)
    if live_candle and last is not None:
        _foot_live[key] = (end, last, trades, partial)

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


OKX_VENUE = "okx"
# Страниц сделок OKX на одну свечу: по сотне в каждой. Предел открытой ручки -
# двадцать запросов за две секунды, и одна свеча не должна выбирать его весь.
_OKX_FOOT_PAGES = 8
_OKX_PAGE = 100


async def _load_okx_trades(
    rest, spec, start_ms: int, end_ms: int
) -> tuple[list[tuple[float, float, bool]], bool]:
    """Сделки OKX за окно свечи: список и признак «окно неполно».

    Первая страница - по времени конца свечи, чтобы не листать от сегодняшних
    сделок к вчерашним. Дальше - по номеру самой старой сделки страницы.
    Объём у OKX в контрактах; переводим в монеты, как это делает живая лента.
    """
    out: list[tuple[float, float, bool]] = []
    after: str | int = end_ms
    by_time = True
    for _ in range(_OKX_FOOT_PAGES):
        batch = await rest.history_trades(spec.inst_id, after=after, by_time=by_time)
        if not batch:
            return out, False
        oldest = ""
        done = False
        for row in batch:
            try:
                ts = int(row["ts"])
                oldest = str(row["tradeId"])
                if ts >= end_ms:
                    continue
                if ts < start_ms:
                    done = True
                    continue
                qty = spec.to_coins(float(row["sz"]))
                # Сторона у OKX - сторона тейкера: buy - по рынку покупали.
                out.append((float(row["px"]), qty, str(row.get("side") or "").lower() == "buy"))
            except (KeyError, TypeError, ValueError):
                continue
        if done or len(batch) < _OKX_PAGE or not oldest:
            return out, False
        after, by_time = oldest, False
    return out, True


async def _okx_footprint(
    request: Request, state, sym: str, interval: str, start: int, end: int, now: int
) -> dict[str, Any] | None:
    """Профиль свечи OKX её собственными сделками. `None` - добрать нечем."""
    collector = get_market(request).collector(OKX_VENUE)
    rest = getattr(collector, "rest", None)
    if collector is None or rest is None or not hasattr(rest, "history_trades"):
        return None

    key = f"{OKX_VENUE}:{sym}:{interval}:{start}"
    cached = _foot_cache.get(key)
    ttl = _FOOT_LIVE_TTL if end > now else _FOOT_DONE_TTL
    if cached and time.monotonic() - cached[0] < ttl:
        _foot_cache.move_to_end(key)
        return cached[1]

    specs = await collector.specs()
    spec = (specs or {}).get(inst_id(sym))
    if spec is None:
        return None

    trades, partial = await _load_okx_trades(rest, spec, start * 1000, end * 1000)
    seconds = FOOTPRINT_INTERVALS[interval]
    tick = detect_tick(state.book) if state else 0.0
    if tick <= 0:
        tick = spec.tick_sz or (guess_tick([p for p, _, _ in trades]) if trades else 0.0)
    cells = collect(trades, tick) if trades else {}
    shot = build_footprint(cells, time=start, seconds=seconds, tick=tick, partial=partial)
    payload = _foot_payload(sym, interval, shot, source="exchange", exchange=OKX_VENUE)
    _foot_remember(key, payload)
    return payload


def _foot_payload(
    symbol: str, interval: str, shot, source: str, exchange: str = PRIMARY
) -> dict[str, Any]:
    """Ответ клиенту. Строки тройками — по той же причине, что и у кластеров:
    ключи JSON обязаны быть строками, а str(1e-05) в Python и в JavaScript
    выглядит по-разному, и ячейки монет с мелким шагом просто не нашлись бы."""
    return {
        "symbol": symbol,
        "interval": interval,
        "exchange": exchange,
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
    """Состояние сборщиков — что под наблюдением и живы ли потоки бирж.

    По биржам, а не одной строкой: на девяти биржах наставнику нужно видеть,
    какая из них молчит, а не общее «всё хорошо» (ТЗ мультибиржи, §10.4).
    """
    collector = get_collector(request)
    ready = sum(1 for s in collector.state.values() if s.book.ready)
    market = get_market(request)
    venues = []
    for code in market.exchanges:
        one = market.collector(code)
        if one is None:
            # Биржа заведена, но её поток ещё ни разу не понадобился.
            venues.append({"exchange": code, "running": False, "connected": False, "tracked": []})
            continue
        venues.append(
            {
                "exchange": code,
                "running": True,
                "connected": bool(getattr(one, "connected", False))
                or bool(getattr(getattr(one, "stream", None), "connected", False)),
                "tracked": sorted(getattr(one, "tracked", ())),
                "books_ready": sum(1 for s in one.state.values() if s.book.ready),
            }
        )
    return {
        "connected": collector.stream.connected,
        "tracked": sorted(collector.tracked),
        "books_ready": ready,
        "streams": len(collector.stream.streams),
        # Сколько секунд биржа держит нас закрытыми. Ноль — всё в порядке;
        # больше нуля значит 418 или 429, и до конца паузы книги не соберутся.
        "throttled_for": round(collector.rest.blocked_for, 1),
        "venues": venues,
    }
