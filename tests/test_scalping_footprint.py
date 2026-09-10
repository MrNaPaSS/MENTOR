"""Тесты профиля объёма внутри свечи.

Ошибка здесь не выглядит ошибкой: экран покажет стройные столбики, просто не те.
Поэтому раскладка сделок по ценам, укрупнение строк и выбор источника —
собственная лента против запроса на биржу — проверяются числами.
"""

from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import scalping as scalping_api
from backend.scalping.clusters import ClusterHistory
from backend.scalping.footprint import (
    build,
    collect,
    fit_levels,
    from_columns,
    guess_tick,
)
from backend.scalping.state import MarketState


# ── раскладка сделок ─────────────────────────────────────────────────────────

def test_trades_land_on_the_exchange_grid():
    """Соседние цены внутри одного шага — это одна строка профиля."""
    cells = collect([(100.02, 1.0, True), (99.98, 2.0, True)], tick=0.1)
    assert list(cells) == [100.0]
    assert cells[100.0][0] == pytest.approx(100.02 + 99.98 * 2)


def test_aggressor_side_is_kept_apart():
    """Покупки и продажи в одной ячейке не складываются: в них весь смысл."""
    cells = collect([(100.0, 1.0, True), (100.0, 3.0, False)], tick=0.1)
    assert cells[100.0] == [100.0, 300.0]


def test_volume_is_counted_in_money():
    """Как и везде в разделе: строки разных монет иначе несопоставимы."""
    cells = collect([(50_000.0, 0.5, True)], tick=1.0)
    assert cells[50_000.0][0] == 25_000.0


def test_garbage_trades_are_ignored():
    cells = collect([(0.0, 1.0, True), (100.0, 0.0, True), (100.0, -1.0, False)], tick=0.1)
    assert cells == {}


def test_tick_is_guessed_from_the_trades_themselves():
    """Книги у монеты может не быть — шаг виден по самим сделкам."""
    assert guess_tick([100.1, 100.2, 100.4, 100.2]) == 0.1
    # Разность дробных чисел точной не бывает: шаг обязан остаться чистым.
    assert guess_tick([79591.7, 79591.8]) == 0.1
    assert guess_tick([100.0]) == 0.0


# ── укрупнение строк ─────────────────────────────────────────────────────────

def test_rows_go_from_the_top_price_down():
    """Тем же порядком, что и стакан рядом: читаются они вместе."""
    _, levels = fit_levels({100.0: [1.0, 0.0], 100.1: [2.0, 0.0]}, tick=0.1)
    assert [l.price for l in levels] == [100.1, 100.0]


def test_step_grows_until_rows_fit_the_screen():
    """Триста шагов цены на экран не помещаются — строки схлопываются."""
    cells = {round(100 + i * 0.1, 1): [1.0, 0.0] for i in range(300)}
    step, levels = fit_levels(cells, tick=0.1, max_levels=100)
    # Расчётного укрупнения втрое не хватило: корзины стоят на круглых ценах,
    # и крайняя из них поймала лишнюю строку — шаг доведён до четырёх.
    assert step == pytest.approx(0.4)
    assert len(levels) <= 100
    # Объём при этом никуда не делся — он только собрался в корзины покрупнее.
    assert sum(l.total for l in levels) == pytest.approx(300.0)


def test_step_stays_whole_number_of_exchange_ticks():
    """Половина шага биржи ценой не бывает: строки встали бы между ценами."""
    cells = {round(100 + i * 0.1, 1): [1.0, 0.0] for i in range(50)}
    step, _ = fit_levels(cells, tick=0.1, max_levels=20)
    assert step == pytest.approx(0.3)


def test_totals_are_counted_before_rows_are_folded():
    """Схлопывание — дело экрана; оборот свечи от него зависеть не может."""
    cells = {round(100 + i * 0.1, 1): [2.0, 1.0] for i in range(300)}
    shot = build(cells, time=60, seconds=60, tick=0.1, max_levels=10)
    assert shot.buy == pytest.approx(600.0)
    assert shot.sell == pytest.approx(300.0)
    assert shot.delta == pytest.approx(300.0)
    assert len(shot.levels) <= 10


def test_empty_candle_is_an_answer_not_a_crash():
    shot = build({}, time=60, seconds=60, tick=0.0)
    assert shot.levels == [] and shot.total == 0.0


# ── окно свечи в готовых кластерах ───────────────────────────────────────────

def test_only_columns_inside_the_candle_are_summed():
    history = ClusterHistory(tick=0.1, bucket_seconds=60, columns=8)
    history.add(60_000, 100.0, 1.0, True)     # минута 60 — внутри свечи
    history.add(120_000, 100.0, 2.0, True)    # минута 120 — тоже
    history.add(300_000, 100.0, 5.0, True)    # минута 300 — уже за краем
    cells = from_columns(history.snapshot(), start=60, end=300)
    assert cells[100.0][0] == pytest.approx(300.0)


