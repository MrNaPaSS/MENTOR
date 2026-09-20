"""Начисление и продление подписки: дни, подарок, повторы, смена тарифа.

Обязательные проверки из §15 ТЗ. Каждая описывает случай, который иначе
разбирался бы в переписке с человеком, потерявшим деньги или дни.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import pytest

from backend import subscriptions
from backend.payments import bsc, watcher as payments_watcher
from core.models import PaymentIntent, Student, Subscription, SubscriptionPayment

RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"
NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("NMNH_BSC_RECEIVER", RECEIVER)
    url = f"sqlite:///{tmp_path}/subs.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()
    with db_module.SessionLocal() as session:
        yield session


@pytest.fixture
def student(session) -> Student:
    row = Student(tg_id=77, username="ivan")
    session.add(row)
    session.commit()
    return row


def _until(session, student) -> datetime:
    """`paid_until` с меткой пояса: SQLite отдаёт время голым."""
    return subscriptions._aware(session.get(Subscription, student.id).paid_until)


def _pay(session, student, *, plan: str = "terminal", tx: str = "0x1", now: datetime = NOW):
    intent = subscriptions.open_invoice(session, student_id=student.id, plan=plan, now=now)
    return subscriptions.credit(
        session, intent, tx_hash=tx, amount_raw=intent.amount_raw, now=now
    )


def test_the_first_payment_gives_a_month_and_the_gift_week(session, student):
    """Первая оплата - 37 дней: тридцать оплаченных и семь подаренных."""
    payment = _pay(session, student)

    assert payment.days_added == 37
    assert payment.gift_days == 7
    row = session.get(Subscription, student.id)
    assert _until(session, student) == NOW + timedelta(days=37)
    assert row.gift_granted is True


def test_the_second_payment_gives_thirty_days(session, student):
    """Подарок не повторяется: вторая оплата - ровно месяц."""
    _pay(session, student, tx="0x1")
    later = NOW + timedelta(days=40)

    second = _pay(session, student, tx="0x2", now=later)

    assert second.days_added == 30
    assert second.gift_days == 0


def test_paying_early_extends_and_does_not_reset(session, student):
    """Оплата за десять дней до конца добавляет месяц к остатку, а не вместо."""
    _pay(session, student, tx="0x1")  # до NOW + 37 дней
    early = NOW + timedelta(days=27)

    _pay(session, student, tx="0x2", now=early)

    assert _until(session, student) == NOW + timedelta(days=67)


def test_the_same_transaction_never_pays_twice(session, student):
    """Наблюдатель прошёл по блокам дважды - дни начислены один раз."""
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)
    first = subscriptions.credit(session, intent, tx_hash="0xsame", amount_raw=intent.amount_raw, now=NOW)
    again = subscriptions.credit(session, intent, tx_hash="0xsame", amount_raw=intent.amount_raw, now=NOW)

    assert first is not None
    assert again is None
    assert session.query(SubscriptionPayment).count() == 1
    assert _until(session, student) == NOW + timedelta(days=37)


def test_the_gift_does_not_come_back_after_cancelling(session, student):
    """Отменил и вернулся - подарок уже был: тридцать дней, а не тридцать семь."""
    _pay(session, student, tx="0x1")
    subscriptions.cancel(session, student.id, now=NOW + timedelta(days=1))
    later = NOW + timedelta(days=60)

    payment = _pay(session, student, tx="0x2", now=later)

    assert payment.days_added == 30
    assert session.get(Subscription, student.id).cancelled_at is None, "оплата - это возвращение"


def test_every_waiting_invoice_gets_its_own_amount(session, student):
    """Сумма у каждого ожидающего счёта своя - все 99 хвостов цены подряд."""
    amounts = set()
    for number in range(bsc.TAIL_MAX):
        # Каждый счёт от своего человека: один человек получает один счёт.
        payer = Student(tg_id=1000 + number)
        session.add(payer)
        session.flush()
        intent = subscriptions.open_invoice(session, student_id=payer.id, plan="terminal", now=NOW)
        amounts.add(intent.amount_raw)

    assert len(amounts) == bsc.TAIL_MAX
    # Хвост виден человеку: он переписывает сумму руками в поле вывода биржи.
    assert all(re.fullmatch(r"49\.\d{2}", bsc.format_usdt(one)) for one in amounts)


def test_when_all_the_tails_are_taken_the_refusal_is_plain(session, student):
    """Слотов 99: сотый одновременный счёт - внятный отказ, а не мусорная сумма.

    Слот освобождается, как только счёт истёк или оплачен, поэтому упереться в
    предел можно только при сотне человек, платящих в один и тот же час.
    """
    for number in range(bsc.TAIL_MAX):
        payer = Student(tg_id=2000 + number)
        session.add(payer)
        session.flush()
        subscriptions.open_invoice(session, student_id=payer.id, plan="terminal", now=NOW)

    with pytest.raises(subscriptions.NoFreeAmount):
        subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)

    # Час прошёл, брони сняты - счёт снова выставляется.
    payments_watcher.expire_stale(session, now=NOW + timedelta(hours=2))
    later = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", now=NOW + timedelta(hours=2)
    )
    assert later.amount_raw


def test_pressing_pay_twice_returns_the_same_invoice(session, student):
    """Нажал дважды - счёт один: два ожидающих счёта человек не выставлял."""
    first = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)
    second = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)

    assert first.id == second.id
    assert session.query(PaymentIntent).count() == 1


def test_another_plan_gets_its_own_invoice(session, student):
    """Передумал и выбрал Про - это другой счёт, а не тот же."""
    first = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)
    second = subscriptions.open_invoice(session, student_id=student.id, plan="pro", now=NOW)

    assert first.id != second.id
    assert float(second.price_usd) == 99


def test_paying_for_pro_switches_the_plan(session, student):
    """Смена тарифа - с ближайшего дня, без пересчёта остатка."""
    _pay(session, student, plan="terminal", tx="0x1")

    _pay(session, student, plan="pro", tx="0x2", now=NOW + timedelta(days=10))

    assert session.get(Subscription, student.id).plan == "pro"
    assert _until(session, student) == NOW + timedelta(days=67)


def test_state_counts_days_up_not_down(session, student):
    """Последние часы - это «остался день», а не «ноль дней»."""
    _pay(session, student, tx="0x1")

    state = subscriptions.state(session, student.id, now=NOW + timedelta(days=36, hours=5))

    assert state.active is True
    assert state.days_left == 1
    assert state.plan == "terminal"


def test_state_sees_the_end_coming(session, student):
    """За три дня до конца подписка помечается кончающейся - это повод писать."""
    _pay(session, student, tx="0x1")

    assert subscriptions.state(session, student.id, now=NOW + timedelta(days=30)).expiring_soon is False
    assert subscriptions.state(session, student.id, now=NOW + timedelta(days=35)).expiring_soon is True


def test_there_is_no_grace_period(session, student):
    """Решение владельца: кончилась - значит кончилась, льготных дней нет."""
    _pay(session, student, tx="0x1")

    after = subscriptions.state(session, student.id, now=NOW + timedelta(days=37, minutes=1))

    assert after.active is False
    assert after.days_left == 0


def test_cancelling_keeps_the_paid_days(session, student):
    """Отказ от продления - это «не жди платежа», а не «выключи сейчас»."""
    _pay(session, student, tx="0x1")

    subscriptions.cancel(session, student.id, now=NOW + timedelta(days=2))

    state = subscriptions.state(session, student.id, now=NOW + timedelta(days=3))
    assert state.active is True
    assert state.cancelled is True


def test_a_mentor_can_hand_out_days(session, student):
    """Подарок наставника лежит в истории рядом с оплатами и с причиной."""
    payment = subscriptions.grant_days(
        session, student.id, days=14, reason="компенсация за простой", now=NOW
    )

    assert payment.tx_hash is None
    assert payment.reason == "компенсация за простой"
    assert _until(session, student) == NOW + timedelta(days=14)


def test_the_invoice_says_the_network_in_words(session, student):
    """Оплата не в ту сеть - самая частая потеря денег: сеть названа словами."""
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)

    view = subscriptions.invoice_view(intent)

    assert view["network_label"] == "BNB Smart Chain (BEP-20)"
    # Сумма короткая и с хвостом в сотых: её набирают руками на бирже.
    assert re.fullmatch(r"49\.\d{2}", view["amount"])
    assert int(view["amount_raw"]) > 49 * 10**18
    assert view["receiver"] == RECEIVER


def test_an_unknown_plan_is_refused(session, student):
    """Тариф, которого нет, - это ошибка вызова, а не счёт на ноль долларов."""
    with pytest.raises(ValueError):
        subscriptions.open_invoice(session, student_id=student.id, plan="gold", now=NOW)


def test_the_watcher_hands_the_transfer_over(session, student):
    """Связка с наблюдателем: перевод из сети превращается в дни."""
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)
    transfer = bsc.Transfer(
        tx_hash="0xchain", block=10, from_address="0x" + "22" * 20, amount_raw=intent.amount_raw
    )

    subscriptions.on_payment(session, intent, transfer)

    assert session.get(PaymentIntent, intent.id).status == "paid"
    assert session.query(SubscriptionPayment).one().tx_hash == "0xchain"


# ── Годовая подписка ────────────────────────────────────────────────────────


def test_a_year_costs_less_than_twelve_months(session, student):
    """Год дешевле двенадцати месяцев - иначе тумблер «год» не имеет смысла."""
    terminal = subscriptions.savings(subscriptions.PLANS["terminal"])
    pro = subscriptions.savings(subscriptions.PLANS["pro"])

    assert subscriptions.PLANS["terminal"].price_year == 500
    assert subscriptions.PLANS["pro"].price_year == 1100
    assert terminal["twelve_months"] == 588 and terminal["saved_usd"] == 88
    assert terminal["saved_percent"] == 15
    assert pro["twelve_months"] == 1188 and pro["saved_usd"] == 88
    assert pro["per_month"] == 91.67


def test_the_yearly_invoice_asks_for_the_yearly_price(session, student):
    """Счёт на год - это 500, а не 49: цена берётся по выбранному периоду."""
    intent = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=NOW
    )

    view = subscriptions.invoice_view(intent)
    assert float(intent.price_usd) == 500
    assert view["period"] == "year"
    assert view["days"] == 365
    assert re.fullmatch(r"500\.\d{2}", view["amount"])


def test_the_first_year_gives_a_month_as_a_gift(session, student):
    """Первая оплата за год - 395 дней: год плюс тридцать подарочных.

    Подарок идёт по сроку оплаты: неделя за месяц, месяц за год. Годовая
    оплата - это доверие вперёд на год, и отвечать на него той же неделей,
    что и за месяц, неправильно.
    """
    intent = subscriptions.open_invoice(
        session, student_id=student.id, plan="pro", period="year", now=NOW
    )
    payment = subscriptions.credit(
        session, intent, tx_hash="0xyear", amount_raw=intent.amount_raw, now=NOW
    )

    assert payment.days_added == 395
    assert payment.gift_days == 30
    assert _until(session, student) == NOW + timedelta(days=395)


def test_the_yearly_gift_comes_only_the_first_time(session, student):
    """Второй год подряд - ровно 365 дней: подарок был один раз."""
    first = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=NOW
    )
    subscriptions.credit(session, first, tx_hash="0xy1", amount_raw=first.amount_raw, now=NOW)

    later = NOW + timedelta(days=400)
    second = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=later
    )
    payment = subscriptions.credit(
        session, second, tx_hash="0xy2", amount_raw=second.amount_raw, now=later
    )

    assert payment.days_added == 365
    assert payment.gift_days == 0


def test_a_month_after_a_year_does_not_bring_the_gift_back(session, student):
    """Подарок один на человека, а не один на каждый новый срок."""
    yearly = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=NOW
    )
    subscriptions.credit(session, yearly, tx_hash="0xy", amount_raw=yearly.amount_raw, now=NOW)

    later = NOW + timedelta(days=10)
    payment = _pay(session, student, tx="0xm", now=later)

    assert payment.days_added == 30
    assert payment.gift_days == 0


def test_a_year_on_top_of_a_month_extends_it(session, student):
    """Годовая оплата поверх месячной продлевает ту же подписку."""
    _pay(session, student, tx="0x1")  # 37 дней
    intent = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=NOW + timedelta(days=10)
    )
    subscriptions.credit(
        session, intent, tx_hash="0x2", amount_raw=intent.amount_raw, now=NOW + timedelta(days=10)
    )

    # 37 дней месячной подписки с подарком плюс 365 годовых: подарок второй
    # раз не выдаётся.
    assert _until(session, student) == NOW + timedelta(days=402)


def test_month_and_year_are_different_invoices(session, student):
    """Передумал платить за год - это новый счёт, а не прежний на 49."""
    monthly = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="month", now=NOW
    )
    yearly = subscriptions.open_invoice(
        session, student_id=student.id, plan="terminal", period="year", now=NOW
    )

    assert monthly.id != yearly.id
    assert float(monthly.price_usd) == 49 and float(yearly.price_usd) == 500


def test_an_invoice_without_a_period_is_monthly(session, student):
    """Период не назвали - месяц: так вели себя все счета до годовой подписки."""
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)

    assert intent.period == "month"
    assert float(intent.price_usd) == 49


def test_an_unknown_period_is_refused(session, student):
    """«Полгода» мы не продаём - это ошибка вызова, а не тихий месяц."""
    with pytest.raises(ValueError):
        subscriptions.open_invoice(
            session, student_id=student.id, plan="terminal", period="half", now=NOW
        )


def test_plans_view_carries_both_prices_for_the_toggle(session):
    """Тумблер «месяц/год» рисуется по одному ответу: обе цены и экономия."""
    view = subscriptions.plans_view()

    assert [one["plan"] for one in view] == ["terminal", "pro"]
    assert view[0]["price_month"] == 49 and view[0]["price_year"] == 500
    assert view[1]["year_savings"]["saved_usd"] == 88
    # Подарок называется здесь же: страница и бот не должны считать его сами.
    assert view[0]["gift_days"] == {"month": 7, "year": 30}
