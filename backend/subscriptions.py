"""Подписка на терминал: счёт, начисление, продление, состояние.

Здесь считаются дни и деньги. Наблюдатель за сетью (`backend/payments/`) знает
только факт перевода и ничего не знает о тарифах; права по подписке считает
`effective_access` рядом с `entitlements`. Этот модуль - между ними.

Четыре правила, которые нельзя нарушать (docs/tz/subscription-tz.md, §7):

* **Оплата продлевает, а не заменяет.** Заплатил за десять дней до конца -
  получил тридцать дней сверх остатка, а не вместо него. То же правило уже
  действует в `entitlements.grant()` для товаров на срок.
* **Подарочная неделя - только новым и только раз.** В том числе после отмены
  и возвращения: подарок новому человеку, а не новому кругу подписки.
* **Один перевод - одно начисление.** Защита не в проверке «а не начисляли
  ли мы уже», а в `UNIQUE (tx_hash)`: проверку можно обойти гонкой, ограничение
  базы - нет.
* **Смена тарифа с ближайшего дня, без пересчёта остатка.** Разница в цене
  небольшая, а пересчёт даёт класс ошибок дороже самой выгоды.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import notifications
from backend.payments import bsc
from core.models import PaymentIntent, Student, Subscription, SubscriptionPayment

log = logging.getLogger("nmnh.subscription")


@dataclass(frozen=True)
class Plan:
    """Тариф: цены и то, что о нём знает платформа. Тексты - у бота и сайта."""

    code: str
    title: str
    # Цены за месяц и за год. Год дешевле двенадцати месяцев - на эту разницу
    # и показывается экономия.
    price_month: int
    price_year: int
    # Сколько бирж можно подключить и на сколько месяцев назад видна история.
    exchange_limit: int
    history_months: int
    # Открыты ли инструменты терминала (то же, что даёт VIP).
    tools: bool


PLANS: dict[str, Plan] = {
    "terminal": Plan(
        code="terminal",
        title="Терминал",
        price_month=49,
        price_year=500,
        exchange_limit=1,
        history_months=3,
        tools=False,
    ),
    "pro": Plan(
        code="pro",
        title="Про",
        price_month=99,
        price_year=1100,
        exchange_limit=5,
        history_months=0,  # 0 - вся история
        tools=True,
    ),
}

# Месяц подписки. Не календарный: тридцать дней одинаковы для всех, и человек,
# заплативший в феврале, не получает меньше заплатившего в марте.
PERIOD = timedelta(days=30)

# Год - календарные 365 дней, а не двенадцать наших месяцев: 360 дней вместо
# года человек прочитал бы как обман, и был бы прав.
YEAR = timedelta(days=365)

MONTHLY = "month"
YEARLY = "year"

PERIODS: dict[str, timedelta] = {MONTHLY: PERIOD, YEARLY: YEAR}

# Подарок новому - сверх первого оплаченного срока, и он зависит от срока:
# неделя за месяц, тридцать дней за год. Годовая оплата - это доверие вперёд на
# год, и отвечать на него той же неделей, что и за месяц, неправильно.
GIFT_MONTH = timedelta(days=7)
GIFT_YEAR = timedelta(days=30)

# Сколько держим бронь счёта. Час, а не полчаса: платят с биржи, где вывод
# обрабатывается дольше, чем из кошелька.
INVOICE_WINDOW = timedelta(minutes=60)

# Сколько попыток подобрать свободную сумму. Слотов миллион на каждый тариф,
# и занято из них в любой момент единицы: пять попыток - с большим запасом.
AMOUNT_TRIES = 5

# За сколько дней до конца предупреждаем. Льготного периода после окончания
# нет (решение владельца, 19 сентября 2026): торговля закрывается в тот же
# момент, поэтому предупреждение приходит заранее и не один раз.
WARN_BEFORE = timedelta(days=3)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """Время из базы с меткой пояса: SQLite отдаёт его голым."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def plan_of(code: str) -> Plan:
    plan = PLANS.get(str(code).strip().lower())
    if plan is None:
        raise ValueError(f"Неизвестный тариф: {code}")
    return plan


