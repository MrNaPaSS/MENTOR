"""Дополнительные тесты API: сигналы, ученики (ментор), edge-cases авторизации."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client
from core.db import SessionLocal
from core import repo


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/more.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=2, expose_codes=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app), config


def _mentor_headers(client):
    token = client.post("/api/auth/mentor-login", params={"password": "secret"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _make_signal():
    with SessionLocal() as s:
        sig = repo.create_signal(
            s, symbol="XLMUSDT", direction="LONG", leverage=20,
            entry_price=Decimal("0.15"), entry_type="market", margin_type="cross",
            target_audience="all", status="active",
        )
        return sig.id


def _make_student(uid="123456"):
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=int(uid), username="alex")
        st.weex_uid = uid
        st.is_approved = True
        st.balance_usdt = Decimal("1000")
        s.commit()
        return st.id


# ── Сигналы ──

def test_signal_get_list_active(ctx):
    client, _ = ctx
    sid = _make_signal()
    assert client.get(f"/api/signals/{sid}").status_code == 200
    assert len(client.get("/api/signals").json()) == 1
    assert len(client.get("/api/signals", params={"status": "active"}).json()) == 1
    assert len(client.get("/api/signals/active").json()) == 1


def test_signal_404(ctx):
    client, _ = ctx
    assert client.get("/api/signals/999").status_code == 404


def test_public_stats_with_data(ctx):
    client, _ = ctx
    _make_signal()
    _make_student()
    data = client.get("/api/stats/public").json()
    assert data["total_signals"] == 1 and data["active_signals"] == 1
    assert data["active_students"] == 1
    assert len(client.get("/api/stats/leaderboard").json()) == 1


# ── Ученики (ментор) ──

def test_students_crud(ctx):
    client, _ = ctx
    sid = _make_student()
    h = _mentor_headers(client)

    assert client.get(f"/api/students/{sid}", headers=h).status_code == 200
    assert client.get("/api/students/999", headers=h).status_code == 404

    r = client.patch(f"/api/students/{sid}", headers=h, json={"mode": "turbo", "is_active": False})
    assert r.status_code == 200 and r.json()["mode"] == "turbo"

    r = client.post(f"/api/students/{sid}/approve", headers=h)
    assert r.status_code == 200 and r.json()["is_approved"] is True

    assert client.delete(f"/api/students/{sid}", headers=h).status_code == 200
    assert client.get(f"/api/students/{sid}", headers=h).status_code == 404


def test_students_forbidden_for_student_token(ctx):
    client, _ = ctx
    _make_student()
    client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    code = client.post("/api/auth/request-code", json={"weex_uid": "123456"}).json()["code"]
    tokens = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": code}).json()
    h = {"Authorization": f"Bearer {tokens['access_token']}"}
    # У ученика роль != mentor → 403.
    assert client.get("/api/students", headers=h).status_code == 403


# ── Авторизация: edge-cases ──

def test_verify_without_request(ctx):
    client, _ = ctx
    _make_student()
    assert client.post("/api/auth/verify", json={"weex_uid": "123456", "code": "111111"}).status_code == 400


def test_too_many_attempts(ctx):
    client, config = ctx
    _make_student()
    client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    # max_code_attempts = 2: два неверных, затем блок.
    for _ in range(config.max_code_attempts):
        r = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": "000000"})
        assert r.status_code == 400
    r = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": "000000"})
    assert r.status_code == 429


def test_refresh_rejects_access_token(ctx):
    client, _ = ctx
    _make_student()
    code = client.post("/api/auth/request-code", json={"weex_uid": "123456"}).json()["code"]
    tokens = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": code}).json()
    # передаём access вместо refresh
    r = client.post("/api/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert r.status_code == 401


def test_request_code_for_unapproved_student(ctx):
    client, _ = ctx
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=777, username="new")
        st.weex_uid = "777777"
        st.is_approved = False
        s.commit()
    assert client.post("/api/auth/request-code", json={"weex_uid": "777777"}).status_code == 403


def test_protected_requires_token(ctx):
    client, _ = ctx
    assert client.get("/api/students", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/api/students").status_code == 401


def test_expired_code(ctx):
    client, _ = ctx
    _make_student()
    client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    # Принудительно «состариваем» код в БД.
    from datetime import datetime, timedelta, timezone
    from core.models import AuthCode
    with SessionLocal() as s:
        row = s.query(AuthCode).filter(AuthCode.weex_uid == "123456").one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        s.commit()
    r = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": "000000"})
    assert r.status_code == 400 and "истёк" in r.json()["detail"].lower()
