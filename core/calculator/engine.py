"""Движок расчёта позиции под баланс ученика.

Единая реализация для бота и веб-эндпоинта ``/api/market/calculate``. Использует формулы из
``core.calculator.formulas`` и параметры из ``core.settings.Settings``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional

from core.settings import Settings, DEFAULT_SETTINGS
from core.calculator import formulas


class Mode(str, Enum):
    MODERATE = "moderate"
    TURBO = "turbo"


class Direction(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


# Максимально допустимое плечо по режиму (ТЗ §6).
MAX_LEVERAGE = {Mode.MODERATE: 25, Mode.TURBO: 400}


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


@dataclass
class TakeProfit:
    index: int
    percent: Decimal
    price: Decimal
    profit_usd: Decimal
    rr: Decimal  # profit / risk


@dataclass
class CalcResult:
    mode: Mode
    direction: Direction
    balance: Decimal
    leverage: int
    entry_price: Decimal
    margin_usd: Decimal
    position_size: Decimal
    sl_percent: Decimal
    sl_price: Decimal
    risk_usd: Decimal
    risk_percent_of_balance: Decimal
    margin_type: str
    take_profits: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    status: str = "ok"           # "ok" | "skipped"
    skip_reason: Optional[str] = None


def _price_at(entry: Decimal, percent: Decimal, direction: Direction, is_stop: bool) -> Decimal:
    """Цена на расстоянии ``percent`` % от входа с учётом направления.

    Для LONG: стоп ниже входа, тейки выше. Для SHORT — наоборот.
    """
    frac = percent / Decimal(100)
    up = entry * (Decimal(1) + frac)
    down = entry * (Decimal(1) - frac)
    if direction == Direction.LONG:
        return down if is_stop else up
    return up if is_stop else down


def _percent_from_price(entry: Decimal, price: Decimal) -> Decimal:
    """Дистанция в % между входом и заданной ценой (модуль)."""
    if entry == 0:
        return Decimal(0)
    return abs(price - entry) / entry * Decimal(100)


def calculate(
    mode,
    balance,
    entry_price,
    direction,
    leverage: Optional[int] = None,
    settings: Settings = DEFAULT_SETTINGS,
    sl_price=None,
    tp_prices: Optional[list] = None,
    min_order_usd=None,
) -> CalcResult:
    """Рассчитать позицию под баланс ученика.

    Параметры
    ---------
    mode : Mode | str           — режим (moderate/turbo)
    balance : число             — баланс ученика, USDT
    entry_price : число         — цена входа
    direction : Direction | str — LONG/SHORT
    leverage : int | None       — плечо; None → дефолт режима из настроек
    sl_price : число | None     — ручной стоп (цена); None → авто по %
    tp_prices : list|None        — ручные тейки (цены); None → авто по %
    min_order_usd : число|None  — мин. размер ордера WEEX (guardrail A-11)
    """
    mode = Mode(mode)
    direction = Direction(direction)
    balance = _d(balance)
    entry = _d(entry_price)

    if leverage is None:
        leverage = (
            settings.default_leverage_moderate
            if mode == Mode.MODERATE
            else settings.default_leverage_turbo
        )
    leverage = int(leverage)

    warnings: list = []

    # ── Валидация плеча ──
    max_lev = MAX_LEVERAGE[mode]
    if leverage > max_lev:
        warnings.append(f"Плечо {leverage}x превышает лимит {max_lev}x для режима — ограничено.")
        leverage = max_lev
    if leverage < 1:
        leverage = 1

    # ── Маржа и объём ──
    if mode == Mode.MODERATE:
        margin = formulas.moderate_margin(balance)
        sl_percent = formulas.moderate_sl_percent(settings)
        tp_percents = [
            settings.moderate_tp1_percent,
            settings.moderate_tp2_percent,
            settings.moderate_tp3_percent,
        ]
    else:
        margin = formulas.turbo_margin(balance, settings.turbo_margin_cap)
        sl_percent = formulas.turbo_sl_percent(leverage, settings)
        tp_percents = [
            settings.turbo_tp1_percent,
            settings.turbo_tp2_percent,
            settings.turbo_tp3_percent,
        ]

    position_size = margin * Decimal(leverage)

    # ── Стоп: авто или ручной ──
    if sl_price is not None:
        sl_price = _d(sl_price)
        sl_percent = _percent_from_price(entry, sl_price)
        # Проверка: ручной стоп не должен быть за ликвидацией (особенно турбо).
        liq = formulas.liquidation_distance_percent(leverage)
        if sl_percent >= liq:
            warnings.append(
                f"⚠️ Ручной стоп ({sl_percent:.2f}%) за ценой ликвидации (~{liq:.2f}%) — "
                f"позиция ликвидируется раньше срабатывания стопа."
            )
    else:
        sl_price = _price_at(entry, sl_percent, direction, is_stop=True)

    risk_usd = position_size * sl_percent / Decimal(100)
    risk_pct_balance = (risk_usd / balance * Decimal(100)) if balance > 0 else Decimal(0)

    # ── Тейк-профиты ──
    take_profits: list = []
    overrides = tp_prices or []
    for i, default_pct in enumerate(tp_percents):
        if i < len(overrides) and overrides[i] is not None:
            tp_price = _d(overrides[i])
            tp_pct = _percent_from_price(entry, tp_price)
        else:
            tp_pct = default_pct
            tp_price = _price_at(entry, tp_pct, direction, is_stop=False)
        profit = position_size * tp_pct / Decimal(100)
        rr = (profit / risk_usd) if risk_usd > 0 else Decimal(0)
        take_profits.append(
            TakeProfit(index=i + 1, percent=tp_pct, price=tp_price, profit_usd=profit, rr=rr)
        )

    # ── Предупреждения риска (A-04) ──
    if risk_pct_balance > settings.risk_warn_percent_of_balance:
        warnings.append(
            f"⚠️ Риск {risk_pct_balance:.1f}% от баланса превышает порог "
            f"{settings.risk_warn_percent_of_balance}% — повышенный риск."
        )
    if mode == Mode.TURBO and leverage >= 150:
        warnings.append(
            "⚠️ Высокое плечо: стоп очень узкий, рыночный шум может выбить позицию мгновенно."
        )

    result = CalcResult(
        mode=mode,
        direction=direction,
        balance=balance,
        leverage=leverage,
        entry_price=entry,
        margin_usd=margin,
        position_size=position_size,
        sl_percent=sl_percent,
        sl_price=sl_price,
        risk_usd=risk_usd,
        risk_percent_of_balance=risk_pct_balance,
        margin_type=settings.default_margin_type,
        take_profits=take_profits,
        warnings=warnings,
    )

    # ── Guardrail: минимальный размер ордера (A-11) ──
    if min_order_usd is not None and position_size < _d(min_order_usd):
        result.status = "skipped"
        result.skip_reason = (
            f"Баланс мал для этого сигнала: позиция {position_size:.2f}$ < "
            f"минимума {_d(min_order_usd):.2f}$."
        )

    return result