def period_of(code: str | None) -> str:
    """`month` или `year`. Пусто - месяц: так было до годовой подписки."""
    value = str(code or MONTHLY).strip().lower()
    if value not in PERIODS:
        raise ValueError(f"Неизвестный период оплаты: {code}")
    return value


def price_of(plan: Plan, period: str) -> int:
    return plan.price_year if period == YEARLY else plan.price_month


def savings(plan: Plan) -> dict:
    """Насколько год дешевле двенадцати месяцев - в деньгах и в процентах.

    Считается здесь, а не на странице тарифов: цена одна, и два места, где её
    умножают на двенадцать, однажды разойдутся.
    """
    twelve = plan.price_month * 12
    saved = twelve - plan.price_year
    return {
        "twelve_months": twelve,
        "saved_usd": saved,
        "saved_percent": round(saved * 100 / twelve) if twelve else 0,
        # Во сколько обходится месяц при годовой оплате: «как 41.67 в месяц».
        "per_month": round(plan.price_year / 12, 2),
    }


def plans_view() -> list[dict]:
    """Тарифы для бота и страницы тарифов: обе цены и экономия за год."""
    return [
        {
            "plan": plan.code,
            "title": plan.title,
            "price_month": plan.price_month,
            "price_year": plan.price_year,
            "exchange_limit": plan.exchange_limit,
            "history_months": plan.history_months,
            "tools": plan.tools,
            "year_savings": savings(plan),
            # Подарок новому - по сроку оплаты. Числа отдаём отсюда, чтобы
            # обещание в боте и на странице не разошлось с начислением.
            "gift_days": {
                MONTHLY: GIFT_MONTH.days,
                YEARLY: GIFT_YEAR.days,
            },
        }
        for plan in PLANS.values()
    ]


# ── Счёт ────────────────────────────────────────────────────────────────────


def open_invoice(
    session: Session,
    *,
    student_id: int | None,
    plan: str,
    period: str = MONTHLY,
    tg_id: int | None = None,
    now: datetime | None = None,
) -> PaymentIntent:
    """Выставить счёт. Нажал кнопку дважды - получил тот же счёт, а не второй.

    Так же ведёт себя выдача пароля входа: повторный запрос до истечения
    отдаёт прежний. Человек, нажавший «оплатить» ещё раз, ждёт один счёт, а
    два ожидающих счёта на одного человека - это два платежа, которых он не
    делал.
    """
    chosen = plan_of(plan)
    span = period_of(period)
    moment = now or _now()

    waiting = _waiting_invoice(
        session, student_id=student_id, tg_id=tg_id, plan=chosen.code, period=span, now=moment
    )
    if waiting is not None:
        return waiting

    price = price_of(chosen, span)
    receiver = bsc.receiving_address()
    for attempt in range(AMOUNT_TRIES):
        intent = PaymentIntent(
            student_id=student_id,
            tg_id=tg_id,
            plan=chosen.code,
            period=span,
            price_usd=price,
            network=bsc.NETWORK,
            receiver=receiver,
            amount_raw=bsc.unique_amount(price),
            status="pending",
            created_at=moment,
            expires_at=moment + INVOICE_WINDOW,
        )
        session.add(intent)
        try:
            session.commit()
        except IntegrityError:
            # Хвост совпал с чужим ожидающим счётом - берём другой.
            session.rollback()
            if attempt == AMOUNT_TRIES - 1:
                raise
            continue
        return intent
    raise RuntimeError("Свободная сумма не нашлась")


