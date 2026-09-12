"""Замок на платной ручке ИИ-разбора (ТЗ этап 3, §6).

`POST /api/institutional/analyze` дергает Claude по нашему ключу. До этой
работы у ручки не было ни токена, ни лимита: счёт за чужие запросы пришёл бы
нам. Проверяем четыре вещи из критерия приёмки: без токена - `401`; шестой
запрос за окно - `429` с `Retry-After`; монеты списываются до вызова и
возвращаются, если вызов не удался; текст ошибки от Anthropic наружу не
уходит.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.models import Student
from core.weex import get_weex_client

PRICE = 50


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    """Приложение со своими пределами: каждый тест получает свой счёт."""

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/ai_guard.sqlite3")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    def build(**over) -> TestClient:
        fields = {
            "jwt_secret": "test-secret", "access_ttl_seconds": 900, "refresh_ttl_seconds": 86400,
            "weex_use_mock": True, "code_ttl_seconds": 300, "max_code_attempts": 5,
            "expose_codes": True, "uid_login_enabled": True,
            "ai_analyze_max": 5, "ai_analyze_window": 900, "ai_analyze_daily": 30,
            "ai_analyze_price": PRICE,
            **over,
        }
        config = BackendConfig(**fields)
        return TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))

    return build


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def _student(client: TestClient, uid: str, coins: int) -> dict:
    from core.db import SessionLocal

    token = client.post("/api/auth/login-by-uid", json={"weex_uid": uid}).json()["access_token"]
    with SessionLocal() as session:
        student = session.query(Student).filter_by(weex_uid=uid).one()
        student.coins = coins
        session.commit()
    return {"Authorization": f"Bearer {token}"}


def _balance(client: TestClient, auth: dict) -> int:
    return client.get("/api/coins", headers=auth).json()["balance"]


def _stub_claude(monkeypatch, answer: str = "## Позиция институционалов\nровно") -> list[str]:
    """Подменить обращение к Anthropic. Возвращает список случившихся вызовов."""
    from backend.api import institutional

    calls: list[str] = []

    async def fake(api_key: str, prompt: str) -> str:
        calls.append(prompt)
        return answer

    monkeypatch.setattr(institutional, "_call_claude", fake)
    return calls


def _stub_broken(monkeypatch, error: str) -> list[str]:
    from backend.api import institutional

    calls: list[str] = []

    async def fake(api_key: str, prompt: str) -> str:
        calls.append(prompt)
        raise institutional.ClaudeError(error)

    monkeypatch.setattr(institutional, "_call_claude", fake)
    return calls


# ── Токен ────────────────────────────────────────────────────────────────────


def test_без_токена_401(client, monkeypatch):
    calls = _stub_claude(monkeypatch)
    answer = client.post("/api/institutional/analyze", json={})
    assert answer.status_code == 401
    assert calls == []


def test_с_токеном_разбор_приходит(client, monkeypatch):
    _stub_claude(monkeypatch)
    auth = _student(client, "uid-ok", coins=1000)
    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 200
    assert "институционалов" in answer.json()["analysis"]


# ── Лимит ────────────────────────────────────────────────────────────────────


def test_шестой_запрос_за_окно_429_с_retry_after(client, monkeypatch):
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-limit", coins=10_000)

    for _ in range(5):
        assert client.post("/api/institutional/analyze", json={}, headers=auth).status_code == 200

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 429
    assert 0 < int(answer.headers["Retry-After"]) <= 900
    # Шестой до Claude не дошёл и монет не стоил.
    assert len(calls) == 5
    assert _balance(client, auth) == 10_000 - 5 * PRICE


def test_суточный_предел_отдельно_от_оконного(make_client, monkeypatch):
    client = make_client(ai_analyze_max=10, ai_analyze_daily=2)
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-daily", coins=10_000)

    for _ in range(2):
        assert client.post("/api/institutional/analyze", json={}, headers=auth).status_code == 200

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 429
    assert int(answer.headers["Retry-After"]) > 900
    assert len(calls) == 2


def test_лимит_считается_по_ученику_а_не_по_адресу(make_client, monkeypatch):
    client = make_client(ai_analyze_max=1)
    _stub_claude(monkeypatch)
    first = _student(client, "uid-one", coins=1000)
    second = _student(client, "uid-two", coins=1000)

    assert client.post("/api/institutional/analyze", json={}, headers=first).status_code == 200
    assert client.post("/api/institutional/analyze", json={}, headers=first).status_code == 429
    # Адрес тот же, ученик другой - предел его не касается.
    assert client.post("/api/institutional/analyze", json={}, headers=second).status_code == 200


# ── Монеты ───────────────────────────────────────────────────────────────────


def test_разбор_стоит_монет(client, monkeypatch):
    _stub_claude(monkeypatch)
    auth = _student(client, "uid-coins", coins=200)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 200
    assert answer.json()["price"] == PRICE
    assert answer.json()["balance"] == 200 - PRICE
    assert _balance(client, auth) == 200 - PRICE


def test_без_монет_понятный_отказ_и_ни_одного_вызова(client, monkeypatch):
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-poor", coins=PRICE - 1)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 400
    assert "NMNH" in answer.json()["detail"]
    assert calls == []
    assert _balance(client, auth) == PRICE - 1


def test_ошибка_вызова_возвращает_монеты(client, monkeypatch):
    calls = _stub_broken(monkeypatch, "overloaded")
    auth = _student(client, "uid-refund", coins=300)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 502
    assert calls  # вызов был, и монеты за него уже списывались
    assert _balance(client, auth) == 300


def test_возврат_не_удался_и_об_этом_сказано_честно(client, monkeypatch):
    """Возврат сам может упасть. Тогда монеты списаны, и обещать возврат нельзя."""
    from backend.api import institutional

    _stub_broken(monkeypatch, "overloaded")

    def сломанный_возврат(*args, **kwargs):
        raise RuntimeError("база недоступна")

    monkeypatch.setattr(institutional.coin_ledger, "refund", сломанный_возврат)
    auth = _student(client, "uid-lost", coins=300)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 502
    assert "наставник" in answer.json()["detail"]
    # Монеты действительно остались списанными - об этом и говорит ответ.
    assert _balance(client, auth) == 300 - PRICE


# ── Размер присланного ───────────────────────────────────────────────────────


def test_огромный_контекст_не_доходит_до_модели(client, monkeypatch):
    """Цена разбора постоянная, а счёт Anthropic - по входным токенам."""
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-fat", coins=1000)

    answer = client.post(
        "/api/institutional/analyze",
        json={"extra_ctx": "а" * 50_000},
        headers=auth,
    )
    assert answer.status_code == 422
    assert calls == []
    assert _balance(client, auth) == 1000


def test_огромный_блок_данных_отклоняется(client, monkeypatch):
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-fatblock", coins=1000)

    answer = client.post(
        "/api/institutional/analyze",
        json={"macro": {"indicators": {str(i): "х" * 200 for i in range(500)}}},
        headers=auth,
    )
    assert answer.status_code == 422
    assert calls == []
    assert _balance(client, auth) == 1000


def test_обычный_запрос_в_пределы_укладывается(client, monkeypatch):
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-normal", coins=1000)

    неделя = {
        "oi": 82_450, "nc_net": 13_780, "nc_net_chg": 890,
        "nc_long_pct": 26.8, "nc_short_pct": 10.1, "c_net": -15_600,
    }
    answer = client.post(
        "/api/institutional/analyze",
        json={
            "cot_btc": {"cot": [неделя, неделя]},
            "macro": {"indicators": {"DXY": {"label": "Индекс доллара", "price": 104.6, "changePct": -0.3}}},
            "extra_ctx": "Ученик спрашивает про ближайшую неделю",
        },
        headers=auth,
    )
    assert answer.status_code == 200
    assert "Индекс доллара" in calls[0]


# ── Молчание об ошибке ───────────────────────────────────────────────────────


def test_детали_ошибки_anthropic_наружу_не_уходят(client, monkeypatch):
    secret = "x-api-key sk-ant-секрет: invalid_request_error на запросе ученика"
    _stub_broken(monkeypatch, secret)
    auth = _student(client, "uid-quiet", coins=300)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 502
    body = answer.text
    assert "sk-ant" not in body
    assert "invalid_request_error" not in body


def test_без_ключа_503_и_монеты_на_месте(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    calls = _stub_claude(monkeypatch)
    auth = _student(client, "uid-nokey", coins=300)

    answer = client.post("/api/institutional/analyze", json={}, headers=auth)
    assert answer.status_code == 503
    assert calls == []
    assert _balance(client, auth) == 300
