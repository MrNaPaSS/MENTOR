"""Начисление и продление подписки: дни, подарок, повторы, смена тарифа.

Обязательные проверки из §15 ТЗ. Каждая описывает случай, который иначе
разбирался бы в переписке с человеком, потерявшим деньги или дни.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend import subscriptions
from backend.payments import bsc
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


def test_a_hundred_invoices_never_collide(session, student):
    """Сумма у каждого ожидающего счёта своя: сто подряд без единого совпадения."""
    amounts = set()
    for number in range(100):
        # Каждый счёт от своего человека: один человек получает один счёт.
        payer = Student(tg_id=1000 + number)
        session.add(payer)
        session.flush()
        intent = subscriptions.open_invoice(session, student_id=payer.id, plan="terminal", now=NOW)
        amounts.add(intent.amount_raw)

    assert len(amounts) == 100


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
    assert view["amount"].startswith("49.00")
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
