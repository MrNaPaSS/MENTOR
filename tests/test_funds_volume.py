"""Оборот за день по исполнениям биржи.

По этой цифре ученик в календаре судит о своей работе, поэтому проверяется и
сам подсчёт, и то, что чужие дни в него не попадают.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.trading.funds import turnover_on


def ms(y: int, m: int, d: int, hh: int = 12) -> int:
    return int(datetime(y, m, d, hh, tzinfo=timezone.utc).timestamp() * 1000)


def test_turnover_sums_price_by_size():
    fills = [
        {"price": "100", "qty": "2", "time": ms(2026, 9, 8)},
        {"price": "50", "qty": "3", "time": ms(2026, 9, 8)},
    ]
    assert turnover_on(fills, "2026-09-08") == pytest.approx(100 * 2 + 50 * 3)


def test_other_days_do_not_get_in():
    """Лента приходит за несколько дней сразу - чужие в счёт не идут."""
    fills = [
        {"price": "100", "qty": "1", "time": ms(2026, 9, 7)},
        {"price": "100", "qty": "1", "time": ms(2026, 9, 8)},
        {"price": "100", "qty": "1", "time": ms(2026, 9, 9)},
    ]
    assert turnover_on(fills, "2026-09-08") == pytest.approx(100)


def test_sell_counts_as_turnover_too():
    """Оборот - это оборот: закрытие позиции тоже в него входит."""
    fills = [
        {"side": "BUY", "price": "100", "qty": "1", "time": ms(2026, 9, 8)},
        {"side": "SELL", "price": "110", "qty": "1", "time": ms(2026, 9, 8)},
    ]
    assert turnover_on(fills, "2026-09-08") == pytest.approx(210)


def test_fills_without_the_needed_fields_are_skipped():
    """Неполное исполнение пропускаем, а не считаем нулём и не падаем."""
    fills = [
        {"price": "100", "qty": "1", "time": ms(2026, 9, 8)},
        {"price": "100", "time": ms(2026, 9, 8)},          # нет объёма
        {"qty": "1", "time": ms(2026, 9, 8)},              # нет цены
        {"price": "100", "qty": "1"},                       # нет времени
        {"price": "нет", "qty": "1", "time": ms(2026, 9, 8)},
    ]
    assert turnover_on(fills, "2026-09-08") == pytest.approx(100)


def test_time_is_read_in_milliseconds():
    """Секунды вместо миллисекунд дали бы 1970 год и день мимо."""
    fills = [{"price": "100", "qty": "1", "time": ms(2026, 9, 8) // 1000}]
    assert turnover_on(fills, "2026-09-08") == 0


def test_empty_report_is_zero_not_a_crash():
    assert turnover_on([], "2026-09-08") == 0
