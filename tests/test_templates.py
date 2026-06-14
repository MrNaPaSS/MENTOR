"""Тесты рендера сообщений и форматирования."""

from decimal import Decimal

from core.calculator import calculate, Mode, Direction
from core.templates import render_signal, weex_trade_url, fmt_money, fmt_price


def test_fmt_money_thousands():
    assert fmt_money(Decimal("1260"), 0) == "1,260"
    assert fmt_money(Decimal("18.9"), 1) == "18.9"
    assert fmt_money(Decimal("-5.5"), 1) == "-5.5"


def test_fmt_price_precision():
    assert fmt_price(Decimal("65000")) == "65000"
    assert fmt_price(Decimal("0.15230000")) == "0.1523"


def test_weex_url():
    assert weex_trade_url("XLMUSDT", "ru") == "https://www.weex.com/ru/futures/XLMUSDT"
    assert weex_trade_url("XLMUSDT", "en") == "https://www.weex.com/en/futures/XLMUSDT"


def test_render_moderate_ru_contains_key_blocks():
    calc = calculate(
        Mode.MODERATE, balance=342, entry_price=Decimal("0.1523"),
        direction=Direction.LONG, leverage=20,
    )
    msg = render_signal(calc, "XLMUSDT", entry_type="market", lang="ru")
    assert "XLMUSDT | LONG | x20 | Умеренный" in msg
    assert "Маржа:" in msg
    assert "TP1:" in msg and "TP3:" in msg
    assert "No Money No Honey" in msg


def test_render_turbo_en():
    calc = calculate(
        Mode.TURBO, balance=1000, entry_price=Decimal("0.1523"),
        direction=Direction.LONG, leverage=200,
    )
    msg = render_signal(calc, "XLMUSDT", lang="en")
    assert "TURBO" in msg
    assert "Targets" in msg