def _waiting_invoice(
    session: Session,
    *,
    student_id: int | None,
    tg_id: int | None,
    plan: str,
    period: str,
    now: datetime,
) -> PaymentIntent | None:
    query = select(PaymentIntent).where(
        PaymentIntent.plan == plan,
        PaymentIntent.period == period,
        PaymentIntent.status == "pending",
        PaymentIntent.expires_at > now,
    )
    if student_id is not None:
        query = query.where(PaymentIntent.student_id == student_id)
    elif tg_id is not None:
        query = query.where(PaymentIntent.tg_id == tg_id)
    else:
        return None
    return session.scalars(query.order_by(PaymentIntent.created_at.desc())).first()


def invoice_view(intent: PaymentIntent) -> dict:
    """Счёт для бота и кабинета. Сеть названа словами: оплата не в ту сеть -
    самая частая потеря денег."""
    return {
        "intent_id": intent.id,
        "network": intent.network,
        "network_label": bsc.NETWORK_LABEL,
        "receiver": intent.receiver,
        "amount": bsc.format_usdt(intent.amount_raw),
        "amount_raw": str(intent.amount_raw),
        "expires_at": int(_aware(intent.expires_at).timestamp()),
        "plan": intent.plan,
        "period": intent.period or MONTHLY,
        "price_usd": float(intent.price_usd),
        "days": PERIODS[period_of(intent.period)].days,
        "status": intent.status,
    }


# ── Начисление ──────────────────────────────────────────────────────────────


def credit(
    session: Session,
    intent: PaymentIntent,
    *,
    tx_hash: str,
    amount_raw: str,
    now: datetime | None = None,
) -> SubscriptionPayment | None:
    """Зачесть оплату счёта. Повторный вызов с тем же `tx_hash` - `None`.

    Одна транзакция базы: либо в истории появилась запись и подписка выросла,
    либо не случилось ни того, ни другого. Разорвать это нельзя - платформа
    падает между приходом денег и начислением ровно так же, как между любыми
    двумя строками кода.
    """
    moment = now or _now()
    student_id = intent.student_id or _student_by_tg(session, intent.tg_id)
    if student_id is None:
        log.error("Счёт %s оплачен, но ученик не найден: %s", intent.id, tx_hash)
        return None

    subscription = _subscription(session, student_id, moment)
    base = max(moment, _aware(subscription.paid_until) or moment)
    # Месяц или год - смотря за что заплачено, и подарок новому идёт по тому же
    # сроку: неделя за месяц, тридцать дней за год.
    period = period_of(intent.period)
    span = PERIODS[period]
    gift = gift_for(period) if _deserves_gift(subscription) else timedelta(0)
    paid_until = base + span + gift

    payment = SubscriptionPayment(
        student_id=student_id,
        intent_id=intent.id,
        amount_raw=str(amount_raw),
        tx_hash=tx_hash,
        days_added=(span + gift).days,
        gift_days=gift.days,
    )
    # Запись об оплате идёт первой и в своей вложенной транзакции: если этот
    # перевод уже учтён, `UNIQUE (tx_hash)` не пропустит её, и мы выйдем до
    # того, как тронем подписку. Проверять «а не начисляли ли уже» запросом
    # нельзя - между запросом и вставкой помещается второй проход наблюдателя.
    try:
        with session.begin_nested():
            session.add(payment)
    except IntegrityError:
        session.rollback()
        log.info("Перевод %s уже был учтён - дни не начисляем", tx_hash)
        return None

    subscription.plan = intent.plan
    subscription.paid_until = paid_until
    subscription.updated_at = moment
    if subscription.first_paid_at is None:
        subscription.first_paid_at = moment
    if gift:
        subscription.gift_granted = True
    # Оплатил после отказа - значит передумал: ждём следующего платежа снова.
    subscription.cancelled_at = None

    intent.status = "paid"
    intent.tx_hash = tx_hash
    intent.paid_at = moment

    # Событие боту ложится той же транзакцией, что и дни: уведомление об
    # оплате, ушедшее без начисления, хуже, чем неушедшее.
    notifications.payment_received(
        session,
        student_id=student_id,
        tx_hash=tx_hash,
        plan=intent.plan,
        paid_until=paid_until,
        days_added=payment.days_added,
        gift_days=payment.gift_days,
    )

    session.commit()
    return payment


