"""Что человеку открыто: лучшее из реферала академии и подписки.

Источников доступа два, и они не отменяют друг друга (docs/tz/subscription-tz.md, §8):

* **реферал** - счёт на бирже зарегистрирован через академию. Терминал не
  стоит ничего и даёт всё: инструменты, любые подтверждённые биржи, полная
  история, монеты, возврат части комиссии;
* **подписка** - оплачено 49 или 99 USDT в месяц. Для тех, у кого счёт уже
  есть и переносить его они не будут.

Считается **лучшее из двух**, и это главное правило модуля. Подписчик, открывший
потом счёт через академию, ничего не теряет; реферал, у которого кончилась
подписка, тоже ничего не теряет - у него и так всё.

Третий случай важен не меньше и в ТЗ отдельной строкой не назван: человек, чей
счёт подтвердила академия, но реферальным он не стал. Он торгует сегодня, и
подписка не должна ничего у него отнять. Поэтому здесь нигде нет слова
«запретить»: модуль только добавляет права, а закрывает доступ по-прежнему тот,
кто закрывал его раньше.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select

from backend import subscriptions
from core.models import AcademyUid, ExchangeAccount, Student, utcnow

# Сколько бирж подключает реферал и подписчик Про: все, что мы поддерживаем.
# Предел подписки `terminal` - одна, и он единственный, кто его чувствует.
NO_LIMIT: int | None = None

# Глубина журнала у подписки `terminal`, в месяцах. 0 - вся история.
FULL_HISTORY = 0


@dataclass(frozen=True)
class Access:
    """Права ученика на момент вопроса."""

    # Пускать ли в торговлю вообще.
    terminal: bool
    # Сколько бирж он вправе подключить. None - предела от нас нет, решает
    # подтверждение академии, как было до подписки.
    exchange_limit: int | None
    # На сколько месяцев назад видна история сделок. 0 - вся.
    history_months: int
    # Инструменты терминала (то же, что даёт VIP).
    tools: bool
    # referral | subscription | both | academy | пусто
    source: str
    plan: str
    subscription_active: bool
    expiring_soon: bool
    paid_until: datetime | None


def effective_access(session, student: Student, now: datetime | None = None) -> Access:
    """Права ученика: лучшее из реферала и подписки."""
    subscription = subscriptions.state(session, student.id, now=now)
    plan = subscriptions.PLANS.get(subscription.plan) if subscription.active else None
    referral = bool(student.is_vip)
    academy = referral or _academy_confirmed_any(session, student.id)

    if referral and subscription.active:
        source = "both"
    elif referral:
        source = "referral"
    elif subscription.active:
        source = "subscription"
    elif academy:
        source = "academy"
    else:
        source = ""

    return Access(
        terminal=academy or subscription.active,
        # Предел появляется только у подписки и только пока она одна: реферал
        # и подтверждения академии предела от нас не имеют.
        exchange_limit=(plan.exchange_limit if plan and not referral else NO_LIMIT),
        history_months=(plan.history_months if plan and not referral and not academy else FULL_HISTORY),
        tools=referral or bool(plan and plan.tools),
        source=source,
        plan=subscription.plan if subscription.active else "",
        subscription_active=subscription.active,
        expiring_soon=subscription.expiring_soon,
        paid_until=subscription.paid_until,
    )


def _academy_confirmed_any(session, student_id: int) -> bool:
    """Подтвердила ли академия хоть один счёт этого ученика.

    Запрос здесь свой, а не из `backend/trading/accounts.py`: тот модуль сам
    спрашивает права, и импорт пошёл бы по кругу.
    """
    return session.scalars(
        select(AcademyUid.id).where(AcademyUid.student_id == student_id).limit(1)
    ).first() is not None


def connected_exchanges(session, student_id: int) -> set[str]:
    """Биржи, у которых ключи уже лежат. По ним считается предел подписки."""
    rows = session.scalars(
        select(ExchangeAccount.exchange).where(ExchangeAccount.student_id == student_id)
    ).all()
    return {str(code).strip().lower() for code in rows if code}


def may_add_exchange(session, student: Student, exchange: str, now: datetime | None = None) -> bool:
    """Открывает ли **подписка** подключение этой биржи.

    Отдельная функция, а не часть `effective_access`, потому что ответ зависит
    от того, что уже подключено. Уже подключённая биржа остаётся подключаемой
    всегда: ключи протухают и их меняют, и запертая кнопка означала бы позицию,
    которую нечем вести.
    """
    access = effective_access(session, student, now=now)
    if not access.subscription_active:
        return False
    if access.exchange_limit is None:
        return True
    code = str(exchange).strip().lower()
    connected = connected_exchanges(session, student.id)
    if code in connected:
        return True
    return len(connected) < access.exchange_limit


def history_limit_days(access: Access) -> int | None:
    """Глубина журнала в днях. None - предела нет."""
    if not access.history_months:
        return None
    return access.history_months * 30


def history_floor(session, student: Student, now: datetime | None = None) -> datetime | None:
    """Раньше этого момента журнал подписчику не показывается. None - весь.

    Предел стоит только у тарифа `terminal` и только пока он единственный
    источник. У реферала и у того, чей счёт подтвердила академия, история
    остаётся полной: она была полной вчера, и подписка не повод её укоротить.
    """
    days = history_limit_days(effective_access(session, student, now=now))
    if days is None:
        return None
    return (now or utcnow()) - timedelta(days=days)
