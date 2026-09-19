"""Схема подписки: предохранители, без которых деньги теряются.

Проверяется не «таблица создалась», а три места, где ошибка стоит денег:
один платёж не должен начислиться дважды, два ожидающих счёта не должны иметь
одинаковую сумму (иначе не понять, кто заплатил), и двадцатизначная сумма USDT
должна вернуться из базы ровно такой, какой легла.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from core.models import (
    OrphanPayment,
    PaymentIntent,
    Student,
    Subscription,
    SubscriptionPayment,
)

# 49 USDT в минимальных единицах BEP-20: 18 знаков, двадцать цифр. Ровно то
# число, которое не влезает в целое SQLite и портится при хранении числом.
FORTY_NINE = "49004173000000000000"


@pytest.fixture
def session(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/subs.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()
    with db_module.SessionLocal() as session:
        yield session


def _student(session, tg_id: int = 1) -> Student:
    student = Student(tg_id=tg_id, username=f"user{tg_id}")
    session.add(student)
    session.flush()
    return student


def _intent(student_id: int, amount: str = FORTY_NINE, status: str = "pending") -> PaymentIntent:
    now = datetime.now(timezone.utc)
    return PaymentIntent(
        student_id=student_id,
        plan="terminal",
        price_usd=49,
        network="bep20",
        receiver="0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc",
        amount_raw=amount,
        status=status,
        expires_at=now + timedelta(minutes=60),
    )


def test_two_waiting_invoices_cannot_share_an_amount(session):
    """Плательщик опознаётся суммой: одинаковых ожидающих сумм быть не может."""
    student = _student(session)
    session.add(_intent(student.id))
    session.commit()

    session.add(_intent(student.id))
    with pytest.raises(IntegrityError):
        session.commit()


def test_a_paid_invoice_does_not_block_the_same_amount_later(session):
    """Оплаченный счёт сумму больше не занимает - иначе слоты кончились бы."""
    student = _student(session)
    session.add(_intent(student.id, status="paid"))
    session.add(_intent(student.id, status="expired"))
    session.commit()

    session.add(_intent(student.id))
    session.commit()

    assert session.query(PaymentIntent).count() == 3


def test_the_same_transaction_is_counted_once(session):
    """Повторный проход наблюдателя по тем же блокам не начислит дни дважды."""
    student = _student(session)
    session.add(SubscriptionPayment(student_id=student.id, tx_hash="0xabc", days_added=30))
    session.commit()

    session.add(SubscriptionPayment(student_id=student.id, tx_hash="0xabc", days_added=30))
    with pytest.raises(IntegrityError):
        session.commit()


def test_manual_grants_have_no_transaction_and_do_not_collide(session):
    """Подарок наставника лежит в истории рядом с оплатами, хеша у него нет."""
    student = _student(session)
    session.add(SubscriptionPayment(student_id=student.id, days_added=30, reason="наставник"))
    session.add(SubscriptionPayment(student_id=student.id, days_added=7, reason="простой"))
    session.commit()

    assert session.query(SubscriptionPayment).count() == 2


def test_a_twenty_digit_amount_survives_the_database(session):
    """18 знаков USDT в BSC: сумма возвращается цифра в цифру.

    Хранись она числом, SQLite отдал бы 4.9004173e+19 - и наблюдатель не нашёл
    бы ни одного платежа.
    """
    student = _student(session)
    session.add(_intent(student.id))
    session.add(OrphanPayment(tx_hash="0xdead", from_address="0xbeef", amount_raw=FORTY_NINE))
    session.commit()
    session.expire_all()

    assert session.query(PaymentIntent).one().amount_raw == FORTY_NINE
    assert session.query(OrphanPayment).one().amount_raw == FORTY_NINE


def test_a_student_has_one_subscription_row(session):
    """Состояние подписки - одна строка на человека, а не история статусов."""
    student = _student(session)
    now = datetime.now(timezone.utc)
    session.add(Subscription(student_id=student.id, paid_until=now + timedelta(days=30)))
    session.commit()

    session.add(Subscription(student_id=student.id, paid_until=now + timedelta(days=60)))
    with pytest.raises(IntegrityError):
        session.commit()
