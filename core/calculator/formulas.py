"""Базовые формулы расчёта (канон — записанные формулы, решение A-11).

Все вычисления — в ``Decimal``. Маржа-сайзинг и адаптивный стоп турбо описаны в
docs/tz/signal-bot-tz.md §6 и docs/audit/AUDIT.md → A-11.
"""

from __future__ import annotations

from decimal import Decimal

from core.settings import Settings


def moderate_margin(balance: Decimal) -> Decimal:
    """Маржа умеренного режима: ``balance ** 0.55 * 1.8``."""
    return balance ** Decimal("0.55") * Decimal("1.8")


def turbo_margin(balance: Decimal, cap: Decimal) -> Decimal:
    """Маржа турбо режима с капом: ``min(balance ** 0.6 * 1.2, cap)``."""
    raw = balance ** Decimal("0.6") * Decimal("1.2")
    return min(raw, cap)


def liquidation_distance_percent(leverage: int) -> Decimal:
    """Примерная дистанция до ликвидации в % движения цены: ``100 / leverage``."""
    return Decimal(100) / Decimal(leverage)


def moderate_sl_percent(settings: Settings) -> Decimal:
    """Стоп умеренного режима — фиксированный % из настроек."""
    return settings.moderate_sl_percent


def turbo_sl_percent(leverage: int, settings: Settings) -> Decimal:
    """Адаптивный стоп турбо (A-11).

    Стоп держится с запасом до ликвидации:
    ``min(turbo_sl_percent, turbo_sl_buffer * 100 / leverage)``.
    Так стоп всегда срабатывает раньше ликвидации (а не оказывается за ней).
    """
    liq = liquidation_distance_percent(leverage)
    return min(settings.turbo_sl_percent, settings.turbo_sl_buffer * liq)
