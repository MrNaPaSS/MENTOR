"""Тесты ядра скальпинга: стакан из диффов, плиты, перевес, лента."""

from __future__ import annotations

from backend.scalping.book import OrderBook
from backend.scalping.metrics import (
    Level,
    book_imbalance,
    find_walls,
    spread_bp,
)
from backend.scalping.tape import TapeWindow


# ── OrderBook: синхронизация со снимком и потоком ───────────────────────────

def _book() -> OrderBook:
    b = OrderBook("BTCUSDT")
    b.apply_snapshot([["100", "2"], ["99", "3"]], [["101", "1"], ["102", "4"]], 1000)
    return b


def test_snapshot_fills_book():
    b = _book()
    assert b.ready and b.best_bid == 100.0 and b.best_ask == 101.0
    assert b.mid == 100.5


def test_diff_covering_snapshot_is_applied():
    """Первое событие обязано накрывать lastUpdateId снимка."""
    b = _book()
    assert b.apply_diff({"U": 998, "u": 1005, "b": [["100", "5"]], "a": []}) is True
    assert b.bids[100.0] == 5.0
    assert b.last_update_id == 1005


def test_first_diff_with_gap_is_rejected():
    """Событие, начинающееся после снимка, означает потерю — нужен ресинк."""
    b = _book()
    assert b.apply_diff({"U": 1002, "u": 1010, "b": [], "a": []}) is False


def test_stale_diff_is_ignored_not_rejected():
    """Событие целиком старше снимка уже учтено — это не рассинхрон."""
    b = _book()
    assert b.apply_diff({"U": 900, "u": 950, "b": [["100", "9"]], "a": []}) is True
    assert b.bids[100.0] == 2.0  # снимок не тронут


def test_chain_breaks_on_missing_event():
    """Цепочка держится на pu == прошлый u; разрыв — ресинк."""
    b = _book()
    assert b.apply_diff({"U": 998, "u": 1005, "b": [], "a": []}) is True
    assert b.apply_diff({"pu": 1005, "U": 1006, "u": 1008, "b": [], "a": []}) is True
    assert b.apply_diff({"pu": 1099, "U": 1100, "u": 1102, "b": [], "a": []}) is False


def test_zero_size_removes_level():
    b = _book()
    b.apply_diff({"U": 998, "u": 1005, "b": [["99", "0"]], "a": [["102", "0"]]})
    assert 99.0 not in b.bids and 102.0 not in b.asks


def test_levels_are_ordered_from_best_price():
    b = _book()
    assert [l.price for l in b.levels("bid")] == [100.0, 99.0]
    assert [l.price for l in b.levels("ask")] == [101.0, 102.0]
    assert [l.price for l in b.levels("bid", limit=1)] == [100.0]


def test_diff_before_snapshot_is_rejected():
    """Без снимка применять поток нельзя."""
    assert OrderBook("BTCUSDT").apply_diff({"U": 1, "u": 2}) is False


# ── Плиты ────────────────────────────────────────────────────────────────────

def test_find_walls_detects_outlier_by_money():
    """Плита — уровень, кратно превосходящий медиану своей стороны."""
    levels = [Level(100.0, 1.0), Level(99.0, 1.0), Level(98.0, 60.0),
              Level(97.0, 1.0), Level(96.0, 1.0)]
    walls = find_walls(levels, "bid", mid=100.5, min_notional=100.0)
    assert [w.price for w in walls] == [98.0]
    assert walls[0].ratio >= 6.0
    assert walls[0].distance_bp > 0


def test_find_walls_ignores_small_money():
    """На неликвиде выброс в разы может быть парой долларов — не плита."""
    levels = [Level(1.0, 1.0), Level(0.9, 1.0), Level(0.8, 50.0), Level(0.7, 1.0)]
    assert find_walls(levels, "bid", mid=1.05) == []


def test_find_walls_needs_enough_levels():
    assert find_walls([Level(100.0, 99.0)], "bid", mid=100.0) == []


def test_find_walls_respects_money_floor():
    """Порог по умолчанию отсекает «плиты» на копеечных уровнях."""
    levels = [Level(100.0, 1.0), Level(99.0, 1.0), Level(98.0, 60.0),
              Level(97.0, 1.0), Level(96.0, 1.0)]
    assert find_walls(levels, "bid", mid=100.5) == []


def test_find_walls_ignores_top_of_book():
    """Лучшая заявка структурно крупнейшая — плитой она не считается.

    Иначе на BTC и ETH плита горела бы всегда и не значила ничего."""
    levels = [Level(100.0, 90.0), Level(99.0, 1.0), Level(98.0, 1.0),
              Level(97.0, 1.0), Level(96.0, 1.0)]
    assert find_walls(levels, "bid", mid=100.5, min_notional=100.0) == []


def test_walls_sorted_by_size():
    levels = [Level(100.5, 1.0), Level(100.0, 1.0), Level(99.0, 1.0), Level(98.0, 80.0),
              Level(97.0, 1.0), Level(96.0, 200.0), Level(95.0, 1.0)]
    walls = find_walls(levels, "bid", mid=100.5, min_notional=100.0)
    assert [w.price for w in walls] == [96.0, 98.0]


# ── Перевес и спред ──────────────────────────────────────────────────────────

def test_book_imbalance_favours_denser_side():
    bids = [Level(100.0, 30.0)]
    asks = [Level(101.0, 10.0)]
    assert book_imbalance(bids, asks) > 0.5


