"""Два источника доступа: лучшее из реферала и подписки.

Матрица прав из §8 ТЗ и обязательная проверка из §15. Главное, что здесь
проверяется, - подписка никому ничего не отнимает: ни рефералу, ни тому, чей
счёт подтвердила академия. Она только добавляет права тем, у кого их не было.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend import access as access_module
from backend import entitlements, subscriptions
from core.models import AcademyUid, ExchangeAccount, ScalpTrade, Student, Subscription

NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("NMNH_BSC_RECEIVER", RECEIVER)
    url = f"sqlite:///{tmp_path}/access.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()
    with db_module.SessionLocal() as session:
        yield session


def _student(session, *, tg_id: int = 1, vip: bool = False) -> Student:
    row = Student(tg_id=tg_id, username=f"user{tg_id}", is_vip=vip)
    session.add(row)
    session.commit()
    return row


def _subscribe(session, student, *, plan: str = "terminal", days: int = 30, now: datetime = NOW):
    session.add(
        Subscription(
            student_id=student.id,
            plan=plan,
            paid_until=now + timedelta(days=days),
            started_at=now,
            first_paid_at=now,
            gift_granted=True,
            updated_at=now,
        )
    )
    session.commit()


def _academy(session, student, exchange: str = "weex"):
    session.add(AcademyUid(student_id=student.id, exchange=exchange, uid="12345"))
    session.commit()


def _keys(session, student, exchange: str):
    session.add(
        ExchangeAccount(
            student_id=student.id,
            exchange=exchange,
            api_key_enc="x",
            secret_enc="x",
            passphrase_enc="",
        )
    )
    session.commit()


def test_a_referral_keeps_everything_when_the_subscription_ends(session):
    """Реферал с истёкшей подпиской не теряет ничего: у него и так всё."""
    student = _student(session, vip=True)
    _subscribe(session, student, plan="terminal", days=-1)

    access = access_module.effective_access(session, student, now=NOW)

    assert access.terminal is True
    assert access.tools is True
    assert access.exchange_limit is None
    assert access.history_months == 0
    assert access.source == "referral"


def test_a_subscriber_on_terminal_gets_one_exchange(session):
    """Тариф за 49 - одна биржа на выбор, вторую он не подключает."""
    student = _student(session)
    _subscribe(session, student, plan="terminal")

    assert access_module.may_add_exchange(session, student, "binance") is True
    _keys(session, student, "binance")
    assert access_module.may_add_exchange(session, student, "okx") is False
    # Свою он переподключает всегда: ключи протухают, и запертая кнопка
    # означала бы позицию, которую нечем вести.
    assert access_module.may_add_exchange(session, student, "binance") is True


def test_a_subscriber_on_pro_gets_five(session):
    """Тариф за 99 - пять бирж и инструменты."""
    student = _student(session)
    _subscribe(session, student, plan="pro")

    for code in ("binance", "okx", "bingx", "mexc"):
        assert access_module.may_add_exchange(session, student, code) is True
        _keys(session, student, code)

    access = access_module.effective_access(session, student, now=NOW)
    assert access.exchange_limit == 5
    assert access.tools is True


def test_tools_open_for_pro_and_stay_closed_for_terminal(session):
    """Инструменты терминала даёт Про, но не даёт тариф за 49."""
    plain = _student(session, tg_id=1)
    _subscribe(session, plain, plan="terminal")
    paid = _student(session, tg_id=2)
    _subscribe(session, paid, plan="pro")

    assert entitlements.has_feature(session, plain.id, "tool_vision") is False
    assert entitlements.has_feature(session, paid.id, "tool_vision") is True


def test_an_expired_subscription_closes_the_tools(session):
    """Подписка кончилась - инструменты закрылись, льготных дней нет."""
    student = _student(session)
    _subscribe(session, student, plan="pro", days=-1)

    assert entitlements.has_feature(session, student.id, "tool_vision") is False


def test_history_is_three_months_for_terminal(session):
    """У тарифа за 49 журнал виден на три месяца назад."""
    student = _student(session)
    _subscribe(session, student, plan="terminal")

    floor = access_module.history_floor(session, student, now=NOW)

    assert floor == NOW - timedelta(days=90)


def test_history_stays_full_for_everyone_else(session):
    """Реферал, подписчик Про и ученик академии видят историю целиком."""
    referral = _student(session, tg_id=1, vip=True)
    _subscribe(session, referral, plan="terminal")
    pro = _student(session, tg_id=2)
    _subscribe(session, pro, plan="pro")
    academy = _student(session, tg_id=3)
    _academy(session, academy)
    _subscribe(session, academy, plan="terminal")

    for student in (referral, pro, academy):
        assert access_module.history_floor(session, student, now=NOW) is None


def test_the_academy_student_loses_nothing_to_the_subscription(session):
    """Подтверждённый академией торгует и без подписки - как торговал вчера."""
    student = _student(session)
    _academy(session, student)

    access = access_module.effective_access(session, student, now=NOW)

    assert access.terminal is True
    assert access.exchange_limit is None
    assert access.source == "academy"


def test_a_stranger_without_anything_is_not_let_in(session):
    """Ни академии, ни подписки - терминал закрыт."""
    student = _student(session)

    access = access_module.effective_access(session, student, now=NOW)

    assert access.terminal is False
    assert access.source == ""


def test_both_sources_at_once_give_the_better_of_the_two(session):
    """Подписчик открыл счёт через академию: права сложились в лучшую сторону."""
    student = _student(session, vip=True)
    _subscribe(session, student, plan="terminal")

    access = access_module.effective_access(session, student, now=NOW)

    assert access.source == "both"
    assert access.exchange_limit is None, "реферал не знает предела бирж"
    assert access.history_months == 0
    assert access.tools is True


def test_a_subscriber_may_connect_an_exchange_the_academy_never_saw(session):
    """Подписка - второй ключ к бирже: академии подтверждать нечего."""
    from backend.trading.accounts import may_connect

    student = _student(session)
    assert may_connect(session, student, "binance") is False

    _subscribe(session, student, plan="terminal")
    assert may_connect(session, student, "binance") is True


def test_the_journal_of_a_terminal_subscriber_stops_at_three_months(session):
    """Старее трёх месяцев сделки подписчику не показываются, но и не пропадают."""
    student = _student(session)
    _subscribe(session, student, plan="terminal")
    old = ScalpTrade(
        student_id=student.id,
        client_id="old",
        symbol="BTCUSDT",
        side="long",
        entry=100,
        stop=99,
        qty=1,
        margin=10,
        leverage=10,
        outcome="take",
        pnl=1,
        closed_at=NOW - timedelta(days=200),
    )
    session.add(old)
    session.commit()

    floor = access_module.history_floor(session, student, now=NOW)

    assert floor is not None and old.closed_at < floor
    # Запись на месте: журнал - его данные, мы их не удаляем.
    assert session.query(ScalpTrade).count() == 1


def test_paying_opens_the_terminal_for_someone_without_an_account(session):
    """Тот, у кого нет счёта через академию, получает вход за деньги."""
    student = _student(session)
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal", now=NOW)
    subscriptions.credit(session, intent, tx_hash="0xpaid", amount_raw=intent.amount_raw, now=NOW)

    access = access_module.effective_access(session, student, now=NOW)

    assert access.terminal is True
    assert access.source == "subscription"
    assert access.subscription_active is True
