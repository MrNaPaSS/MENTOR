"""Тесты калькулятора позиции (ТЗ §6, решения A-11)."""

from decimal import Decimal

import pytest

from core.calculator import calculate, Mode, Direction
from core.calculator import formulas
from core.settings import DEFAULT_SETTINGS


def approx(value, expected, rel=Decimal("0.01")):
    return abs(Decimal(value) - Decimal(str(expected))) <= abs(Decimal(str(expected))) * rel


# ── Формулы маржи (канон) ──

@pytest.mark.parametrize("balance,expected", [(200, 33.2), (1000, 80.4), (5000, 194.9)])
def test_moderate_margin_matches_formula(balance, expected):
    assert approx(formulas.moderate_margin(Decimal(balance)), expected)


@pytest.mark.parametrize("balance,expected", [(200, 28.8), (1000, 75.7), (2000, 114.8)])
def test_turbo_margin_matches_formula(balance, expected):
    assert approx(formulas.turbo_margin(Decimal(balance), DEFAULT_SETTINGS.turbo_margin_cap), expected)


def test_turbo_margin_cap_applies_for_large_balance():
    margin = formulas.turbo_margin(Decimal(100000), DEFAULT_SETTINGS.turbo_margin_cap)
    assert margin == DEFAULT_SETTINGS.turbo_margin_cap == Decimal("150")


# ── Адаптивный турбо-стоп (A-11) ──

@pytest.mark.parametrize("leverage,expected_sl", [(50, 0.5), (100, 0.5), (150, 1.0 / 3), (200, 0.25), (400, 0.125)])
def test_turbo_adaptive_stop_below_liquidation(leverage, expected_sl):
    sl = formulas.turbo_sl_percent(leverage, DEFAULT_SETTINGS)
    assert approx(sl, expected_sl, rel=Decimal("0.001"))
    # Главная гарантия: стоп строго ближе цены ликвидации.
    assert sl < formulas.liquidation_distance_percent(leverage)


def test_moderate_stop_is_fixed():
    res = calculate(Mode.MODERATE, balance=1000, entry_price=100, direction=Direction.LONG, leverage=10)
    assert res.sl_percent == DEFAULT_SETTINGS.moderate_sl_percent == Decimal("1.5")


# ── Полный расчёт ──

def test_moderate_long_full_result():
    res = calculate(Mode.MODERATE, balance=1000, entry_price=Decimal("100"), direction=Direction.LONG, leverage=10)
    assert approx(res.margin_usd, 80.4)
    assert res.position_size == res.margin_usd * 10
    # LONG: стоп ниже входа, тейки выше.
    assert res.sl_price < res.entry_price
    assert all(tp.price > res.entry_price for tp in res.take_profits)
    # risk = position * sl% / 100
    assert approx(res.risk_usd, res.position_size * Decimal("1.5") / 100)
    assert len(res.take_profits) == 3
    # RR первого тейка = profit/risk.
    tp1 = res.take_profits[0]
    assert approx(tp1.rr, tp1.profit_usd / res.risk_usd)


def test_short_inverts_price_direction():
    res = calculate(Mode.MODERATE, balance=1000, entry_price=Decimal("100"), direction=Direction.SHORT, leverage=10)
    # SHORT: стоп выше входа, тейки ниже.
    assert res.sl_price > res.entry_price
    assert all(tp.price < res.entry_price for tp in res.take_profits)


def test_leverage_above_max_is_clamped_with_warning():
    res = calculate(Mode.MODERATE, balance=1000, entry_price=100, direction=Direction.LONG, leverage=100)
    assert res.leverage == 25  # лимит умеренного
    assert any("превышает лимит" in w for w in res.warnings)


def test_min_order_guardrail_skips():
    res = calculate(
        Mode.MODERATE, balance=20, entry_price=100, direction=Direction.LONG,
        leverage=10, min_order_usd=1000,
    )
    assert res.status == "skipped"
    assert res.skip_reason is not None


def test_high_turbo_leverage_triggers_warning():
    # При плече >=150 стоп очень узкий — бот предупреждает о повышенном риске.
    res = calculate(Mode.TURBO, balance=1000, entry_price=100, direction=Direction.LONG, leverage=200)
    assert any("Высокое плечо" in w for w in res.warnings)


def test_adaptive_stop_keeps_turbo_risk_bounded():
    # Адаптивный стоп удерживает риск турбо ≈ margin * buffer независимо от плеча.
    r100 = calculate(Mode.TURBO, balance=1000, entry_price=100, direction=Direction.LONG, leverage=100)
    r200 = calculate(Mode.TURBO, balance=1000, entry_price=100, direction=Direction.LONG, leverage=200)
    assert approx(r100.risk_usd, r200.risk_usd, rel=Decimal("0.01"))


def test_manual_stop_beyond_liquidation_warns():
    # Турбо x200: ликвидация ~0.5%. Ручной стоп на 2% — за ликвидацией.
    res = calculate(
        Mode.TURBO, balance=1000, entry_price=Decimal("100"), direction=Direction.LONG,
        leverage=200, sl_price=Decimal("98"),  # -2%
    )
    assert any("ликвидаци" in w.lower() for w in res.warnings)
