"""Канал скринера и стакана: рассылка по подписке.

Общий `ConnectionManager` шлёт событие всем подключённым — для сигналов и цен
это правильно. Здесь так нельзя: стакан обновляется десять раз в секунду, и
рассылать чужой инструмент каждому клиенту значит гонять мегабайты впустую.
Поэтому клиент явно говорит, какой стакан открыт, и получает только его.

Кадры собираются по таймеру, а не на каждое событие биржи: поток даёт до десяти
обновлений в секунду на инструмент, и слать их поштучно бессмысленно — глаз
столько не различает, а трафик и разбор JSON растут линейно.
"""

from __future__ import annotations

import asyncio
import time
import logging
from dataclasses import asdict

from backend.scalping.clusters import DEFAULT_COLUMNS
from backend.scalping.footprint import build as build_footprint, from_columns
from backend.scalping.ladder import DEFAULT_ROWS, build_ladder
from backend.scalping.metrics import SHELF_MIN_NOTIONAL
from backend.scalping.collector import KEEP_BAND_BP, ScalpingCollector
from backend.scalping.market_hub import PRIMARY, MarketHub
from backend.scalping.state import (
    BAND_BP,
    DEFAULT_SORT,
    biggest_wall,
    liquidity_shelves,
)

logger = logging.getLogger("nmnh.scalping.ws")

# Частоты отправки кадров. Стакан — плотно, список — заметно реже: он меняется
# медленнее, а строк в нём десятки.
DOM_FPS = 8.0
SCREENER_INTERVAL = 1.0

# Строк списка в кадре. Сборщик держит восемьдесят инструментов, и обрезать их
# вдвое по дороге к экрану смысла нет: строка весит около двухсот байт.
SCREENER_LIMIT = 100


class Subscription:
    """Что именно смотрит один клиент."""

    def __init__(self) -> None:
        self.symbol: str | None = None
        # Биржа, которую попросил клиент, и биржа, с которой книга идёт на
        # самом деле. Они расходятся, когда монеты на бирже ученика нет или её
        # поток у нас не заведён: подменять книгу молча нельзя.
        self.asked: str = ""
        self.venue: str = ""
        self.reason: str = ""
        self.rows: int = DEFAULT_ROWS
        self.agg: int = 1
        self.sort: str = DEFAULT_SORT
        self.shelf: float = SHELF_MIN_NOTIONAL
        # Таймфрейм графика: по нему складывается живая свеча.
        self.interval: str = "1m"
        # Начало разобранной свечи, секунды. Ноль - разбор закрыт, и профиль
        # в кадр не кладём: это самая тяжёлая его часть, а смотрят её не всегда.
        self.foot: int = 0
        self.screener: bool = True


