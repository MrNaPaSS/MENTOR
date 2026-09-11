"""Кэшбэк трейдеру из партнёрской комиссии биржи.

Биржа платит NMNH партнёрскую комиссию с каждой сделки реферала, и часть её
возвращается трейдеру. Всё нужное для расчёта уже приходит в партнёрском
отчёте WEEX (getAffiliateCommission): по каждой строке - UID трейдера, время,
комиссия, которую он заплатил бирже (`fee`), и доля NMNH (`commission`).
Отдельный учёт исполнений для этого не нужен: цифры биржи и есть факт.

Здесь только арифметика - без базы и без сети, чтобы её можно было проверить
до последнего знака.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, Decimal, InvalidOperation

from core.weex.uid import clean_uid

# Сутки партнёрского отчёта WEEX считаются по UTC+8. Резать их по UTC значит
# разойтись с кабинетом партнёра на треть чужих суток.
REPORT_TZ = timezone(timedelta(hours=8))

# Точность начислений. Округляем вниз: переплатить трейдеру из своего кармана
# хуже, чем недоплатить долю цента, которая доедет в следующий раз.
QUANT = Decimal("0.00000001")
ZERO = Decimal(0)


@dataclass(frozen=True)
class Terms:
    """Условия кэшбэка, действующие в конкретные сутки.

    trader_share - доля трейдера от комиссии, которую он заплатил бирже.
    min_margin - сколько от той же комиссии NMNH оставляет себе при любом
    раскладе. Вместе они не дают кэшбэку съесть весь доход, когда биржа
    понижает партнёрскую ставку, а обещанная трейдеру доля остаётся прежней.
    """

    trader_share: Decimal
    min_margin: Decimal
    enabled: bool = True


NO_CASHBACK = Terms(trader_share=ZERO, min_margin=ZERO, enabled=False)


@dataclass(frozen=True)
class Version:
    """Условия и сутки, с которых они действуют. `ref` - строка в базе."""

    valid_from: str
    terms: Terms
    ref: int | None = None


@dataclass(frozen=True)
class DayTotal:
    """Комиссия одного трейдера за одни сутки отчёта."""

    uid: str
    day: str
    fee: Decimal
    commission: Decimal


@dataclass(frozen=True)
class Split:
    """Как делится партнёрская комиссия суток."""

    cashback: Decimal
    nmnh: Decimal
    # Сработал ли потолок: доля трейдера урезана, чтобы NMNH не ушёл в минус.
    capped: bool


def to_decimal(value: object) -> Decimal:
    """Число из отчёта биржи. Мусор даёт ноль, а не падение всего импорта."""
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return ZERO
    return number if number.is_finite() else ZERO


def report_day(ms: float) -> str:
    """Сутки отчёта (``YYYY-MM-DD`` по UTC+8) для метки времени в миллисекундах."""
    return datetime.fromtimestamp(ms / 1000, tz=REPORT_TZ).strftime("%Y-%m-%d")


def report_window(days: int, now: datetime | None = None) -> tuple[int, int]:
    """Последние ``days`` суток отчёта: с полуночи UTC+8 до текущего момента."""
    moment = (now or datetime.now(timezone.utc)).astimezone(REPORT_TZ)
    start = (moment - timedelta(days=max(days, 1) - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int(start.timestamp() * 1000), int(moment.timestamp() * 1000)


def first_day(days: int, now: datetime | None = None) -> str:
    """Первые сутки периода из ``days`` последних. ``first_day(1)`` - сегодня."""
    start_ms, _ = report_window(days, now)
    return report_day(start_ms)


def aggregate(rows: Iterable[dict], start_ms: int, end_ms: int) -> list[DayTotal]:
    """Сложить строки отчёта по трейдеру и суткам.

    Строк на одного трейдера за сутки бывает много - по строке на инструмент и
    тип сделки. Строки вне окна отбрасываются: не всякий источник соблюдает
    запрошенный период (мок, например, отдаёт всё, что знает).
    """
    sums: dict[tuple[str, str], tuple[Decimal, Decimal]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = clean_uid(row.get("uid"))
        try:
            ms = float(row.get("date"))
        except (TypeError, ValueError):
            continue
        if not uid or not (start_ms <= ms <= end_ms):
            continue

        key = (uid, report_day(ms))
        fee, commission = sums.get(key, (ZERO, ZERO))
        sums[key] = (
            fee + to_decimal(row.get("fee")),
            commission + to_decimal(row.get("commission")),
        )

    return [
        DayTotal(uid=uid, day=day, fee=fee, commission=commission)
        for (uid, day), (fee, commission) in sorted(sums.items())
    ]


def split(fee: Decimal, commission: Decimal, terms: Terms) -> Split:
    """Разделить партнёрскую комиссию суток между трейдером и NMNH.

    Кэшбэк - доля от комиссии трейдера, но не больше того, что остаётся от
    нашей комиссии после минимальной маржи. С чужого реферала биржа платит
    нам в разы меньше, и без потолка обещанная доля ушла бы из своего кармана.
    """
    if not terms.enabled or fee <= 0 or commission <= 0:
        return Split(cashback=ZERO, nmnh=commission, capped=False)

    wanted = fee * terms.trader_share
    ceiling = max(commission - fee * terms.min_margin, ZERO)
    cashback = min(wanted, ceiling).quantize(QUANT, rounding=ROUND_DOWN)
    return Split(cashback=cashback, nmnh=commission - cashback, capped=wanted > ceiling)


def version_on(versions: Sequence[Version], day: str) -> Version | None:
    """Условия на сутки: последняя версия, начавшая действовать не позже них.

    Версии с одной датой начала различаются порядком в списке: побеждает
    последняя, то есть заведённая позже.
    """
    current: Version | None = None
    for version in sorted(versions, key=lambda item: item.valid_from):
        if version.valid_from <= day:
            current = version
    return current
