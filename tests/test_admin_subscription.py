"""Разбор платежей руками: неопознанные переводы и выдача дней.

Эти ручки нужны в одном случае - когда человек заплатил, а система его перевод
сопоставить не смогла. Деньги при этом уже пришли, и от того, как быстро их
зачтут, зависит, останется человек или напишет в поддержку «где мои деньги».
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from backend.payments import bsc
from core.models import OrphanPayment, Student, Subscription, SubscriptionPayment
from core.weex import get_weex_client

RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"
TG_ID = 909


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/admin.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
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


@pytest.fixture
def mentor(client) -> dict:
    """Токен наставника - тем же входом, каким он получает его в админке."""
    token = client.post("/api/auth/mentor-login", json={"password": "secret"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def student(session) -> Student:
    row = Student(tg_id=TG_ID, username="ivan")
    session.add(row)
    session.commit()
    return row


def _orphan(session, *, tx: str = "0xlost", amount: str | None = None) -> OrphanPayment:
    row = OrphanPayment(
        tx_hash=tx,
        network=bsc.NETWORK,
        from_address="0x" + "44" * 20,
        amount_raw=amount or bsc.amount_with_tail(49, 0),
    )
    session.add(row)
    session.commit()
    return row


def test_a_stranger_cannot_look_at_the_payments(client):
    """Список чужих переводов - не для всех: только наставник."""
    assert client.get("/api/admin/payments/orphans").status_code in (401, 403)


def test_the_list_shows_what_waits_for_a_human(client, session, mentor):
    """Наставник видит, что лежит неразобранным, и сумму по-человечески."""
    _orphan(session, amount=bsc.amount_with_tail(49, 0))

    body = client.get("/api/admin/payments/orphans", headers=mentor).json()

    assert len(body["payments"]) == 1
    assert body["payments"][0]["amount"] == "49.00"
    assert body["payments"][0]["resolved_student_id"] is None


def test_resolving_turns_the_money_into_days(client, session, student, mentor):
    """Привязали перевод - человек получил дни, как при обычной оплате."""
    _orphan(session)

    answer = client.post(
        "/api/admin/payments/resolve",
        json={"tx_hash": "0xlost", "tg_id": TG_ID, "reason": "округлил сумму"},
        headers=mentor,
    )

    assert answer.status_code == 200
    body = answer.json()
    # Первая оплата: месяц и подарочная неделя, как у всех.
    assert body["days_added"] == 37
    assert body["days_left"] == 37

    session.expire_all()
    assert session.get(OrphanPayment, "0xlost").resolved_student_id == student.id
    payment = session.query(SubscriptionPayment).one()
    assert payment.tx_hash == "0xlost"
    assert payment.reason == "округлил сумму"


def test_the_same_payment_is_never_resolved_twice(client, session, student, mentor):
    """Разобрали дважды - дни начислены один раз."""
    _orphan(session)
    first = client.post(
        "/api/admin/payments/resolve",
        json={"tx_hash": "0xlost", "tg_id": TG_ID},
        headers=mentor,
    )
    second = client.post(
        "/api/admin/payments/resolve",
        json={"tx_hash": "0xlost", "tg_id": TG_ID},
        headers=mentor,
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert session.query(SubscriptionPayment).count() == 1


def test_resolving_an_unknown_payment_is_a_plain_refusal(client, student, mentor):
    """Хеш с опечаткой - отказ с причиной, а не начисление в пустоту."""
    answer = client.post(
        "/api/admin/payments/resolve",
        json={"tx_hash": "0xnope", "tg_id": TG_ID},
        headers=mentor,
    )

    assert answer.status_code == 404


def test_resolving_to_someone_we_do_not_know(client, session, mentor):
    """Номер чужого человека - отказ: зачесть деньги некому."""
    _orphan(session)

    answer = client.post(
        "/api/admin/payments/resolve",
        json={"tx_hash": "0xlost", "tg_id": 1234567},
        headers=mentor,
    )

    assert answer.status_code == 404
    session.expire_all()
    assert session.get(OrphanPayment, "0xlost").resolved_student_id is None


def test_a_mentor_can_hand_out_days_without_money(client, session, student, mentor):
    """Компенсация за простой: дни выданы, причина записана."""
    answer = client.post(
        "/api/admin/subscription/grant",
        json={"tg_id": TG_ID, "days": 14, "reason": "простой терминала"},
        headers=mentor,
    )

    assert answer.status_code == 200
    assert answer.json()["days_left"] == 14
    payment = session.query(SubscriptionPayment).one()
    assert payment.tx_hash is None and payment.reason == "простой терминала"


def test_the_state_shows_the_history_for_an_argument(client, session, student, mentor):
    """Спор «мне не зачли» разбирается по истории оплат этого человека."""
    session.add(
        Subscription(
            student_id=student.id,
            plan="pro",
            paid_until=datetime.now(timezone.utc) + timedelta(days=10),
            started_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
    )
    session.commit()
    client.post(
        "/api/admin/subscription/grant",
        json={"tg_id": TG_ID, "days": 5, "reason": "обещал в переписке"},
        headers=mentor,
    )

    body = client.get(f"/api/admin/subscription/{TG_ID}", headers=mentor).json()

    assert body["active"] is True
    assert body["payments"][0]["reason"] == "обещал в переписке"
    assert body["payments"][0]["days_added"] == 5