def test_book_imbalance_empty_is_neutral():
    """Пустой стакан — 0.5, а не 0: ноль читался бы как перекос в продажи."""
    assert book_imbalance([], []) == 0.5


def test_spread_bp():
    """0.1 при цене 100 — это примерно 10 базисных пунктов."""
    assert 9.9 < spread_bp(100.0, 100.1) < 10.1
    assert spread_bp(0, 100) == 0.0
    assert spread_bp(100, 0) == 0.0


# ── Лента ────────────────────────────────────────────────────────────────────

def test_tape_delta_and_ratio():
    t = TapeWindow()
    t.add(10_000, 100.0, 3.0, True)    # 300 в покупку
    t.add(10_500, 100.0, 1.0, False)   # 100 в продажу
    m = t.metrics(now_second=10)
    assert m.delta_notional == 200.0
    assert m.buy_ratio == 0.75
    assert m.volume_notional == 400.0


def test_tape_buckets_by_second():
    """Сделки одной секунды складываются в одну корзину."""
    t = TapeWindow()
    for i in range(5):
        t.add(10_000 + i * 100, 100.0, 1.0, True)
    assert len(t.buckets) == 1
    assert t.buckets[0].trades == 5


def test_tape_drops_old_buckets():
    t = TapeWindow(window_seconds=10)
    t.add(1_000, 100.0, 1.0, True)
    t.add(60_000, 100.0, 1.0, True)
    assert [b.second for b in t.buckets] == [60]


def test_tape_range_bp_measures_move():
    t = TapeWindow()
    t.add(10_000, 100.0, 1.0, True)
    t.add(11_000, 101.0, 1.0, True)
    m = t.metrics(now_second=11)
    assert 95 < m.range_bp < 105  # ~1% = ~100 б.п.


def test_tape_spike_needs_history():
    """На коротком окне сравнивать не с чем — всплеск ровно 1.0."""
    t = TapeWindow()
    t.add(10_000, 100.0, 1.0, True)
    assert t.metrics(now_second=10).spike == 1.0


def test_tape_spike_detects_burst():
    """Тихое окно, затем шквал в последнюю минуту — всплеск заметно выше 1."""
    t = TapeWindow()
    for sec in range(0, 600, 10):        # редкие сделки 10 минут
        t.add(sec * 1000, 100.0, 1.0, True)
    for i in range(300):                 # шквал в последнюю минуту
        t.add((600 + i % 60) * 1000, 100.0, 1.0, True)
    assert t.metrics(now_second=660).spike > 3.0


def test_tape_empty_metrics():
    from backend.scalping.tape import EMPTY_METRICS
    assert TapeWindow().metrics(now_second=0) is EMPTY_METRICS


def test_tape_ignores_bad_trades():
    t = TapeWindow()
    t.add(10_000, 0.0, 1.0, True)
    t.add(10_000, 100.0, 0.0, True)
    assert not t.buckets


def test_first_diff_is_checked_by_range_even_when_pu_present():
    """Фьючерсный поток всегда шлёт pu — первое событие всё равно проверяется
    по диапазону U..u, иначе книга не соберётся никогда."""
    b = _book()
    assert b.apply_diff({"pu": 777, "U": 998, "u": 1005, "b": [["100", "7"]], "a": []}) is True
    assert b.bids[100.0] == 7.0


def test_levels_in_band_cuts_far_prices():
    """Метрики считаются в полосе вокруг цены, а не по всей книге."""
    b = OrderBook("X")
    b.apply_snapshot(
        [["100", "1"], ["99.9", "1"], ["50", "1"]],
        [["100.1", "1"], ["150", "1"]],
        1,
    )
    # mid = 100.05, полоса 100 б.п. — это примерно +-1.0
    assert [l.price for l in b.levels_in_band("bid", 100)] == [100.0, 99.9]
    assert [l.price for l in b.levels_in_band("ask", 100)] == [100.1]


def test_prune_drops_far_levels():
    """Поток приносит далёкие уровни и не снимает их — книгу надо чистить."""
    b = OrderBook("X")
    b.apply_snapshot([["100", "1"], ["10", "5"]], [["101", "1"], ["900", "5"]], 1)
    assert b.prune(band_bp=100) == 2
    assert set(b.bids) == {100.0} and set(b.asks) == {101.0}


def test_prune_keeps_book_when_price_unknown():
    assert OrderBook("X").prune(band_bp=100) == 0


def test_walls_are_capped_per_side():
    """Плотный стакан выдаёт десяток формально проходящих уровней.

    Если показать все, подсвеченной окажется треть экрана и подсветка перестанет
    что-либо значить — как это и было в откаченной версии раздела.
    """
    levels = [Level(100.0, 1.0)] + [
        Level(100.0 - i / 100, 900.0 if i % 5 == 0 else 1.0) for i in range(1, 30)
    ]
    walls = find_walls(levels, "bid", mid=100.5, min_notional=100.0)
    assert len(walls) == 3      # крупных уровней пять, показываем три


def test_wall_limit_can_be_lifted():
    levels = [Level(100.0, 1.0)] + [
        Level(100.0 - i / 100, 900.0 if i % 5 == 0 else 1.0) for i in range(1, 30)
    ]
    assert len(find_walls(levels, "bid", mid=100.5, min_notional=100.0, limit=None)) == 5