def test_history_remembers_when_it_started():
    """Монету открыли в середине минуты — профиль этой минуты у нас обрезан."""
    history = ClusterHistory(tick=0.1)
    history.add(90_000, 100.0, 1.0, True)
    assert history.first_second == 90


# ── эндпоинт ─────────────────────────────────────────────────────────────────

class StubRest:
    """Биржа под рукой: отдаёт заготовленные страницы сделок."""

    blocked = False
    blocked_for = 0.0

    def __init__(self, pages: list[list[dict]] | None = None):
        self.pages = pages or []
        self.calls: list[dict] = []

    async def agg_trades(self, symbol, start_ms, end_ms, limit=1000, from_id=None):
        self.calls.append({"symbol": symbol, "from_id": from_id})
        if not self.pages:
            return []
        return self.pages.pop(0)


class StubCollector:
    def __init__(self, rest: StubRest):
        self.rest = rest
        self.state = MarketState()
        state = self.state.ensure("BTCUSDT")
        state.book.apply_snapshot([["99.9", "1"], ["99.8", "1"]], [["100.1", "1"]], 1)


def make_app(rest: StubRest) -> tuple[FastAPI, StubCollector]:
    collector = StubCollector(rest)
    app = FastAPI()
    app.include_router(scalping_api.router)
    app.state.scalping = collector
    return app, collector


def trade(price: float, qty: float, ts_ms: int, maker: bool = True) -> dict:
    return {"p": str(price), "q": str(qty), "T": ts_ms, "m": maker, "a": ts_ms}


def setup_function() -> None:
    """Кэш профилей общий на процесс — между тестами он не должен течь."""
    scalping_api._foot_cache.clear()
    scalping_api._foot_live.clear()


