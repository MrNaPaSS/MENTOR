"""Тесты инлайн-клавиатур и сервисов сигнала."""

from decimal import Decimal

from bot.keyboards import (
    audience_keyboard,
    confirm_keyboard,
    approve_keyboard,
    lang_keyboard,
    mode_keyboard,
    enter_trade_keyboard,
)
from bot.services import signal_service
from core.settings import DEFAULT_SETTINGS


def test_audience_keyboard_counts():
    kb = audience_keyboard({"all": 5, "moderate": 3, "turbo": 2})
    texts = [b.text for row in kb.inline_keyboard for b in row]
    assert any("5" in t for t in texts)
    assert any("3" in t for t in texts)


def test_other_keyboards_build():
    assert confirm_keyboard().inline_keyboard
    assert approve_keyboard(123).inline_keyboard[0][0].callback_data == "appr:123"
    assert lang_keyboard().inline_keyboard
    assert mode_keyboard().inline_keyboard
    kb = enter_trade_keyboard("Войти", "https://www.weex.com/ru/futures/XLMUSDT")
    assert kb.inline_keyboard[0][0].url.endswith("XLMUSDT")


# ── signal_service ──

class _Student:
    def __init__(self, mode, balance, turbo_leverage=None):
        self.mode = mode
        self.balance_usdt = Decimal(balance)
        self.turbo_leverage = turbo_leverage
        self.language = "ru"


def test_effective_leverage_default_by_mode():
    r = signal_service.ResolvedSignal(symbol="XLMUSDT", direction="LONG", entry_price=Decimal("0.15"))
    assert signal_service.effective_leverage(_Student("moderate", 1000), r, DEFAULT_SETTINGS) == 10
    assert signal_service.effective_leverage(_Student("turbo", 1000), r, DEFAULT_SETTINGS) == 100


def test_effective_leverage_turbo_override():
    r = signal_service.ResolvedSignal(symbol="XLMUSDT", direction="LONG", entry_price=Decimal("0.15"), leverage=50)
    # турбо-переопределение плеча учеником важнее плеча сигнала
    assert signal_service.effective_leverage(_Student("turbo", 1000, turbo_leverage=200), r, DEFAULT_SETTINGS) == 200


def test_resolved_signal_to_from_dict():
    r = signal_service.ResolvedSignal(
        symbol="XLMUSDT", direction="LONG", entry_price=Decimal("0.15"),
        leverage=20, manual_stop=Decimal("0.145"), manual_tps=[Decimal("0.153")],
    )
    restored = signal_service.ResolvedSignal.from_dict(r.to_dict())
    assert restored.symbol == "XLMUSDT"
    assert restored.entry_price == Decimal("0.15")
    assert restored.manual_stop == Decimal("0.145")
    assert restored.manual_tps == [Decimal("0.153")]


def test_reference_calc_levels():
    r = signal_service.ResolvedSignal(symbol="XLMUSDT", direction="LONG", entry_price=Decimal("100"), leverage=10)
    calc = signal_service.reference_calc(r, DEFAULT_SETTINGS, "moderate")
    assert calc.sl_price < calc.entry_price
    assert len(calc.take_profits) == 3


async def test_resolve_signal_fetches_price_when_missing():
    from core.parser import parse_signal
    from core.weex import get_weex_client

    parsed = parse_signal("XLM LONG")  # без цены входа
    r = await signal_service.resolve_signal(parsed, get_weex_client(use_mock=True), DEFAULT_SETTINGS)
    assert r.entry_price > 0  # подтянулась с (мок-)WEEX


async def test_resolve_signal_keeps_manual_entry():
    from core.parser import parse_signal
    from core.weex import get_weex_client

    parsed = parse_signal("XLM LONG вход 0.150")
    r = await signal_service.resolve_signal(parsed, get_weex_client(use_mock=True), DEFAULT_SETTINGS)
    assert r.entry_price == Decimal("0.150")
