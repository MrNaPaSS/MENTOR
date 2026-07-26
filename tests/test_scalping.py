"""Тесты скальпинг-эндпоинта: агрегация стакана, имбаланс, плиты, дельта."""

from __future__ import annotations

import pytest

from backend.api.scalping import (
    aggregate,
    detect_grid,
    find_walls,
    mark_imbalance,
    parse_levels,
    tape_metrics,
    _resolve_tick,
)


# ── parse_levels ─────────────────────────────────────────────────────────────

def test_parse_levels_accepts_both_shapes():
    """WEEX отдаёт уровни то массивом, то объектом — разбираем оба варианта."""
    assert parse_levels([["100.5", "2"]]) == [(100.5, 2.0)]
    assert parse_levels([{"price": "100.5", "size": "2"}]) == [(100.5, 2.0)]
    assert parse_levels([{"p": "100.5", "s": "2"}]) == [(100.5, 2.0)]


def test_parse_levels_drops_garbage():
    """Нули и мусор не должны попадать в стакан — иначе ломают масштаб."""
    raw = [["100", "1"], ["0", "5"], ["101", "0"], ["abc", "1"], None, ["102"]]
    assert parse_levels(raw) == [(100.0, 1.0)]


def test_parse_levels_on_non_list():
    assert parse_levels(None) == []
    assert parse_levels({"bids": []}) == []


# ── aggregate ────────────────────────────────────────────────────────────────

def test_aggregate_merges_into_buckets():
    """Три уровня внутри одного шага должны схлопнуться в одну строку."""
    levels = [(100.1, 1.0), (100.4, 2.0), (100.9, 3.0)]
    out = aggregate(levels, tick=1.0, side="bid", rows=10)
    assert len(out) == 1
    assert out[0]["price"] == 100.0
    assert out[0]["size"] == 6.0


def test_aggregate_bid_rounds_down_ask_rounds_up():
    """Округление не должно затягивать цену внутрь спреда."""
    bid = aggregate([(100.7, 1.0)], tick=1.0, side="bid", rows=5)
    ask = aggregate([(101.2, 1.0)], tick=1.0, side="ask", rows=5)
    assert bid[0]["price"] == 100.0
    assert ask[0]["price"] == 102.0


def test_aggregate_sort_direction():
    """Биды — по убыванию, аски — по возрастанию: лучшая цена всегда первой."""
    levels = [(100.0, 1.0), (102.0, 1.0), (101.0, 1.0)]
    bids = aggregate(levels, tick=1.0, side="bid", rows=5)
    asks = aggregate(levels, tick=1.0, side="ask", rows=5)
    assert [l["price"] for l in bids] == [102.0, 101.0, 100.0]
    assert [l["price"] for l in asks] == [100.0, 101.0, 102.0]


def test_aggregate_cumulative():
    """Накопленный объём считается от лучшей цены — на нём строится гистограмма."""
    levels = [(100.0, 1.0), (101.0, 2.0), (102.0, 3.0)]
    out = aggregate(levels, tick=1.0, side="ask", rows=5)
    assert [l["cum"] for l in out] == [1.0, 3.0, 6.0]


def test_aggregate_respects_rows_limit():
    levels = [(100.0 + i, 1.0) for i in range(50)]
    assert len(aggregate(levels, tick=1.0, side="ask", rows=12)) == 12


def test_aggregate_zero_tick_keeps_exchange_grid():
    """tick=0 — не трогаем сетку биржи, отдаём как есть."""
    levels = [(100.11, 1.0), (100.12, 2.0)]
    out = aggregate(levels, tick=0, side="ask", rows=5)
    assert [l["price"] for l in out] == [100.11, 100.12]


def test_aggregate_empty():
    assert aggregate([], tick=1.0, side="bid", rows=10) == []


# ── mark_imbalance ───────────────────────────────────────────────────────────

def _lvl(price: float, size: float) -> dict:
    return {"price": price, "size": size, "cum": size}


def test_imbalance_marks_dominant_side():
    """При коэффициенте 140% перевес в 2 раза — сильный уровень."""
    bids = [_lvl(100.0, 10.0)]
    asks = [_lvl(101.0, 5.0)]
    mark_imbalance(bids, asks, 140)
    assert bids[0]["strong"] is True
    assert asks[0]["strong"] is False


def test_imbalance_below_threshold():
    """Перевес 130% ниже порога 140% — никто не сильный."""
    bids = [_lvl(100.0, 13.0)]
    asks = [_lvl(101.0, 10.0)]
    mark_imbalance(bids, asks, 140)
    assert bids[0]["strong"] is False
    assert asks[0]["strong"] is False


def test_imbalance_exactly_at_threshold():
    """Ровно на пороге — считаем сильным (сравнение нестрогое)."""
    bids = [_lvl(100.0, 14.0)]
    asks = [_lvl(101.0, 10.0)]
    mark_imbalance(bids, asks, 140)
    assert bids[0]["strong"] is True


def test_imbalance_uneven_sides_get_flag():
    """Хвост длинной стороны всё равно должен получить ключ strong."""
    bids = [_lvl(100.0, 1.0), _lvl(99.0, 1.0), _lvl(98.0, 1.0)]
    asks = [_lvl(101.0, 1.0)]
    mark_imbalance(bids, asks, 140)
    assert all("strong" in l for l in bids + asks)


# ── find_walls ───────────────────────────────────────────────────────────────

def test_find_walls_detects_outlier():
    """Плита — уровень кратно выше среднего по стороне."""
    levels = [_lvl(100.0, 1.0), _lvl(99.0, 1.0), _lvl(98.0, 20.0), _lvl(97.0, 1.0)]
    assert find_walls(levels) == [98.0]


