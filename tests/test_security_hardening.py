"""Правки безопасности: вход разработчика, токены, заголовки, служебный ключ, пределы.

Всё здесь ломается молча: битый токен выглядит падением сервера, украденный
токен наставника - обычной работой, превью ссылки - безобидной картинкой.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import time

# Приложение собирается на импорте модуля и требует секрет из окружения.
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from backend.config import BackendConfig  # noqa: E402
from backend.main import create_app  # noqa: E402
from backend.ratelimit import RateLimiter  # noqa: E402
from backend.security import (  # noqa: E402
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    mentor_mark,
    mentor_token_alive,
)
from core.weex import get_weex_client  # noqa: E402

SECRET = "s"
SERVICE_KEY = "svc-key"


def _config(**over) -> BackendConfig:
    base = dict(
        jwt_secret=SECRET,
        access_ttl_seconds=900,
        refresh_ttl_seconds=86400,
        weex_use_mock=True,
        code_ttl_seconds=300,
        max_code_attempts=5,
        expose_codes=True,
        dev_login=False,
        service_api_key=SERVICE_KEY,
    )
    base.update(over)
    return BackendConfig(**base)


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/sec.sqlite3")
    monkeypatch.delenv("MENTOR_TOKENS_NOT_BEFORE", raising=False)

    def build(base_url: str = "http://testserver", **over) -> TestClient:
        app = create_app(config=_config(**over), weex=get_weex_client(use_mock=True))
        return TestClient(app, base_url=base_url)

    return build


# ── Вход разработчика ──────────────────────────────────────────────────────


def test_dev_login_needs_explicit_flag_even_on_mock(monkeypatch):
    monkeypatch.setenv("WEEX_USE_MOCK", "true")
    monkeypatch.delenv("DEV_LOGIN", raising=False)
    assert BackendConfig.from_env().dev_login is False
    monkeypatch.setenv("DEV_LOGIN", "true")
    assert BackendConfig.from_env().dev_login is True


# ── Испорченные токены - 401, а не 500 ──────────────────────────────────────


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _signed(header: dict, payload: dict, secret: str = SECRET) -> str:
    head = _b64(json.dumps(header).encode())
    body = _b64(json.dumps(payload).encode())
    sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(sig)}"


@pytest.mark.parametrize(
    "token",
    ["", "abc", "a.b", "a.b.c", "!!!.???.***", "йцу.кен.гшщ", f"{_b64(b'[1]')}.{_b64(b'{}')}.x"],
)
def test_garbage_tokens_are_token_errors(token):
    with pytest.raises(TokenError):
        decode_token(token, SECRET)


def test_foreign_algorithm_is_rejected():
    token = _signed({"alg": "none"}, {"sub": "1", "type": "access"})
    with pytest.raises(TokenError):
        decode_token(token, SECRET)


def test_non_object_payload_is_rejected():
    token = _signed({"alg": "HS256"}, {"sub": "1"})
    head, _, _ = token.split(".")
    body = _b64(b"[1, 2]")
    sig = hmac.new(SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    with pytest.raises(TokenError):
        decode_token(f"{head}.{body}.{_b64(sig)}", SECRET)


def test_broken_bearer_gives_401(make_client):
    client = make_client()
    r = client.get("/api/profile", headers={"Authorization": "Bearer !!!.@@@.###"})
    assert r.status_code == 401


def test_mentor_token_on_student_route_gives_401(make_client):
    client = make_client()
    token = create_access_token("mentor", "mentor", SECRET, 900)
    r = client.get("/api/profile", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


# ── Токены наставника отзываются ────────────────────────────────────────────


def test_mentor_token_follows_password(make_client, monkeypatch):
    monkeypatch.setenv("MENTOR_PASSWORD", "old-pass")
    client = make_client()
    pair = client.post("/api/auth/mentor-login", json={"password": "old-pass"}).json()
    auth = {"Authorization": f"Bearer {pair['access_token']}"}
    assert client.get("/api/students", headers=auth).status_code == 200

    # Обновление сохраняет отпечаток: при том же пароле вход продолжается.
    renewed = client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert renewed.status_code == 200
    fresh = {"Authorization": f"Bearer {renewed.json()['access_token']}"}
    assert client.get("/api/students", headers=fresh).status_code == 200

    monkeypatch.setenv("MENTOR_PASSWORD", "new-pass")
    assert client.get("/api/students", headers=auth).status_code == 401
    assert client.get("/api/students", headers=fresh).status_code == 401
    r = client.post("/api/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert r.status_code == 401


def test_legacy_mentor_token_lives_until_switch(make_client, monkeypatch):
    monkeypatch.setenv("MENTOR_PASSWORD", "p")
    client = make_client()
    legacy = create_access_token("mentor", "mentor", SECRET, 900)
    auth = {"Authorization": f"Bearer {legacy}"}
    assert client.get("/api/students", headers=auth).status_code == 200

    monkeypatch.setenv("MENTOR_TOKENS_NOT_BEFORE", str(int(time.time()) + 5))
    assert client.get("/api/students", headers=auth).status_code == 401


def test_mentor_login_survives_non_ascii_password(make_client, monkeypatch):
    monkeypatch.setenv("MENTOR_PASSWORD", "p")
    client = make_client()
    assert client.post("/api/auth/mentor-login", json={"password": "пароль"}).status_code == 401


def test_mentor_token_alive_rules():
    mark = mentor_mark("secret")
    assert mentor_token_alive({"pv": mark, "iat": 100}, "secret")
    assert not mentor_token_alive({"pv": mark, "iat": 100}, "other")
    assert not mentor_token_alive({"pv": mark, "iat": 100}, "")
    assert mentor_token_alive({"iat": 100}, "secret")
    assert not mentor_token_alive({"iat": 100}, "secret", not_before=200)


# ── Заголовки безопасности ──────────────────────────────────────────────────


def test_security_headers_on_every_response(make_client):
    r = make_client().get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "SAMEORIGIN"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "strict-transport-security" not in r.headers


def test_hsts_only_over_https(make_client):
    r = make_client(base_url="https://testserver").get("/api/health")
    assert r.headers["strict-transport-security"].startswith("max-age=")


# ── Служебный ключ и адрес академии ─────────────────────────────────────────


def _ask_code(client: TestClient, tg_id: int = 5, key: str = SERVICE_KEY):
    return client.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": key},
        json={"tg_id": tg_id, "weex_uid": "8812345", "username": "who"},
    )


def test_service_key_respects_address_list(make_client):
    assert _ask_code(make_client(service_allowed_ips=("10.9.9.9",))).status_code == 403
    assert _ask_code(make_client(service_allowed_ips=("testclient",))).status_code == 200


def test_service_key_non_ascii_is_refused_not_crashed(make_client):
    r = make_client().post(
        "/api/auth/tg/code",
        # Байтами: строку с не-ASCII тестовый клиент сам отказывается слать.
        headers={"X-Service-Key": "ключ".encode("utf-8")},
        json={"tg_id": 5, "weex_uid": "8812345", "username": "who"},
    )
    assert r.status_code == 401


# ── Пределы входа ───────────────────────────────────────────────────────────


def test_refresh_has_its_own_budget(make_client):
    client = make_client(rate_limit_max=2, refresh_rate_max=5)
    body = {"refresh_token": "x.y.z"}
    codes = [client.post("/api/auth/refresh", json=body).status_code for _ in range(5)]
    assert 429 not in codes
    assert client.post("/api/auth/refresh", json=body).status_code == 429
    # Общий счёт входа обновлениями не тронут.
    assert client.post("/api/auth/mentor-login", json={"password": "x"}).status_code == 401


def test_limiter_forgets_idle_keys():
    limiter = RateLimiter(5, 10)
    limiter.SWEEP_EVERY = 3
    limiter.record("a", now=0)
    limiter.record("b", now=0)
    limiter.record("c", now=100)
    assert set(limiter._hits) == {"c"}


def test_tg_code_cache_drops_expired():
    from backend.api.auth import _remember_code

    cache = {1: ("OLD", time.time() - 1), 3: ("LIVE", time.time() + 60)}
    _remember_code(cache, 2, "NEW", 300)
    assert 1 not in cache
    assert cache[2][0] == "NEW"
    assert cache[3][0] == "LIVE"


# ── Сокет чата и правило «один вход» ────────────────────────────────────────


def _login(client: TestClient, tg_id: int = 77) -> dict:
    code = _ask_code(client, tg_id=tg_id).json()["code"]
    r = client.post("/api/auth/tg/verify", json={"code": code})
    assert r.status_code == 200
    return r.json()


def test_chat_socket_drops_displaced_device(make_client):
    client = make_client()
    first = _login(client)
    second = _login(client)

    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect(f"/ws/chat?token={first['access_token']}") as ws:
            ws.receive_json()
    assert info.value.code == 4401

    # Комната сперва объявляет вошедшего всем (people), потом здоровается с ним.
    with client.websocket_connect(f"/ws/chat?token={second['access_token']}") as ws:
        events = [ws.receive_json()["event"] for _ in range(2)]
    assert "hello" in events


# ── Открытый кэш свечей ─────────────────────────────────────────────────────


def test_klines_cache_is_bounded(monkeypatch):
    from backend.api import scalping

    monkeypatch.setattr(scalping, "_KLINES_CACHE_MAX", 3)
    monkeypatch.setattr(scalping, "_klines_cache", {})
    for i in range(5):
        scalping._remember_klines(f"k{i}", float(i), [])
    assert list(scalping._klines_cache) == ["k2", "k3", "k4"]


@pytest.mark.parametrize("symbol", ["BTCUSDT", "1000PEPEUSDT", "牛来USDT", "BTCUSDT_250926"])
def test_klines_symbol_accepts_real_names(symbol):
    from backend.api import scalping

    assert scalping._SYMBOL.fullmatch(symbol)


@pytest.mark.parametrize("symbol", ["B", "BTC/USDT", "BTC USDT", "../x", "a" * 41])
def test_klines_symbol_rejects_garbage(symbol):
    from backend.api import scalping

    assert not scalping._SYMBOL.fullmatch(symbol)


# ── Секреты не видны в repr ─────────────────────────────────────────────────


def test_credentials_repr_hides_secrets():
    from core.oauth import Grant
    from core.weex.futures import Credentials

    creds = repr(Credentials("KEY-111", "SECRET-222", "PASS-333"))
    assert "SECRET-222" not in creds and "PASS-333" not in creds and "KEY-111" not in creds

    grant = repr(Grant("ACCESS-444", "REFRESH-555", 60, "KEY-666", "SECRET-777", "PASS-888", "42"))
    for secret in ("ACCESS-444", "REFRESH-555", "KEY-666", "SECRET-777", "PASS-888"):
        assert secret not in grant


# ── Партнёрский клиент WEEX проверяет сертификат ────────────────────────────


def _partner_session_params():
    from core.weex.real import RealWeexClient

    async def run():
        client = RealWeexClient("k", "s", "p")
        http = await client._get_session()
        try:
            return http.connector._ssl, http.timeout.total
        finally:
            await client.close()

    return asyncio.run(run())


def test_partner_session_verifies_certificates(monkeypatch):
    monkeypatch.delenv("WEEX_PARTNER_SSL_VERIFY", raising=False)
    ssl_context, total = _partner_session_params()
    assert ssl_context is not False
    assert total == 20


def test_partner_ssl_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("WEEX_PARTNER_SSL_VERIFY", "false")
    ssl_context, _ = _partner_session_params()
    assert ssl_context is False
