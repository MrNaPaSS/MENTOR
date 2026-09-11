"""Кэшбэк через API: наставник заводит условия, импорт считает, ученик видит.

Партнёрский отчёт отдаёт мок WEEX: 14 суток по четырём трейдерам, наша доля в
нём - 10% от их комиссии.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.cashback_collector import apply_totals
from backend.config import BackendConfig
from backend.main import create_app
from backend.security import create_access_token
from core.broker.cashback import DayTotal, first_day
from core.db import SessionLocal
from core.models import CashbackAccrual, Student
from core.weex import get_weex_client

MOCK_UID = "3066862000"      # первый трейдер мока, у него есть комиссии


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/cashback.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    cfg = BackendConfig(
        jwt_secret="s", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    return TestClient(create_app(config=cfg, weex=get_weex_client(use_mock=True)))


def _mentor(client) -> dict:
    token = client.post("/api/auth/mentor-login", json={"password": "secret"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _student(uid: str = MOCK_UID) -> dict:
    with SessionLocal() as session:
        student = Student(username="trader", weex_uid=f"PO{uid}", is_approved=True)
        session.add(student)
        session.commit()
        student_id = student.id
    token = create_access_token(str(student_id), "student", "s", 900)
    return {"Authorization": f"Bearer {token}"}


def _program(client, headers, **body) -> dict:
    payload = {"trader_share": "0.05", "min_margin": "0.02", **body}
    return client.post("/api/admin/cashback/program", json=payload, headers=headers)


def test_admin_endpoints_need_mentor(client):
    assert client.get("/api/admin/cashback/overview").status_code == 401
    assert client.get("/api/admin/cashback/overview", headers=_student()).status_code == 403


def test_program_versions_are_kept(client):
    mentor = _mentor(client)
    assert _program(client, mentor, trader_share="0.05").status_code == 200
    assert _program(client, mentor, trader_share="0.07").status_code == 200

    state = client.get("/api/admin/cashback/program", headers=mentor).json()
    assert Decimal(state["current"]["trader_share"]) == Decimal("0.07")
    assert len(state["history"]) == 2


def test_program_cannot_start_in_the_past(client):
    """Кэшбэк за прошедшие сутки трейдер уже видел - переписывать его нельзя."""
    response = _program(client, _mentor(client), valid_from="2020-01-01")
    assert response.status_code == 422


def test_program_rejects_share_above_one(client):
    assert _program(client, _mentor(client), trader_share="1.5").status_code == 422


def test_import_fills_overview_and_trader_sees_cashback(client):
    mentor = _mentor(client)
    student = _student()
    _program(client, mentor)

    written = client.post("/api/admin/cashback/import", headers=mentor).json()["written"]
    assert written > 0

    summary = client.get("/api/admin/cashback/overview", headers=mentor).json()
    assert Decimal(summary["cashback"]) > 0
    assert Decimal(summary["cashback"]) + Decimal(summary["nmnh"]) == Decimal(summary["commission"])
    # Ученик заведён только один, остальные трейдеры мока - неопознанные рефералы.
    assert summary["unmatched"] == summary["traders"] - 1

    mine = client.get("/api/cashback/me", headers=student).json()
    assert mine["enabled"] is True
    assert Decimal(mine["trader_share"]) == Decimal("0.05")
    assert Decimal(mine["cashback"]) > 0
    assert mine["days"]

    rows = client.get("/api/admin/cashback/traders", headers=mentor).json()
    assert any(row["uid"] == MOCK_UID and row["username"] == "trader" for row in rows)


def test_without_program_everything_stays_with_nmnh(client):
    mentor = _mentor(client)
    client.post("/api/admin/cashback/import", headers=mentor)
    summary = client.get("/api/admin/cashback/overview", headers=mentor).json()
    assert Decimal(summary["cashback"]) == 0
    assert Decimal(summary["nmnh"]) == Decimal(summary["commission"])


def test_paid_accrual_is_never_rewritten(client):
    """Деньги ушли - цифра под ними остаётся той, по которой платили."""
    today = first_day(1)
    with SessionLocal() as session:
        session.add(CashbackAccrual(
            exchange="weex", uid=MOCK_UID, day=today,
            fee=Decimal("10"), commission=Decimal("1"), cashback=Decimal("0.5"),
            nmnh=Decimal("0.5"), status="paid",
        ))
        session.commit()

        apply_totals(session, [DayTotal(MOCK_UID, today, Decimal("999"), Decimal("99"))])
        session.commit()

        row = session.query(CashbackAccrual).filter_by(uid=MOCK_UID, day=today).one()
        assert row.fee == Decimal("10")
        assert row.cashback == Decimal("0.5")
