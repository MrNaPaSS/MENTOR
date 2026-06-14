"""Резолв сигнала и расчёт под учеников (чистая логика, без aiogram).

Шаги потока сигнала (ТЗ §3, §10.1): распарсенный текст → дозапрос цены/уровней с WEEX →
индивидуальный расчёт под каждого ученика.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from core.calculator import calculate, CalcResult, Mode, Direction
from core.parser import ParsedSignal
from core.settings import Settings
from core.weex.base import WeexClient


@dataclass
class ResolvedSignal:
    """Сигнал с заполненной ценой входа и (опционально) ручными уровнями."""

    symbol: str
    direction: str
    entry_price: Decimal
    entry_type: str = "market"
    margin_type: str = "cross"
    leverage: Optional[int] = None          # плечо ментора (None → дефолт по режиму ученика)
    manual_stop: Optional[Decimal] = None
    manual_tps: list = field(default_factory=list)
    target_audience: str = "all"

    def to_dict(self) -> dict:
        """Сериализация для хранения в FSM (Decimal → str)."""
        return {
            "symbol": self.symbol,
            "direction": self.direction,
            "entry_price": str(self.entry_price),
            "entry_type": self.entry_type,
            "margin_type": self.margin_type,
            "leverage": self.leverage,
            "manual_stop": str(self.manual_stop) if self.manual_stop is not None else None,
            "manual_tps": [str(x) for x in self.manual_tps],
            "target_audience": self.target_audience,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ResolvedSignal":
        return cls(
            symbol=data["symbol"],
            direction=data["direction"],
            entry_price=Decimal(data["entry_price"]),
            entry_type=data.get("entry_type", "market"),
            margin_type=data.get("margin_type", "cross"),
            leverage=data.get("leverage"),
            manual_stop=Decimal(data["manual_stop"]) if data.get("manual_stop") else None,
            manual_tps=[Decimal(x) for x in data.get("manual_tps", [])],
            target_audience=data.get("target_audience", "all"),
        )


async def resolve_signal(
    parsed: ParsedSignal, weex: WeexClient, settings: Settings
) -> ResolvedSignal:
    """Достроить сигнал: подтянуть цену входа с WEEX, если ментор её не указал."""
    entry = parsed.entry_price
    if entry is None:
        entry = await weex.get_price(parsed.symbol)
    return ResolvedSignal(
        symbol=parsed.symbol,
        direction=parsed.direction,
        entry_price=Decimal(entry),
        entry_type=parsed.entry_type,
        margin_type=parsed.margin_type,
        leverage=parsed.leverage,
        manual_stop=parsed.stop_loss,
        manual_tps=list(parsed.take_profits),
    )


def effective_leverage(student, resolved: ResolvedSignal, settings: Settings) -> int:
    """Плечо для конкретного ученика с учётом переопределения турбо."""
    if resolved.leverage:
        base = resolved.leverage
    else:
        base = (
            settings.default_leverage_turbo
            if student.mode == "turbo"
            else settings.default_leverage_moderate
        )
    if student.mode == "turbo" and student.turbo_leverage:
        base = student.turbo_leverage
    return int(base)


async def compute_for_student(
    resolved: ResolvedSignal, student, weex: WeexClient, settings: Settings
) -> CalcResult:
    """Индивидуальный расчёт позиции под баланс и режим ученика."""
    balance = student.balance_usdt if student.balance_usdt is not None else Decimal(0)
    leverage = effective_leverage(student, resolved, settings)
    min_order = await weex.get_min_order_usd(resolved.symbol)
    return calculate(
        mode=Mode(student.mode),
        balance=Decimal(balance),
        entry_price=resolved.entry_price,
        direction=Direction(resolved.direction),
        leverage=leverage,
        settings=settings,
        sl_price=resolved.manual_stop,
        tp_prices=resolved.manual_tps or None,
        min_order_usd=min_order,
    )


def reference_calc(resolved: ResolvedSignal, settings: Settings, mode: str = "moderate") -> CalcResult:
    """Эталонный расчёт уровней сигнала (для сохранения stop/tp в строку signals).

    Использует условный баланс — нас интересуют только цены уровней, а не суммы.
    """
    leverage = resolved.leverage or (
        settings.default_leverage_turbo if mode == "turbo" else settings.default_leverage_moderate
    )
    return calculate(
        mode=Mode(mode),
        balance=Decimal("1000"),
        entry_price=resolved.entry_price,
        direction=Direction(resolved.direction),
        leverage=leverage,
        settings=settings,
        sl_price=resolved.manual_stop,
        tp_prices=resolved.manual_tps or None,
    )