def grant_days(
    session: Session,
    student_id: int,
    *,
    days: int,
    reason: str,
    plan: str | None = None,
    now: datetime | None = None,
) -> SubscriptionPayment:
    """Выдать дни руками: подарок наставника, компенсация за простой.

    Ложится в ту же историю, что и оплата, с пустым счётом и причиной: подарок
    должен быть виден там же, где деньги, иначе разбирать спор будет нечем.
    """
    moment = now or _now()
    subscription = _subscription(session, student_id, moment)
    base = max(moment, _aware(subscription.paid_until) or moment)

    payment = SubscriptionPayment(
        student_id=student_id,
        amount_raw="0",
        days_added=int(days),
        reason=reason[:120],
    )
    session.add(payment)
    subscription.paid_until = base + timedelta(days=int(days))
    subscription.updated_at = moment
    if plan:
        subscription.plan = plan_of(plan).code
    session.commit()
    return payment


def gift_for(period: str) -> timedelta:
    """Сколько дней в подарок даёт первая оплата этого срока."""
    return GIFT_YEAR if period_of(period) == YEARLY else GIFT_MONTH


def _deserves_gift(subscription: Subscription) -> bool:
    return subscription.first_paid_at is None and not subscription.gift_granted


def _subscription(session: Session, student_id: int, now: datetime) -> Subscription:
    """Строка подписки ученика; нет - заводится пустой, кончившейся сейчас."""
    row = session.get(Subscription, student_id)
    if row is None:
        row = Subscription(
            student_id=student_id,
            plan="terminal",
            paid_until=now,
            started_at=now,
            updated_at=now,
        )
        session.add(row)
        session.flush()
    return row


def _student_by_tg(session: Session, tg_id: int | None) -> int | None:
    if tg_id is None:
        return None
    student = session.scalars(select(Student).where(Student.tg_id == tg_id)).first()
    return student.id if student else None


# ── Состояние ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class State:
    """Состояние подписки ученика на момент вопроса."""

    active: bool
    plan: str
    paid_until: datetime | None
    days_left: int
    cancelled: bool
    # Кончается на днях: бот шлёт напоминание, кабинет рисует предупреждение.
    expiring_soon: bool


NO_SUBSCRIPTION = State(
    active=False, plan="", paid_until=None, days_left=0, cancelled=False, expiring_soon=False
)


def state(session: Session, student_id: int, now: datetime | None = None) -> State:
    moment = now or _now()
    row = session.get(Subscription, student_id)
    if row is None:
        return NO_SUBSCRIPTION
    paid_until = _aware(row.paid_until)
    if paid_until is None:
        return NO_SUBSCRIPTION
    left = paid_until - moment
    active = left > timedelta(0)
    # Округление вверх: пока идут последние часы, у человека «остался день», а
    # не «ноль дней» - ноль он прочтёт как «уже кончилась».
    seconds_left = max(0, int(left.total_seconds()))
    return State(
        active=active,
        plan=str(row.plan or ""),
        paid_until=paid_until,
        days_left=-(-seconds_left // 86400),
        cancelled=row.cancelled_at is not None,
        expiring_soon=active and left <= WARN_BEFORE,
    )


def cancel(session: Session, student_id: int, now: datetime | None = None) -> bool:
    """Отказ от продления. Оплаченные дни остаются - человек за них заплатил."""
    row = session.get(Subscription, student_id)
    if row is None:
        return False
    row.cancelled_at = now or _now()
    row.updated_at = row.cancelled_at
    session.commit()
    return True


def on_payment(session: Session, intent: PaymentIntent, transfer: bsc.Transfer) -> None:
    """Обработчик для наблюдателя: перевод из сети превращается в дни."""
    credit(session, intent, tx_hash=transfer.tx_hash, amount_raw=transfer.amount_raw)
