"""Тесты создания/закрытия сигнала (ментор) и профиля/аналитики ученика."""

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
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/sp.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app)


def _mentor(client):
    tok = client.post("/api/auth/mentor-login", params={"password": "secret"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _student_token(client, uid="123456"):
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=int(uid), username="alex")
        st.weex_uid = uid
        st.is_approved = True
        st.mode = "moderate"
        st.balance_usdt = Decimal("1000")
        s.commit()
    code = client.post("/api/auth/request-code", json={"weex_uid": uid}).json()["code"]
    tokens = client.post("/api/auth/verify", json={"weex_uid": uid, "code": code}).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# ── Создание сигнала ──

def test_create_signal_computes_deliveries(ctx):
    client = ctx
    _student_token(client, "123456")  # одобренный ученик с балансом
    h = _mentor(client)
    r = client.post("/api/signals", headers=h, json={"text": "XLM LONG\nПлечо 20х", "audience": "all"})
    assert r.status_code == 200
    data = r.json()
    assert data["signal"]["symbol"] == "XLMUSDT"
    assert len(data["deliveries"]) == 1
    assert data["deliveries"][0]["status"] == "pending"


def test_create_signal_invalid_text(ctx):
    client = ctx
    h = _mentor(client)
    r = client.post("/api/signals", headers=h, json={"text": "просто текст", "audience": "all"})
    assert r.status_code == 422


def test_create_signal_requires_mentor(ctx):
    client = ctx
    h = _student_token(client)
    assert client.post("/api/signals", headers=h, json={"text": "XLM LONG"}).status_code == 403


def test_close_signal(ctx):
    client = ctx
    h = _mentor(client)
    sid = client.post("/api/signals", headers=h, json={"text": "BTC LONG", "audience": "all"}).json()["signal"]["id"]
    r = client.patch(f"/api/signals/{sid}/close", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "closed"
    assert client.patch("/api/signals/999/close", headers=h).status_code == 404


# ── Профиль ──

def test_get_and_patch_profile(ctx):
    client = ctx
    h = _student_token(client, "123456")
    r = client.get("/api/profile", headers=h)
    assert r.status_code == 200 and r.json()["mode"] == "moderate"

    r = client.patch("/api/profile", headers=h, json={"mode": "turbo", "language": "en"})
    assert r.status_code == 200 and r.json()["mode"] == "turbo" and r.json()["language"] == "en"


def test_profile_requires_auth(ctx):
    assert ctx.get("/api/profile").status_code == 401


def test_refresh_balance(ctx):
    client = ctx
    h = _student_token(client, "123456")
    r = client.get("/api/profile/balance", headers=h)
    assert r.status_code == 200
    assert Decimal(str(r.json()["balance_usdt"])) > 0


def test_analytics_me(ctx):
    client = ctx
    h = _student_token(client, "123456")
    mh = _mentor(client)
    client.post("/api/signals", headers=mh, json={"text": "XLM LONG", "audience": "all"})
    r = client.get("/api/analytics/me", headers=h)
    assert r.status_code == 200
    assert r.json()["signals_received"] == 1
