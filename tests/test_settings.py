"""Тесты Settings (сериализация/десериализация)."""

from decimal import Decimal

from core.settings import Settings, DEFAULT_SETTINGS


def test_defaults():
    assert DEFAULT_SETTINGS.turbo_margin_cap == Decimal("150")
    assert DEFAULT_SETTINGS.default_leverage_turbo == 100


def test_from_mapping_overrides_and_types():
    s = Settings.from_mapping({
        "turbo_margin_cap": "200",
        "balance_sync_interval": "15",
        "default_margin_type": "isolated",
        "unknown_key": "ignored",
    })
    assert s.turbo_margin_cap == Decimal("200")
    assert isinstance(s.balance_sync_interval, int) and s.balance_sync_interval == 15
    assert s.default_margin_type == "isolated"
    # Неизвестный ключ проигнорирован, остальные — дефолты.
    assert s.moderate_sl_percent == Decimal("1.5")


def test_from_mapping_empty_returns_defaults_equivalent():
    s = Settings.from_mapping({})
    assert s.turbo_margin_cap == DEFAULT_SETTINGS.turbo_margin_cap


def test_as_dict_roundtrip():
    data = DEFAULT_SETTINGS.as_dict()
    assert data["turbo_margin_cap"] == "150"
    restored = Settings.from_mapping(data)
    assert restored == DEFAULT_SETTINGS
