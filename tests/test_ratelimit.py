"""Тесты rate limiting и CORS."""

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from backend.ratelimit import RateLimiter
from core.weex import get_weex_client


# ── RateLimiter (юнит) ──

def test_limiter_allows_until_max():
    rl = RateLimiter(max_requests=3, window_seconds=100)
    assert [rl.allow("k", now=0) for _ in range(3)] == [True, True, True]
    assert rl.allow("k", now=0) is False  # 4-й — отказ


def test_limiter_window_slides():
    rl = RateLimiter(max_requests=1, window_seconds=10)
    assert rl.allow("k", now=0) is True
    assert rl.allow("k", now=5) is False     # в окне
    assert rl.allow("k", now=11) is True      # окно сдвинулось


def test_limiter_keys_independent():
    rl = RateLimiter(max_requests=1, window_seconds=100)
    assert rl.allow("a", now=0) is True
    assert rl.allow("b", now=0) is True


# ── Интеграция: лимит на /api/auth/* ──

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/rl.sqlite3")
    config = BackendConfig(
        jwt_secret="s", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        rate_limit_max=3, rate_limit_window=900, allowed_origins=("http://localhost:3000",),
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app)


def test_auth_endpoint_rate_limited(client):
    # Лимит 3: первые три запроса проходят (404 UID), четвёртый — 429.
    for _ in range(3):
        r = client.post("/api/auth/request-code", json={"weex_uid": "404"})
        assert r.status_code != 429
    r = client.post("/api/auth/request-code", json={"weex_uid": "404"})
    assert r.status_code == 429
    assert "много" in r.json()["detail"].lower()


def test_non_auth_endpoint_not_limited(client):
    # health не под /api/auth — лимит не применяется.
    for _ in range(10):
        assert client.get("/api/health").status_code == 200


def test_cors_header_reflects_allowed_origin(client):
    r = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
