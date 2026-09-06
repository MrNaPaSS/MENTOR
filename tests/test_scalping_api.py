"""Тесты HTTP- и WebSocket-слоя скальпинга.

Сборщик подменён заглушкой с заранее набитым состоянием: проверяется поведение
эндпоинтов и канала, а не биржа.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import scalping as scalping_api
from backend.scalping.ladder import build_ladder, detect_tick, group
from backend.scalping.metrics import Level
from backend.scalping.state import MarketState
from backend.ws import routes as ws_routes
from backend.ws.scalping_hub import ScalpingHub


class StubStream:
    connected = True
    streams = frozenset({"btcusdt@depth@100ms"})

    async def subscribe(self, streams):  # noqa: D102
        pass

    async def unsubscribe(self, streams):  # noqa: D102
        pass


class StubRest:
    """REST без сети: делает вид, что биржа нас не ограничивает."""

    blocked = False
    blocked_for = 0.0

    async def klines(self, symbol, interval="1m", limit=240):
        return []


class StubCollector:
    """Сборщик с готовым состоянием и без сети."""

    def __init__(self) -> None:
        self.rest = StubRest()
        self.state = MarketState()
        self.stream = StubStream()
        self.tracked = frozenset({"BTCUSDT"})
        self.pinned: list[str] = []
        self.unpinned: list[str] = []

        state = self.state.ensure("BTCUSDT")
        state.book.apply_snapshot(
            [["99.99", "2"], ["99.98", "1"], ["99.97", "40"], ["99.96", "1"], ["99.95", "1"]],
            [["100.01", "2"], ["100.02", "1"], ["100.03", "1"], ["100.04", "1"]],
            1,
        )
        state.last_price = 100.0
        state.quote_volume = 1_000_000.0

    async def pin(self, symbol: str) -> None:
        self.pinned.append(symbol)

    async def unpin(self, symbol: str) -> None:
        self.unpinned.append(symbol)


@pytest.fixture()
def app_and_collector():
    collector = StubCollector()
    app = FastAPI()
    app.include_router(scalping_api.router)
    app.include_router(ws_routes.router)
    app.state.scalping = collector
    app.state.scalping_hub = ScalpingHub(collector)  # type: ignore[arg-type]
    return app, collector


# ── HTTP ─────────────────────────────────────────────────────────────────────

def test_screener_returns_rows(app_and_collector):
    app, _ = app_and_collector
    with TestClient(app) as client:
        body = client.get("/api/scalping/screener").json()
    assert body["count"] == 1
    assert body["rows"][0]["symbol"] == "BTCUSDT"
    assert body["rows"][0]["volume_24h"] == 1_000_000.0


def test_screener_rejects_unknown_sort_gracefully(app_and_collector):
    """Неизвестная сортировка не должна ронять запрос — откатываемся к обычной."""
    app, _ = app_and_collector
    with TestClient(app) as client:
        body = client.get("/api/scalping/screener", params={"sort": "чепуха"}).json()
    assert body["sort"] == "volume"


def test_dom_returns_ladder(app_and_collector):
    app, _ = app_and_collector
    with TestClient(app) as client:
        body = client.get("/api/scalping/dom/btcusdt").json()
    assert body["symbol"] == "BTCUSDT"
    assert body["best_bid"] == 99.99 and body["best_ask"] == 100.01
    prices = [r["price"] for r in body["rows"]]
    assert prices == sorted(prices, reverse=True)   # стакан идёт сверху вниз


def test_dom_shelf_threshold_is_bounded(app_and_collector):
    """Порог полки приходит от клиента, но в разумных границах.

    Ниже ста тысяч полкой становится любой уровень, и график превращается в
    частокол; выше пятидесяти миллионов не остаётся ни одной даже на биткойне.
    """
    app, _ = app_and_collector
    with TestClient(app) as client:
        assert client.get("/api/scalping/dom/btcusdt", params={"shelf": 1}).status_code == 422
        assert (
            client.get("/api/scalping/dom/btcusdt", params={"shelf": 1e12}).status_code == 422
        )
        assert (
            client.get("/api/scalping/dom/btcusdt", params={"shelf": 500_000}).status_code == 200
        )


def test_dom_unknown_symbol_is_404(app_and_collector):
    app, _ = app_and_collector
    with TestClient(app) as client:
        assert client.get("/api/scalping/dom/dogeusdt").status_code == 404


def test_dom_unready_book_is_503(app_and_collector):
    app, collector = app_and_collector
    collector.state.ensure("ETHUSDT")   # книга заведена, но снимок не пришёл
    with TestClient(app) as client:
        assert client.get("/api/scalping/dom/ethusdt").status_code == 503


def test_status_reports_collector(app_and_collector):
    app, _ = app_and_collector
    with TestClient(app) as client:
        body = client.get("/api/scalping/status").json()
    assert body["connected"] is True and body["tracked"] == ["BTCUSDT"]


def test_endpoints_are_503_without_collector():
    """Если сбор выключен, эндпоинты честно говорят об этом, а не падают."""
    app = FastAPI()
    app.include_router(scalping_api.router)
    app.state.scalping = None
    with TestClient(app) as client:
        assert client.get("/api/scalping/screener").status_code == 503


# ── WebSocket ────────────────────────────────────────────────────────────────

def test_ws_sends_frames_and_pins_symbol(app_and_collector):
    app, collector = app_and_collector
    with TestClient(app) as client:
        with client.websocket_connect("/ws/scalping") as ws:
            assert ws.receive_json()["event"] == "hello"
            ws.send_json({"action": "symbol", "symbol": "BTCUSDT", "rows": 10, "agg": 1})

            events = {ws.receive_json()["event"] for _ in range(3)}
    assert "dom" in events or "screener" in events
    assert collector.pinned == ["BTCUSDT"]


def test_ws_unpins_on_disconnect(app_and_collector):
    """Клиент ушёл — инструмент отпускается, иначе он копится в наблюдении."""
    app, collector = app_and_collector
    with TestClient(app) as client:
        with client.websocket_connect("/ws/scalping") as ws:
            ws.receive_json()
            ws.send_json({"action": "symbol", "symbol": "BTCUSDT"})
            ws.receive_json()
    assert collector.unpinned == ["BTCUSDT"]


def test_ws_closes_when_scalping_disabled():
    app = FastAPI()
    app.include_router(ws_routes.router)
    app.state.scalping_hub = None
    with TestClient(app) as client:
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/scalping") as ws:
                ws.receive_json()


# ── лестница ────────────────────────────────────────────────────────────────

def test_group_merges_levels_into_buckets():
    levels = [Level(100.0, 1.0), Level(99.9, 2.0), Level(99.0, 5.0)]
    assert group(levels, tick=1.0, side="bid", rows=5) == [(100.0, 1.0), (99.0, 7.0)]


def test_group_rounds_asks_upwards():
    """Аск округляем вверх: корзина не должна заезжать внутрь спреда."""
    assert group([Level(100.1, 1.0)], tick=1.0, side="ask", rows=5) == [(101.0, 1.0)]


def test_detect_tick_finds_exchange_grid():
    from backend.scalping.book import OrderBook

    b = OrderBook("X")
    b.apply_snapshot([["100.0", "1"], ["99.9", "1"]], [["100.1", "1"]], 1)
    assert detect_tick(b) == pytest.approx(0.1)


def test_ladder_marks_wall_row():
    """Крупная заявка отмечается в лестнице, чтобы её было видно на экране."""
    from backend.scalping.book import OrderBook

    b = OrderBook("X")
    b.apply_snapshot(
        [["99.99", "1"], ["99.98", "1"], ["99.97", "1"], ["99.96", "1"], ["99.95", "9000"]],
        [["100.01", "1"], ["100.02", "1"]],
        1,
    )
    rows, _ = build_ladder(b, rows=20)
    assert any(r.is_wall and r.bid > 0 for r in rows)


def test_ladder_is_empty_for_empty_book():
    from backend.scalping.book import OrderBook

    rows, step = build_ladder(OrderBook("X"))
    assert rows == [] and step == 0.0


# ── точность ценовой сетки ──────────────────────────────────────────────────

def test_detect_tick_survives_float_subtraction():
    """79591.8 - 79591.7 в двоичной арифметике даёт 0.09999999999417923.

    Если оставить зазор как есть, вся шкала стакана поедет и цены превратятся
    в 79603.2999928357 — на экране это нечитаемая каша.
    """
    from backend.scalping.book import OrderBook

    b = OrderBook("BTCUSDT")
    b.apply_snapshot(
        [["79591.7", "1"], ["79591.6", "1"]],
        [["79591.8", "1"], ["79591.9", "1"]],
        1,
    )
    assert detect_tick(b) == 0.1


def test_ladder_prices_stay_on_clean_grid():
    """Цены строк обязаны быть ровными: их читают глазами."""
    from backend.scalping.book import OrderBook

    b = OrderBook("BTCUSDT")
    bids = [[f"{79591.7 - i / 10:.1f}", "1"] for i in range(30)]
    asks = [[f"{79591.8 + i / 10:.1f}", "1"] for i in range(30)]
    b.apply_snapshot(bids, asks, 1)

    rows, step = build_ladder(b, rows=20, agg=1)
    assert step == 0.1
    for row in rows:
        assert row.price == round(row.price, 1), f"кривая цена: {row.price}"


def test_ladder_step_multiplier_is_exact():
    """0.1 * 3 в float даёт 0.30000000000000004 — сетка снова уехала бы."""
    from backend.scalping.book import OrderBook

    b = OrderBook("X")
    b.apply_snapshot([["100.0", "1"], ["99.9", "1"]], [["100.1", "1"], ["100.2", "1"]], 1)
    _, step = build_ladder(b, rows=10, agg=3)
    assert step == 0.3


def test_ladder_walls_match_screener_definition():
    """Подсветка в стакане и плита в списке — одно и то же понятие.

    Иначе заголовок сообщает про заявку на десять миллионов, а золотом горят
    соседние сто тысяч, и подсветка перестаёт что-либо значить.
    """
    from backend.scalping.book import OrderBook
    from backend.scalping.state import SymbolState, biggest_wall

    b = OrderBook("BTCUSDT")
    # Полоса метрик — 25 б.п., это примерно ±0.25 при цене 100.
    bids = [[f"{99.99 - i / 100:.2f}", "1"] for i in range(20)]
    bids[10] = ["99.89", "80000"]          # плита в полосе
    asks = [[f"{100.01 + i / 100:.2f}", "1"] for i in range(20)]
    b.apply_snapshot(bids, asks, 1)

    rows, _ = build_ladder(b, rows=40, agg=1)
    lit = {r.price for r in rows if r.is_wall}

    state = SymbolState(symbol="BTCUSDT", book=b)
    wall = biggest_wall(state)
    assert wall is not None
    assert wall.price in lit


# ── имбаланс по настройкам заказчика ────────────────────────────────────────

def test_imbalance_marks_dominant_side():
    """Сравниваются уровни на одинаковом удалении от спреда, а не соседние.

    Порог 300% взят из рабочего пространства заказчика: это его основной
    визуальный сигнал, а не абсолютный размер заявки.
    """
    from backend.scalping.ladder import mark_imbalance

    bids = [(100.0, 30.0), (99.0, 1.0)]
    asks = [(101.0, 1.0), (102.0, 50.0)]
    strong_bids, strong_asks = mark_imbalance(bids, asks)
    assert strong_bids == {100.0}      # первый бид втрое тяжелее первого аска
    assert strong_asks == {102.0}      # второй аск втрое тяжелее второго бида


def test_imbalance_ignores_empty_opposite_side():
    """Против пустоты перевешивает что угодно — это не сигнал."""
    from backend.scalping.ladder import mark_imbalance

    strong_bids, strong_asks = mark_imbalance([(100.0, 5.0)], [(101.0, 0.0)])
    assert strong_bids == set() and strong_asks == set()


def test_ladder_rows_carry_imbalance_flag():
    from backend.scalping.book import OrderBook

    b = OrderBook("X")
    b.apply_snapshot([["99.99", "300"], ["99.98", "1"]], [["100.01", "1"], ["100.02", "1"]], 1)
    rows, _ = build_ladder(b, rows=10, agg=1)
    assert any(r.strong and r.bid > 0 for r in rows)


def test_candles_say_when_the_exchange_throttles_us(app_and_collector):
    """Пустой график с 502 выглядит как поломка. Причину надо назвать."""
    app, collector = app_and_collector
    collector.rest.blocked = True
    collector.rest.blocked_for = 900.0

    with TestClient(app) as client:
        res = client.get("/api/scalping/klines/BTCUSDT")

    assert res.status_code == 503
    assert "Биржа ограничила запросы" in res.json()["detail"]
