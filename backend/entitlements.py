"""Функции платформы за монеты: что куплено и до какого срока.

Товар магазина с ключом функции (`ShopItem.feature`) не ждёт ментора: доступ
пишется сюда той же операцией, что и списание монет, и работает сразу. Ментор
нужен только там, где выдаёт человек, - менторство, разбор сделки.

Три вида доступа - по тому, как продаётся товар:

    навсегда - купил один раз, пользуешься всегда (выгрузка журнала);
    на срок  - действует N дней, повторная покупка продлевает (удвоение бонуса);
    заряды   - расходуются по одному (заморозка серии).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from core.models import Entitlement, ShopItem, utcnow

# Функции, которые платформа умеет выдавать сама. Товар с ключом не из этого
# списка не продаётся: списать монеты за то, чего нет, хуже, чем не продать.
FEATURES: dict[str, str] = {
    "streak_freeze": "Заморозка серии",
    "streak_boost": "Удвоение бонуса за серию",
    "journal_export": "Выгрузка журнала",
}


def _aware(value: datetime | None) -> datetime | None:
    # SQLite отдаёт время без пояса, а пишем мы его в UTC.
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_active(row: Entitlement, now: datetime | None = None) -> bool:
    now = now or utcnow()
    if row.permanent or (row.charges or 0) > 0:
        return True
    expires = _aware(row.expires_at)
    return expires is not None and expires > now


def _row(session, student_id: int, feature: str) -> Entitlement | None:
    return session.execute(
        select(Entitlement)
        .where(Entitlement.student_id == student_id)
        .where(Entitlement.feature == feature)
    ).scalar_one_or_none()


def has_feature(session, student_id: int, feature: str) -> bool:
    row = _row(session, student_id, feature)
    return row is not None and is_active(row)


def is_forever(item: ShopItem) -> bool:
    return not (item.charges or 0) and not (item.duration_days or 0)


def already_owned(session, student_id: int, item: ShopItem) -> bool:
    """Навсегда купленное второй раз не продаём: монеты ушли бы ни за что."""
    if not item.feature or not is_forever(item):
        return False
    row = _row(session, student_id, item.feature)
    return row is not None and bool(row.permanent)


def grant(session, student_id: int, item: ShopItem) -> Entitlement:
    """Выдать доступ по купленному товару. Коммит за вызывающим."""
    now = utcnow()
    row = _row(session, student_id, item.feature)
    if row is None:
        row = Entitlement(student_id=student_id, feature=item.feature, charges=0, permanent=False)
        session.add(row)

    if (item.charges or 0) > 0:
        row.charges = (row.charges or 0) + int(item.charges)
    elif (item.duration_days or 0) > 0:
        # Продление, а не замена: купивший раньше срока не теряет оставшиеся дни.
        current = _aware(row.expires_at)
        start = current if current is not None and current > now else now
        row.expires_at = start + timedelta(days=int(item.duration_days))
    else:
        row.permanent = True

    row.updated_at = now
    session.flush()
    return row


def use_charge(session, student_id: int, feature: str) -> bool:
    """Потратить один заряд. False - зарядов нет.

    Одним запросом с условием «зарядов больше нуля»: два одновременных
    списания не уведут счётчик в минус.
    """
    result = session.execute(
        update(Entitlement)
        .where(Entitlement.student_id == student_id)
        .where(Entitlement.feature == feature)
        .where(Entitlement.charges > 0)
        .values(charges=Entitlement.charges - 1, updated_at=utcnow())
        .execution_options(synchronize_session="fetch")
    )
    return (result.rowcount or 0) > 0


def active_for(session, student_id: int) -> list[Entitlement]:
    rows = session.execute(
        select(Entitlement).where(Entitlement.student_id == student_id)
    ).scalars().all()
    now = utcnow()
    return [row for row in rows if is_active(row, now)]
