"""Предел позиции на плече: запоминаем то, что назвала биржа.

WEEX держит предел позиции ступенями: чем выше плечо, тем меньше позиция.
В справочнике инструментов (`exchangeInfo`) ступеней нет - там один
`maxPositionSize`, и он больше того, что биржа пустит на ×100. Открытой ручки
со ступенями нет и в документации. Зато отказ «position exceed max size X for
leverage 'L'» называет предел точно. Его и запоминаем - общим для всех
учеников: предел принадлежит монете, а не счёту, и одного отказа хватает,
чтобы следующий ученик его уже не получил.

Ступени монотонны: предел на ×L верен и для любого плеча выше L - там он не
больше. Поэтому на запрошенном плече берём наименьший из пределов, узнанных на
плечах не выше него.

Предел биржа считает по всему, что стоит на монете: открытая позиция, ждущие
заявки и новая заявка вместе. Поэтому свободное место - это предел минус
занятое, а не сам предел.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.models import LeverageCap, utcnow

logger = logging.getLogger("nmnh.trading.caps")

# Сколько верим запомненному пределу. Биржа меняет ступени объявлениями раз в
# несколько месяцев; устаревший предел занижал бы сумму, которую уже можно.
FRESH_FOR = timedelta(days=14)


def learn(session, symbol: str, leverage: int, size: float) -> None:
    """Запомнить предел, названный биржей. Последний ответ биржи и есть правда."""
    if not (size > 0) or leverage < 1:
        return
    sym = symbol.upper()
    row = session.execute(
        select(LeverageCap)
        .where(LeverageCap.symbol == sym)
        .where(LeverageCap.leverage == int(leverage))
    ).scalar_one_or_none()
    if row is None:
        session.add(LeverageCap(symbol=sym, leverage=int(leverage), max_size=float(size)))
    else:
        row.max_size = float(size)
        row.updated_at = utcnow()
    try:
        session.commit()
    except IntegrityError:
        # Тот же предел записал соседний запрос - он и так в базе.
        session.rollback()
    logger.info("Предел %s на x%d: %s", sym, leverage, size)


def caps_for(session, symbol: str) -> dict[int, float]:
    """Свежие пределы монеты: плечо -> наибольшая позиция в монете."""
    since = utcnow() - FRESH_FOR
    rows = session.execute(
        select(LeverageCap.leverage, LeverageCap.max_size, LeverageCap.updated_at)
        .where(LeverageCap.symbol == symbol.upper())
    ).all()
    out: dict[int, float] = {}
    for leverage, size, updated in rows:
        # SQLite отдаёт время без пояса - сравниваем как UTC.
        if updated is not None and updated.tzinfo is None:
            updated = updated.replace(tzinfo=since.tzinfo)
        if updated is None or updated >= since:
            out[int(leverage)] = float(size)
    return out


def cap_at(caps: dict[int, float], leverage: int) -> float | None:
    """Предел на этом плече: наименьший из узнанных на плечах не выше него."""
    known = [size for lev, size in caps.items() if lev <= leverage and size > 0]
    return min(known) if known else None


def room_note(
    *, quantity: float, cap: float, used: float, leverage: int, coin: str, step: float
) -> str | None:
    """Объяснение отказа до отправки или None, если заявка помещается.

    Полшага запаса: объём на бирже округляется шагом лота, и заявка ровно в
    предел не должна отклоняться нашей же проверкой.
    """
    room = cap - used
    if quantity <= room + step / 2:
        return None
    free = max(room, 0.0)
    return (
        f"На ×{leverage} биржа держит по {coin} не больше {cap:g}. "
        f"Уже занято {used:g} - открытая позиция и заявки по монете, "
        f"свободно {free:g}. Уменьшите сумму или плечо, либо снимите лишние заявки."
    )
