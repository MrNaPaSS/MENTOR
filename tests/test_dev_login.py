"""Тесты dev-входа (без кода/пароля, только не в проде)."""

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client


def _client(tmp_path, dev_login):
    cfg = BackendConfig(
        jwt_secret="s", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        dev_login=dev_login,
    )
    import os
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/dev.sqlite3"
    return TestClient(create_app(config=cfg, weex=get_weex_client(use_mock=True)))


def test_dev_login_issues_tokens_and_seeds(tmp_path):
    client = _client(tmp_path, dev_login=True)
    r = client.post("/api/auth/dev-login")
    assert r.status_code == 200
    data = r.json()
    assert data["mentor"]["access_token"]
    assert data["student"]["access_token"] and data["student"]["refresh_token"]

    # Токен ментора работает на защищённом эндпоинте.
    mh = {"Authorization": f"Bearer {data['mentor']['access_token']}"}
    assert client.get("/api/students", headers=mh).status_code == 200
    # Демо-ученик и демо-сигнал созданы.
    assert len(client.get("/api/signals").json()) >= 1

    # Токен ученика работает на профиле.
    sh = {"Authorization": f"Bearer {data['student']['access_token']}"}
    assert client.get("/api/profile", headers=sh).status_code == 200


def test_dev_login_disabled_in_prod(tmp_path):
    client = _client(tmp_path, dev_login=False)
    assert client.post("/api/auth/dev-login").status_code == 403


def test_config_dev_login_enabled_on_mock(monkeypatch):
    monkeypatch.setenv("WEEX_USE_MOCK", "true")
    monkeypatch.delenv("DEV_LOGIN", raising=False)
    assert BackendConfig.from_env().dev_login is True


def test_config_dev_login_off_in_prod(monkeypatch):
    monkeypatch.setenv("WEEX_USE_MOCK", "false")
    monkeypatch.delenv("DEV_LOGIN", raising=False)
    assert BackendConfig.from_env().dev_login is False