def test_find_walls_none_when_flat():
    """Ровный стакан — плит нет."""
    levels = [_lvl(100.0 - i, 5.0) for i in range(6)]
    assert find_walls(levels) == []


def test_find_walls_needs_enough_levels():
    assert find_walls([_lvl(100.0, 99.0)]) == []


# ── tape_metrics ─────────────────────────────────────────────────────────────

def test_tape_delta():
    trades = [
        {"qty": 3.0, "isBuy": True},
        {"qty": 1.0, "isBuy": False},
    ]
    m = tape_metrics(trades)
    assert m["buy_volume"] == 3.0
    assert m["sell_volume"] == 1.0
    assert m["delta"] == 2.0
    assert m["buy_ratio"] == 0.75


def test_tape_empty_is_neutral():
    """Пустая лента — полоса давления посередине, а не деление на ноль."""
    m = tape_metrics([])
    assert m["buy_ratio"] == 0.5
    assert m["delta"] == 0.0


def test_tape_ignores_broken_rows():
    m = tape_metrics([{"qty": "abc", "isBuy": True}, {"qty": 2.0, "isBuy": True}])
    assert m["buy_volume"] == 2.0


# ── detect_grid / _resolve_tick ──────────────────────────────────────────────

def test_detect_grid_from_levels():
    """Шаг сетки — минимальный зазор между соседними уровнями стакана."""
    bids = [(10.0, 1.0), (9.5, 1.0)]
    asks = [(10.5, 1.0), (11.0, 1.0)]
    assert detect_grid("UNKNOWNUSDT", bids, asks) == 0.5


def test_detect_grid_falls_back_to_known_tick():
    """Один уровень — зазора нет, берём известный шаг пары."""
    assert detect_grid("BTCUSDT", [(10.0, 1.0)], []) == 0.1


def test_detect_grid_unknown_pair_without_levels():
    assert detect_grid("UNKNOWNUSDT", [], []) == 0.0


def test_resolve_tick_explicit_wins():
    assert _resolve_tick("BTCUSDT", 5.0, 10, [], []) == 5.0


def test_resolve_tick_keeps_exchange_grid_by_default():
    """agg=1 — сетку биржи не укрупняем, иначе узкий стакан схлопнется."""
    bids = [(10.0, 1.0), (9.5, 1.0)]
    asks = [(10.5, 1.0), (11.0, 1.0)]
    assert _resolve_tick("UNKNOWNUSDT", None, 1, bids, asks) == 0.5


def test_resolve_tick_applies_aggregation():
    bids = [(10.0, 1.0), (9.5, 1.0)]
    asks = [(10.5, 1.0), (11.0, 1.0)]
    assert _resolve_tick("UNKNOWNUSDT", None, 10, bids, asks) == 5.0


# ── эндпоинт целиком ─────────────────────────────────────────────────────────

@pytest.fixture()
def fake_weex(monkeypatch):
    """Подменяем поход в WEEX — тесты не должны ходить в сеть."""
    calls: list[str] = []

    async def _fake(path: str, params: dict | None = None):
        calls.append(path)
        if "depth" in path:
            return {
                "data": {
                    "bids": [["100.4", "5"], ["100.1", "3"], ["99.6", "1"]],
                    "asks": [["100.6", "2"], ["101.2", "4"], ["101.8", "1"]],
                }
            }
        if "trades" in path:
            return [
                {"price": "100.5", "qty": "2", "time": 1, "isBuyerMaker": False},
                {"price": "100.4", "qty": "1", "time": 2, "isBuyerMaker": True},
            ]
        return None

    monkeypatch.setattr("backend.api.scalping._weex", _fake)
    return calls


async def test_dom_endpoint_shape(fake_weex):
    from backend.api.scalping import dom

    r = await dom("btcusdt", rows=10, tick=1.0, imbalance_ratio=140, trades_limit=40)

    assert r["symbol"] == "BTCUSDT"
    assert r["best_bid"] == 100.0
    assert r["best_ask"] == 101.0
    assert r["mid"] == 100.5
    assert r["spread"] == 1.0
    assert len(r["trades"]) == 2
    assert r["tape"]["delta"] == 1.0
    # isBuyerMaker=False означает агрессивную покупку
    assert r["trades"][0]["isBuy"] is True
    assert 0 <= r["book_ratio"] <= 1


async def test_dom_endpoint_survives_no_trades(monkeypatch):
    """Лента может быть недоступна — стакан всё равно должен отдаться."""
    async def _fake(path: str, params: dict | None = None):
        if "depth" in path:
            return {"data": {"bids": [["100", "1"]], "asks": [["101", "1"]]}}
        return None

    monkeypatch.setattr("backend.api.scalping._weex", _fake)
    from backend.api.scalping import dom

    r = await dom("ethusdt", rows=10, tick=1.0, imbalance_ratio=140, trades_limit=40)
    assert r["trades"] == []
    assert r["tape"]["buy_ratio"] == 0.5


async def test_dom_endpoint_502_on_dead_weex(monkeypatch):
    from fastapi import HTTPException

    async def _fake(path: str, params: dict | None = None):
        return None

    monkeypatch.setattr("backend.api.scalping._weex", _fake)
    from backend.api.scalping import dom

    with pytest.raises(HTTPException) as e:
        await dom("btcusdt", rows=10, tick=1.0, imbalance_ratio=140, trades_limit=0)
    assert e.value.status_code == 502