def test_live_candle_is_read_on_from_the_last_trade_not_from_its_start():
    """Текущая свеча дочитывается с последней сделки, а не выкачивается заново.

    Раньше каждые две секунды она выкачивалась с самого начала - до шести
    страниц по двадцать единиц веса, - и две вкладки на одной свече выбирали
    весь бюджет запросов к бирже: стакан и свечи графика получали отказ.
    """
    # Свеча должна оставаться текущей оба запроса: у края минуты подождём.
    if int(time.time()) % 60 > 55:
        time.sleep(5)
    start = (int(time.time()) // 60) * 60
    first = trade(100.0, 1.0, start * 1000 + 100)
    second = trade(100.1, 2.0, start * 1000 + 200)
    rest = StubRest([[first], [second]])
    app, _ = make_app(rest)

    with TestClient(app) as client:
        client.get("/api/scalping/footprint/btcusdt", params={"time": start})
        # Кэш ответа живёт две секунды - сбрасываем, чтобы спросить снова.
        scalping_api._foot_cache.clear()
        body = client.get("/api/scalping/footprint/btcusdt", params={"time": start}).json()

    # Второй раз - только новое, с сделки после последней прочитанной.
    assert [c["from_id"] for c in rest.calls] == [None, first["a"] + 1]
    # А в профиле обе.
    assert body["sell"] == pytest.approx(100.0 + 200.2)


def test_footprint_comes_from_our_own_tape_without_touching_the_exchange():
    rest = StubRest()
    app, collector = make_app(rest)
    start = (int(time.time()) // 60) * 60

    state = collector.state.ensure("BTCUSDT")
    state.clusters = ClusterHistory(tick=0.1)
    state.clusters.add(start * 1000, 100.0, 1.0, True)
    state.clusters.add(start * 1000 + 500, 100.1, 2.0, False)

    with TestClient(app) as client:
        body = client.get(
            "/api/scalping/footprint/btcusdt", params={"interval": "1m", "time": start}
        ).json()

    assert body["source"] == "tape"
    assert rest.calls == []          # ни одного запроса на биржу
    assert body["buy"] == pytest.approx(100.0)
    assert body["sell"] == pytest.approx(200.2)
    assert [row[0] for row in body["levels"]] == [100.1, 100.0]


def test_partial_history_is_not_passed_off_as_the_whole_candle():
    """Лента началась в середине свечи — по ней профиль строить нечестно."""
    rest = StubRest([[trade(100.0, 1.0, 0)]])
    app, collector = make_app(rest)
    start = (int(time.time()) // 60) * 60

    state = collector.state.ensure("BTCUSDT")
    state.clusters = ClusterHistory(tick=0.1)
    state.clusters.add((start + 30) * 1000, 100.0, 1.0, True)

    with TestClient(app) as client:
        body = client.get(
            "/api/scalping/footprint/btcusdt", params={"interval": "1m", "time": start}
        ).json()

    assert body["source"] == "exchange"
    assert rest.calls != []


def test_history_is_paged_by_trade_id_until_the_candle_ends():
    """Тысяча сделок на страницу — за минуту биткойна их бывает больше."""
    first = [trade(100.0, 1.0, 1000 + i) for i in range(1000)]
    second = [trade(100.1, 2.0, 5000), trade(100.0, 1.0, 61_000)]
    rest = StubRest([first, second])
    app, _ = make_app(rest)

    with TestClient(app) as client:
        body = client.get(
            "/api/scalping/footprint/btcusdt", params={"interval": "1m", "time": 0}
        ).json()

    assert [c["from_id"] for c in rest.calls] == [None, 1000 + 999 + 1]
    assert body["partial"] is False
    # Сделка из следующей минуты в свечу не попала.
    assert body["sell"] == pytest.approx(1000 * 100.0 + 200.2)


def test_candle_that_did_not_fit_is_marked_incomplete():
    """Показать половину объёма молча хуже, чем сказать, что он неполон."""
    pages = [[trade(100.0, 1.0, 1000 + i) for i in range(1000)] for _ in range(6)]
    rest = StubRest(pages)
    app, _ = make_app(rest)

    with TestClient(app) as client:
        body = client.get(
            "/api/scalping/footprint/btcusdt", params={"interval": "1m", "time": 0}
        ).json()

    assert body["partial"] is True
    assert len(rest.calls) == 6


def test_closed_candle_is_asked_from_the_exchange_once():
    rest = StubRest([[trade(100.0, 1.0, 1000)]])
    app, _ = make_app(rest)

    with TestClient(app) as client:
        client.get("/api/scalping/footprint/btcusdt", params={"time": 0})
        client.get("/api/scalping/footprint/btcusdt", params={"time": 0})

    assert len(rest.calls) == 1


def test_future_candle_is_refused():
    rest = StubRest()
    app, _ = make_app(rest)
    with TestClient(app) as client:
        answer = client.get(
            "/api/scalping/footprint/btcusdt",
            params={"time": int(time.time()) + 3600},
        )
    assert answer.status_code == 400


def test_intervals_above_an_hour_are_not_served():
    """За сутки сделок миллионы — выкачивать их ради картинки нечестно."""
    rest = StubRest()
    app, _ = make_app(rest)
    with TestClient(app) as client:
        answer = client.get(
            "/api/scalping/footprint/btcusdt", params={"interval": "1d", "time": 0}
        )
    assert answer.status_code == 422


# ── профиль в кадре стакана ─────────────────────────────────────────────────
#
# Живая свеча разбирается по своей ленте и уезжает клиенту тем же кадром, что
# и стакан: опрос раз в три секунды оставлял лестницу мёртвой картинкой рядом
# с бурлящим стаканом.


def test_live_footprint_rides_along_with_the_dom_frame():
    from backend.scalping.state import SymbolState
    from backend.ws.scalping_hub import _live_foot

    start = (int(time.time()) // 60) * 60
    state = SymbolState(symbol="BTCUSDT")
    state.clusters = ClusterHistory(tick=0.1)
    state.clusters.add(start * 1000, 100.0, 1.0, True)
    state.clusters.add(start * 1000 + 500, 100.1, 2.0, False)

    shot = _live_foot(state, "1m", start)

    assert shot is not None
    assert shot["time"] == start
    assert shot["buy"] == pytest.approx(100.0)
    assert shot["sell"] == pytest.approx(200.2)
    assert [row[0] for row in shot["levels"]] == [100.1, 100.0]


def test_live_footprint_stays_silent_while_nobody_opened_the_ladder():
    """Профиль тяжелее всего остального в кадре — без спроса его не шлём."""
    from backend.scalping.state import SymbolState
    from backend.ws.scalping_hub import _live_foot

    start = (int(time.time()) // 60) * 60
    state = SymbolState(symbol="BTCUSDT")
    state.clusters = ClusterHistory(tick=0.1)
    state.clusters.add(start * 1000, 100.0, 1.0, True)

    assert _live_foot(state, "1m", 0) is None


def test_live_footprint_gives_up_on_a_candle_the_tape_missed():
    """Лента началась посреди свечи — половину объёма выдавать за целое нельзя."""
    from backend.scalping.state import SymbolState
    from backend.ws.scalping_hub import _live_foot

    start = (int(time.time()) // 60) * 60
    state = SymbolState(symbol="BTCUSDT")
    state.clusters = ClusterHistory(tick=0.1)
    state.clusters.add((start + 30) * 1000, 100.0, 1.0, True)

    assert _live_foot(state, "1m", start) is None
