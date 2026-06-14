"""Параметры расчёта — единый источник для бота и веб-панели ментора.

Соответствует таблице `settings` (docs/tz/signal-bot-tz.md §4.4). Все значения хранятся как
``Decimal``, чтобы расчёты были денежно-точными (решение A-09).
"""

from __future__ import annotations

from dataclasses import dataclass, asdict, fields
from decimal import Decimal


def _d(value) -> Decimal:
    """Безопасное приведение к Decimal (через str, чтобы не тащить float-погрешность)."""
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


@dataclass(frozen=True)
class Settings:
    """Глобальные параметры расчёта позиции.

    Дефолты совпадают с таблицей `settings` в ТЗ. В рантайме значения подгружаются из БД
    (см. core.models) и перекрывают дефолты.
    """

    # ── Умеренный режим ──
    moderate_sl_percent: Decimal = Decimal("1.5")
    moderate_tp1_percent: Decimal = Decimal("1.5")
    moderate_tp2_percent: Decimal = Decimal("3.0")
    moderate_tp3_percent: Decimal = Decimal("4.5")

    # ── Турбо режим ──
    turbo_sl_percent: Decimal = Decimal("0.5")
    # Доля от дистанции до ликвидации для адаптивного стопа (решение A-11).
    turbo_sl_buffer: Decimal = Decimal("0.5")
    turbo_tp1_percent: Decimal = Decimal("0.5")
    turbo_tp2_percent: Decimal = Decimal("1.0")
    turbo_tp3_percent: Decimal = Decimal("1.5")
    turbo_margin_cap: Decimal = Decimal("150")

    # ── Общие ──
    balance_sync_interval: int = 30
    default_leverage_moderate: int = 10
    default_leverage_turbo: int = 100
    default_margin_type: str = "cross"

    # ── Предупреждения риска (A-04) ──
    risk_warn_percent_of_balance: Decimal = Decimal("20")

    @classmethod
    def from_mapping(cls, data: dict) -> "Settings":
        """Собрать Settings из словаря (например, из таблицы settings в БД).

        Неизвестные ключи игнорируются; отсутствующие — берутся из дефолтов.
        Числовые поля приводятся к нужному типу.
        """
        known = {f.name: f for f in fields(cls)}
        kwargs = {}
        for key, raw in (data or {}).items():
            if key not in known:
                continue
            ftype = known[key].type
            if ftype == "int" or ftype is int:
                kwargs[key] = int(raw)
            elif ftype == "str" or ftype is str:
                kwargs[key] = str(raw)
            else:
                kwargs[key] = _d(raw)
        return cls(**kwargs)

    def as_dict(self) -> dict:
        """Сериализация (Decimal → str) для сохранения/передачи."""
        out = {}
        for key, value in asdict(self).items():
            out[key] = str(value) if isinstance(value, Decimal) else value
        return out


# Дефолтный неизменяемый экземпляр для тестов и расчётов «из коробки».
DEFAULT_SETTINGS = Settings()
