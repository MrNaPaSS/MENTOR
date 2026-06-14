"""Тесты парсера сигнала (ТЗ §7)."""

from decimal import Decimal

import pytest

from core.parser import parse_signal


def test_minimal_signal():
    s = parse_signal("XLM LONG")
    assert s.is_valid
    assert s.symbol == "XLMUSDT"
    assert s.direction == "LONG"
    assert s.leverage is None
    assert s.entry_price is None
    assert s.stop_loss is None
    assert s.take_profits == []


def test_full_pair_not_double_suffixed():
    assert parse_signal("BTCUSDT SHORT").symbol == "BTCUSDT"


def test_direction_russian():
    assert parse_signal("ETH шорт").direction == "SHORT"
    assert parse_signal("ETH лонг").direction == "LONG"


@pytest.mark.parametrize("text", ["XLM LONG x20", "XLM LONG 20х", "XLM LONG плечо 20"])
def test_leverage_forms(text):
    s = parse_signal(text)
    assert s.leverage == 20
    assert "leverage" in s.found_fields


def test_entry_by_keyword():
    s = parse_signal("XLM LONG\nПлечо 20х\nВход 0.150\nКросс, лимит")
    assert s.entry_price == Decimal("0.150")
    assert s.entry_type == "limit"
    assert s.margin_type == "cross"


def test_bare_number_as_entry():
    s = parse_signal("XLM LONG 0.150")
    assert s.entry_price == Decimal("0.150")


def test_stop_and_takes_full():
    text = (
        "XLM LONG\nПлечо 20х\nВход 0.150\nСтоп 0.145\n"
        "ТП1 0.153\nТП2 0.157\nТП3 0.162\nКросс, лимит"
    )
    s = parse_signal(text)
    assert s.stop_loss == Decimal("0.145")
    assert s.take_profits == [Decimal("0.153"), Decimal("0.157"), Decimal("0.162")]
    assert s.entry_price == Decimal("0.150")


def test_takes_sequential_without_index():
    s = parse_signal("XLM LONG\nтейк 0.153\nтейк 0.157")
    assert s.take_profits == [Decimal("0.153"), Decimal("0.157")]


def test_comma_decimal():
    s = parse_signal("XLM LONG Вход 0,150")
    assert s.entry_price == Decimal("0.150")


def test_isolated_margin():
    assert parse_signal("XLM LONG изол").margin_type == "isolated"


def test_invalid_without_direction():
    s = parse_signal("XLM плечо 20")
    assert not s.is_valid
    assert any("направление" in e.lower() for e in s.errors)


def test_empty():
    s = parse_signal("")
    assert not s.is_valid
