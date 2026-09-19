"""Сервисные ручки подписки и очередь событий для бота.

Бот денег не считает: он спрашивает платформу и пересказывает ответ. Эти
проверки - про то, что ответ можно пересказать, а чужой без ключа ничего не
получит.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

# Сборка приложения читает ключ подписи при импорте модуля - как в
# tests/test_tg_login.py.
os.environ.setdefault("JWT_SECRET", "test-secret")
from fastapi.testclient import TestClient

from backend import notifications, subscriptions
from backend.config import BackendConfig
from backend.main import create_app
from core.models import NotificationEvent, Student, Subscription
from core.weex import get_weex_client

KEY = "service-key-for-tests"
RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"
NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/service.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("SERVICE_API_KEY", KEY)
    monkeypatch.setenv("SERVICE_ALLOWED_IPS", "")
    monkeypatch.setenv("NMNH_BSC_RECEIVER", RECEIVER)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    app = create_app(BackendConfig.from_env(), weex=get_weex_client(True))
    with TestClient(app) as client:
        yield client


@pytest.fixture
def session():
    from core import db as db_module

    with db_module.SessionLocal() as session:
        yield session


def _head() -> dict:
    return {"X-Service-Key": KEY}


def test_a_call_without_the_key_is_refused(client):
    """Ключ открывает выставление счетов - без него не отвечаем ничего."""
    answer = client.get("/api/service/subscription/status?tg_id=1")

    assert answer.status_code in (401, 403)


def test_the_bot_gets_both_prices_for_the_toggle(client):
    """Тумблер месяц/год рисуется по одному ответу."""
    answer = client.get("/api/service/subscription/plans", headers=_head())

    assert answer.status_code == 200
    plans = answer.json()["plans"]
    assert plans[0]["price_month"] == 49 and plans[0]["price_year"] == 500
    assert plans[1]["price_month"] == 99 and plans[1]["price_year"] == 1100
    assert plans[0]["year_savings"]["saved_usd"] == 88
    assert answer.json()["network_label"] == "BNB Smart Chain (BEP-20)"


def test_the_bot_can_raise_an_invoice_for_a_stranger(client, session):
    """Человека ещё нет в базе - счёт всё равно выставляется, его и заводим."""
    answer = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": 555, "plan": "terminal", "username": "ivan"},
        headers=_head(),
    )

    assert answer.status_code == 200
    body = answer.json()
    assert body["amount"].startswith("49.00")
    assert body["receiver"] == RECEIVER
    assert body["network_label"] == "BNB Smart Chain (BEP-20)"
    assert body["period"] == "month" and body["days"] == 30
    assert session.query(Student).filter(Student.tg_id == 555).one_or_none() is not None


def test_a_yearly_invoice_asks_for_the_yearly_price(client):
    """Выбрал год - счёт на 500, а не на 49."""
    answer = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": 556, "plan": "terminal", "period": "year"},
        headers=_head(),
    )

    body = answer.json()
    assert body["price_usd"] == 500
    assert body["period"] == "year" and body["days"] == 365


def test_an_unknown_plan_is_a_plain_refusal(client):
    """«Золотой» тариф - отказ с понятной причиной, а не пятисотка."""
    answer = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": 557, "plan": "gold"},
        headers=_head(),
    )

    assert answer.status_code == 400
    assert "тариф" in answer.json()["detail"].lower()


def test_status_of_someone_we_never_saw(client):
    """О незнакомом человеке отвечаем «ничего нет», а не ошибкой."""
    answer = client.get("/api/service/subscription/status?tg_id=99999", headers=_head())

    assert answer.status_code == 200
    assert answer.json()["active"] is False
    assert answer.json()["terminal"] is False


def test_status_tells_the_bot_whether_to_let_the_person_in(client, session):
    """По этому ответу бот решает, выдавать ли пароль входа."""
    student = Student(tg_id=606, username="paid")
    session.add(student)
    session.commit()
    session.add(
        Subscription(
            student_id=student.id,
            plan="pro",
            paid_until=datetime.now(timezone.utc) + timedelta(days=20),
            started_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    body = client.get("/api/service/subscription/status?tg_id=606", headers=_head()).json()

    assert body["active"] is True
    assert body["plan"] == "pro"
    assert body["terminal"] is True
    assert body["source"] == "subscription"
    assert body["days_left"] == 20


def test_cancelling_keeps_the_days(client, session):
    """Отказ от продления не выключает оплаченное."""
    student = Student(tg_id=607)
    session.add(student)
    session.commit()
    session.add(
        Subscription(
            student_id=student.id,
            plan="terminal",
            paid_until=datetime.now(timezone.utc) + timedelta(days=5),
            started_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    answer = client.post(
        "/api/service/subscription/cancel", json={"tg_id": 607}, headers=_head()
    )

    assert answer.status_code == 200
    assert answer.json()["cancelled"] is True
    assert answer.json()["active"] is True


def test_the_queue_hands_events_over_and_remembers_the_ack(client, session):
    """Событие лежит в очереди, пока бот не подтвердит, что разослал."""
    student = Student(tg_id=608)
    session.add(student)
    session.commit()
    notifications.put(
        session,
        event=notifications.PAYMENT_RECEIVED,
        student_id=student.id,
        dedup="0xabc",
        payload={"plan": "terminal"},
    )
    session.commit()

    first = client.get("/api/service/notifications", headers=_head()).json()["events"]
    assert len(first) == 1
    assert first[0]["event"] == "payment_received"
    assert first[0]["tg_id"] == 608
    assert first[0]["payload"] == {"plan": "terminal"}

    acked = client.post(
        "/api/service/notifications/ack", json={"ids": [first[0]["id"]]}, headers=_head()
    ).json()
    assert acked["acked"] == 1

    assert client.get("/api/service/notifications", headers=_head()).json()["events"] == []


def test_paying_puts_an_event_in_the_queue(client, session):
    """Бот узнаёт об оплате сам - платформа в Telegram не ходит."""
    student = Student(tg_id=609)
    session.add(student)
    session.commit()
    intent = subscriptions.open_invoice(session, student_id=student.id, plan="terminal")
    subscriptions.credit(session, intent, tx_hash="0xpaid", amount_raw=intent.amount_raw)

    events = client.get("/api/service/notifications", headers=_head()).json()["events"]

    assert [one["event"] for one in events] == ["payment_received"]
    assert events[0]["payload"]["gift_days"] == 7


def test_the_warning_is_put_once_not_every_hour(client, session):
    """Сторож ходит раз в час, а «скоро кончится» человек получает один раз."""
    student = Student(tg_id=610)
    session.add(student)
    session.commit()
    session.add(
        Subscription(
            student_id=student.id,
            plan="terminal",
            paid_until=NOW + timedelta(days=2),
            started_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    assert notifications.sweep(session, now=NOW) == 1
    assert notifications.sweep(session, now=NOW + timedelta(hours=1)) == 0
    assert session.query(NotificationEvent).count() == 1
    assert session.query(NotificationEvent).one().event == "expires_soon"


def test_the_end_is_announced_too(client, session):
    """Кончилась - человек узнаёт от нас, а не по запертой кнопке."""
    student = Student(tg_id=611)
    session.add(student)
    session.commit()
    session.add(
        Subscription(
            student_id=student.id,
            plan="terminal",
            paid_until=NOW - timedelta(hours=1),
            started_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    assert notifications.sweep(session, now=NOW) == 1
    assert session.query(NotificationEvent).one().event == "expired"


def test_someone_who_cancelled_is_not_nagged(client, session):
    """Отменивший просил не напоминать - «скоро кончится» ему не шлём."""
    student = Student(tg_id=612)
    session.add(student)
    session.commit()
    session.add(
        Subscription(
            student_id=student.id,
            plan="terminal",
            paid_until=NOW + timedelta(days=2),
            started_at=NOW,
            cancelled_at=NOW,
            updated_at=NOW,
        )
    )
    session.commit()

    assert notifications.sweep(session, now=NOW) == 0
