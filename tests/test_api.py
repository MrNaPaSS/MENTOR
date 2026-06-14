"""Тесты бэкенда FastAPI (TestClient, in-memory-подобная БД на временном файле)."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client
from core.db import SessionLocal
from core import repo


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/api.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_price(client):
    r = client.get("/api/market/price/BTCUSDT")
    assert r.status_code == 200
    assert Decimal(str(r.json()["price"])) > 0


def test_calculate_endpoint(client):
    r = client.post("/api/market/calculate", json={
        "mode": "moderate", "balance": "1000", "entry_price": "100",
        "direction": "LONG", "leverage": 10,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["leverage"] == 10
    assert len(data["take_profits"]) == 3
    assert Decimal(str(data["margin_usd"])) > 0


def test_public_stats_empty(client):
    r = client.get("/api/stats/public")
    assert r.status_code == 200
    assert r.json()["total_signals"] == 0


def test_signals_list_empty(client):
    assert client.get("/api/signals").json() == []


def _seed_student(uid="123456", approved=True):
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=int(uid), username="alex")
        st.weex_uid = uid
        st.is_approved = approved
        st.balance_usdt = Decimal("1000")
        s.commit()
        return st.id


def test_auth_flow_student(client):
    _seed_student("123456")
    r = client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    assert r.status_code == 200
    code = r.json()["code"]
    assert code is not None

    r = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": code})
    assert r.status_code == 200
    tokens = r.json()
    assert tokens["access_token"] and tokens["refresh_token"]

    # refresh выдаёт новый access
    r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_auth_wrong_code(client):
    _seed_student("123456")
    client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    r = client.post("/api/auth/verify", json={"weex_uid": "123456", "code": "000000"})
    assert r.status_code == 400


def test_auth_uid_not_found(client):
    r = client.post("/api/auth/request-code", json={"weex_uid": "404"})
    assert r.status_code == 404


def test_students_requires_mentor(client):
    assert client.get("/api/students").status_code == 401


def test_mentor_login_and_list(client):
    _seed_student("123456")
    r = client.post("/api/auth/mentor-login", params={"password": "secret"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    r = client.get("/api/students", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_mentor_login_bad_password(client):
    assert client.post("/api/auth/mentor-login", params={"password": "nope"}).status_code == 401