class ScalpingHub:
    """Держит подписки клиентов и рассылает им кадры."""

    def __init__(self, collector: ScalpingCollector, market: MarketHub | None = None):
        self.collector = collector
        # Реестр бирж: у кого какая книга. Без него - одна биржа, как было до
        # мультибиржи; так хаб остаётся собираемым в тестах одним сборщиком.
        self.market = market or MarketHub(collector)
        self._subs: dict[object, Subscription] = {}
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    @property
    def clients(self) -> int:
        return len(self._subs)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="scalping-hub")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    # ── подписки ────────────────────────────────────────────────────────────

    async def connect(self, ws) -> None:
        async with self._lock:
            self._subs[ws] = Subscription()
        self.start()

    async def disconnect(self, ws) -> None:
        async with self._lock:
            sub = self._subs.pop(ws, None)
        if sub and sub.symbol:
            await self.market.unpin(sub.venue, sub.symbol)

    async def set_symbol(
        self,
        ws,
        symbol: str | None,
        rows: int,
        agg: int,
        shelf: float,
        interval: str = "1m",
        exchange: str = "",
    ) -> None:
        """Переключить клиента на другой стакан - на его бирже.

        Прошлый инструмент отпускаем, новый удерживаем: пока хоть один клиент
        на него смотрит, сборщик не выбросит его из наблюдения.

        Биржа приходит от клиента: ученик видит книгу той биржи, где торгует.
        Не вышло - реестр отдаёт Binance и называет причину, а кадр несёт её
        клиенту: подменять книгу молча нельзя (ТЗ мультибиржи, §4.4).
        """
        async with self._lock:
            sub = self._subs.get(ws)
        if sub is None:
            return

        old, new = sub.symbol, symbol.upper() if symbol else None
        asked = (exchange or "").strip().lower()
        sub.rows, sub.agg, sub.shelf, sub.interval = rows, agg, shelf, interval
        if old == new and asked == sub.asked:
            return

        was, venue = sub.symbol, sub.venue
        sub.symbol = new
        sub.asked = asked
        if new:
            pinned = await self.market.pin(asked, new)
            sub.venue, sub.reason = pinned.exchange, pinned.reason
        else:
            sub.venue, sub.reason = "", ""
        if was:
            await self.market.unpin(venue, was)

    async def set_foot(self, ws, at: int) -> None:
        """Какую свечу клиент разобрал на экране. Ноль - разбор закрыт.

        Профиль живой свечи идёт в кадре стакана, а не отдельным опросом:
        сделки в неё приходят каждую секунду, и лестница, обновляемая раз в
        три секунды, стоит на экране мёртвой рядом с бурлящим стаканом.
        """
        async with self._lock:
            sub = self._subs.get(ws)
        if sub:
            sub.foot = max(0, at)

    async def set_sort(self, ws, sort: str) -> None:
        async with self._lock:
            sub = self._subs.get(ws)
        if sub:
            sub.sort = sort

    # ── рассылка ────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        """Один цикл на всех: кадр стакана часто, список — раз в секунду."""
        tick = 1.0 / DOM_FPS
        since_screener = 0.0
        while True:
            try:
                await asyncio.sleep(tick)
                since_screener += tick
                send_screener = since_screener >= SCREENER_INTERVAL
                if send_screener:
                    since_screener = 0.0
                await self._broadcast(send_screener)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Сбой рассылки скальпинга: %s", exc)

    async def _broadcast(self, with_screener: bool) -> None:
        async with self._lock:
            targets = list(self._subs.items())
        if not targets:
            return

        # Кадр одинаков для всех, кто смотрит одно и то же, — считаем по разу.
        # Десять человек на биткойне с одинаковыми настройками это один расчёт
        # лестницы за такт, а не десять: собрать стакан дороже, чем отправить.
        # Ключ - пара «сортировка и биржа ученика»: список один и тот же, а
        # пометка чужих монет у каждой биржи своя.
        screener_cache: dict[tuple[str, str], dict] = {}
        dom_cache: dict[tuple[str, str, int, int, float, str, int], dict | None] = {}
        dead: list[object] = []

        for ws, sub in targets:
            try:
                if with_screener and sub.screener:
                    key = (sub.sort, sub.asked)
                    frame = screener_cache.get(key)
                    if frame is None:
                        frame = self._screener_frame(sub.sort, sub.asked)
                        screener_cache[key] = frame
                    await ws.send_json({"event": "screener", "payload": frame})
                if sub.symbol:
                    key = (
                        sub.venue,
                        sub.symbol,
                        sub.rows,
                        sub.agg,
                        sub.shelf,
                        sub.interval,
                        sub.foot,
                    )
                    if key in dom_cache:
                        dom = dom_cache[key]
                    else:
                        dom = self._dom_frame(sub)
                        dom_cache[key] = dom
                    if dom:
                        await ws.send_json({"event": "dom", "payload": dom})
            except Exception:  # noqa: BLE001 — соединение закрыто или битое
                dead.append(ws)

        for ws in dead:
            await self.disconnect(ws)

    def _screener_frame(self, sort: str, asked: str = "") -> dict:
        """Список монет и те из них, которых нет на бирже ученика.

        Сам список идёт с Binance: там все монеты и самый живой объём. Но
        торгует ученик на своей бирже, и монета, которой у неё нет, до сих пор
        выдавала себя только после нажатия - подменённой книгой. Честнее
        сказать это в самом списке.

        Пометки нет, пока справочник биржи не пришёл: пустой ответ означал бы,
        что чужой у нас весь список.
        """
        rows = self.collector.state.rows(sort=sort)[:SCREENER_LIMIT]
        frame = {"sort": sort, "rows": [asdict(r) for r in rows]}
        listed = self.market.listed(asked) if asked and asked != PRIMARY else None
        if listed is not None:
            frame["exchange"] = asked
            frame["absent"] = [r.symbol for r in rows if r.symbol not in listed]
        return frame

    def _dom_frame(self, sub: Subscription) -> dict | None:
        market = self.market.state_of(sub.venue or PRIMARY)
        state = market.get(sub.symbol or "") if market else None
        if state is None or not state.book.ready:
            return None
        # Порог крупной заявки в лестнице — тот же, что у полок на графике:
        # трейдер задаёт его один раз и видит одни и те же уровни в обоих местах.
        ladder, step = build_ladder(
            state.book, rows=sub.rows, agg=sub.agg, whale_notional=sub.shelf
        )
        wall = biggest_wall(state)
        # Срез кластеров снимаем один раз: он нужен и картинке слева от
        # стакана, и разбору свечи, а стоит перебора всех цен за восемь минут -
        # восемь раз в секунду это уже заметная работа.
        columns = state.clusters.snapshot() if state.clusters else []
        return {
            "symbol": state.symbol,
            # Чья это книга. Расходится с запрошенной - клиент подписывает
            # подмену: «на OKX этой монеты нет, показана книга Binance».
            "exchange": sub.venue or PRIMARY,
            "asked": sub.asked,
            "fallback": sub.reason,
            "tick": step,
            "best_bid": state.book.best_bid,
            "best_ask": state.book.best_ask,
            "mid": state.book.mid,
            "book_ratio": state.book_ratio,
            "rows": [asdict(r) for r in ladder],
            "wall": asdict(wall) if wall else None,
            "shelves": [
                asdict(s)
                for s in liquidity_shelves(
                    state, band_bp=_shelf_band(state, sub.rows, step), min_notional=sub.shelf, step=step
                )
            ],
            # Картинке слева от стакана - последние восемь колонок, как и было;
            # профиль свечи ниже берёт из тех же данных всю историю.
            "clusters": _clusters(state.clusters, ladder, step),
            # Живая свеча из ленты сделок: график рисует её сразу, не дожидаясь
            # следующего опроса истории.
            "candle": _live_candle(state, sub.interval),
            # Профиль разобранной свечи, если она открыта на экране.
            "foot": _live_foot(state, sub.interval, sub.foot, columns),
        }


