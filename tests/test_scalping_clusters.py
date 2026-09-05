"""Тесты истории кластеров: раскладка сделок по цене и времени."""

from __future__ import annotations

from backend.scalping.clusters import ClusterHistory, fit_to_rows


def make(tick: float = 0.1, bucket: int = 300, columns: int = 3) -> ClusterHistory:
    return ClusterHistory(tick=tick, bucket_seconds=bucket, columns=columns)


def test_trade_lands_in_price_and_time_cell():
    h = make()
    h.add(1_000_000, 100.04, 2.0, True)      # цена ложится на 100.0
    cols = h.snapshot()
    assert len(cols) == 1
    cell = cols[0].cells[100.0]
    assert cell.buy == 100.04 * 2.0 and cell.sell == 0.0


def test_buy_and_sell_are_kept_apart():
    """В референсе это две подколонки — складывать их нельзя."""
    h = make()
    h.add(1_000_000, 100.0, 1.0, True)
    h.add(1_000_000, 100.0, 3.0, False)
    cell = h.snapshot()[0].cells[100.0]
    assert cell.buy == 100.0 and cell.sell == 300.0
    assert cell.total == 400.0


def test_prices_snap_to_grid():
    """Соседние цены внутри одного шага попадают в одну ячейку."""
    h = make(tick=0.1)
    h.add(1_000_000, 100.02, 1.0, True)
    h.add(1_000_000, 99.98, 1.0, True)
    assert list(h.snapshot()[0].cells) == [100.0]


def test_columns_split_by_interval():
    h = make(bucket=300)
    h.add(0, 100.0, 1.0, True)               # интервал 0
    h.add(300_000, 100.0, 1.0, True)         # интервал 300
    h.add(600_000, 100.0, 1.0, True)         # интервал 600
    assert [c.start for c in h.snapshot()] == [0, 300, 600]


def test_oldest_column_is_dropped():
    h = make(bucket=300, columns=2)
    for i in range(4):
        h.add(i * 300_000, 100.0, 1.0, True)
    assert [c.start for c in h.snapshot()] == [600, 900]


def test_late_trade_from_dropped_interval_is_ignored():
    """Сделка из вытесненного интервала не должна воскрешать колонку."""
    h = make(bucket=300, columns=2)
    for i in range(4):
        h.add(i * 300_000, 100.0, 1.0, True)
    h.add(0, 100.0, 99.0, True)
    assert [c.start for c in h.snapshot()] == [600, 900]


# ── схлопывание под строки экрана ───────────────────────────────────────────

def test_fit_merges_cells_into_screen_rows():
    """Копим на шаге биржи, показываем на шаге экрана."""
    h = make(tick=0.1)
    h.add(1_000_000, 100.0, 1.0, True)
    h.add(1_000_000, 100.1, 2.0, True)
    h.add(1_000_000, 100.2, 1.0, False)

    fitted = fit_to_rows(h.snapshot(), row_prices=[100.0, 101.0], step=1.0)
    cell = fitted[0].cells[100.0]
    assert cell.buy == 100.0 + 200.2
    assert cell.sell == 100.2


def test_fit_keeps_totals_even_for_offscreen_prices():
    """Итог интервала — полный оборот, а не только его видимая часть."""
    h = make(tick=0.1)
    h.add(1_000_000, 100.0, 1.0, True)
    h.add(1_000_000, 900.0, 2.0, False)

    fitted = fit_to_rows(h.snapshot(), row_prices=[100.0], step=1.0)
    assert list(fitted[0].cells) == [100.0]
    assert fitted[0].buy == 100.0 and fitted[0].sell == 1800.0


def test_fit_drops_prices_further_than_half_step():
    h = make(tick=0.1)
    h.add(1_000_000, 105.0, 1.0, True)
    fitted = fit_to_rows(h.snapshot(), row_prices=[100.0, 101.0], step=1.0)
    assert fitted[0].cells == {}


def test_fit_without_rows_returns_totals_only():
    h = make(tick=0.1)
    h.add(1_000_000, 100.0, 1.0, True)
    fitted = fit_to_rows(h.snapshot(), row_prices=[], step=1.0)
    assert fitted[0].cells == {} and fitted[0].buy == 100.0


def test_bad_trades_are_ignored():
    h = make()
    h.add(1_000_000, 0.0, 1.0, True)
    h.add(1_000_000, 100.0, 0.0, True)
    assert h.snapshot() == []


def test_zero_tick_collects_nothing():
    """Без шага цены раскладывать некуда — молча ничего не пишем."""
    h = make(tick=0.0)
    h.add(1_000_000, 100.0, 1.0, True)
    assert h.snapshot() == []


def test_tick_is_filled_in_when_book_arrives_later():
    """Монету открывают раньше, чем собрана книга — шаг тогда неизвестен.

    Если оставить его нулевым, история не копится вообще и колонки на экране
    остаются пустыми навсегда.
    """
    h = ClusterHistory(tick=0.0)
    h.add(1_000_000, 100.0, 1.0, True)
    assert h.snapshot() == []

    h.ensure_tick(0.1)
    h.add(1_000_000, 100.0, 1.0, True)
    assert h.snapshot()[0].cells[100.0].buy == 100.0


def test_ensure_tick_does_not_override_known_step():
    h = ClusterHistory(tick=0.1)
    h.ensure_tick(5.0)
    assert h.tick == 0.1