def _shelf_band(state, rows: int, step: float) -> float:
    """Полоса поиска полок — та, что трейдер видит в стакане.

    Постоянные двадцать пять базисных пунктов годились, пока стакан показывал
    столько же. Но глубину и шаг задаёт сам трейдер: сорок строк по крупному
    шагу уходят заметно дальше, и линия к плите, до которой он смотрит,
    не появлялась. Дальше сохранённой книги не заглядываем — там пусто.
    """
    mid = state.book.mid
    if mid <= 0 or step <= 0:
        return BAND_BP
    visible_bp = (rows * step) / mid * 10_000
    return max(BAND_BP, min(visible_bp, KEEP_BAND_BP))


# Секунды в таймфрейме графика.
INTERVAL_SECONDS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "10m": 600,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
}


def _live_candle(state, interval: str) -> dict | None:
    """Текущая свеча по ленте сделок.

    Только для таймфреймов не длиннее часа: за более крупными мы не храним
    столько секунд, и они прекрасно доезжают историей по REST.
    """
    if state.candles is None:
        return None
    seconds = INTERVAL_SECONDS.get(interval)
    if not seconds:
        return None
    candle = state.candles.current(seconds, int(time.time() * 1000))
    if candle is None:
        return None
    return {
        "time": candle.time,
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
        "volume": candle.volume,
    }


def _live_foot(state, interval: str, at: int, columns: list | None = None) -> dict | None:
    """Профиль разобранной свечи по своей ленте.

    Считается из тех же кластеров, что и картинка слева от стакана, и стоит
    ноль запросов к бирже - поэтому уезжает клиенту с каждым кадром, а не раз
    в три секунды. Отдаём только свечу, которую лента застала целиком: с
    половиной объёма лестница врёт молча, а REST в этом случае доберёт сделки
    с биржи.
    """
    if at <= 0 or state.clusters is None or state.clusters.tick <= 0:
        return None
    seconds = INTERVAL_SECONDS.get(interval)
    if not seconds:
        return None
    start = at - at % seconds
    end = start + seconds
    first = state.clusters.first_second
    if not first or first > start:
        return None
    if columns is None:
        columns = state.clusters.snapshot()
    if not columns or columns[0].start > start:
        return None

    shot = build_footprint(
        from_columns(columns, start, end),
        time=start,
        seconds=seconds,
        tick=state.clusters.tick,
    )
    return {
        "time": shot.time,
        "seconds": shot.seconds,
        "tick": shot.tick,
        "buy": shot.buy,
        "sell": shot.sell,
        # Тройками - по той же причине, что и ячейки кластеров.
        "levels": [[l.price, l.buy, l.sell] for l in shot.levels],
    }


def _clusters(history, ladder, step) -> list[dict]:
    """История объёмов, схлопнутая под строки текущего экрана.

    Картинке слева от стакана - последние колонки. Раскладку по строкам
    история помнит сама (`ClusterHistory.fitted`): прошлые минуты между
    сдвигами цены не пересчитываются.
    """
    if history is None:
        return []
    prices = [row.price for row in ladder]
    columns = history.fitted(DEFAULT_COLUMNS, prices, step)
    return [
        {
            "start": column.start,
            "buy": column.buy,
            "sell": column.sell,
            # Тройками, а не словарём: ключи JSON обязаны быть строками, а
            # str(1e-05) в Python даёт "1e-05" против "0.00001" в JavaScript —
            # на монетах с мелким шагом ячейки просто не нашлись бы.
            "cells": [[price, cell.buy, cell.sell] for price, cell in column.cells.items()],
        }
        for column in columns
    ]
