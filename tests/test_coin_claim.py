"""Награды, которые ждут получения.

Начисление больше не падает в баланс само: награда встаёт в ожидание, и
ученик забирает её руками. Проверяем главное - что ожидающие монеты нельзя
потратить, что забрать их можно ровно один раз, и что долг за убыток,
не поместившийся в пустой баланс, не теряется, а вычитается при получении.
Без последнего награды можно было бы копить не забирая, и сливы ничего бы
не стоили.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.models import CoinTransaction, Student
from core.weex import get_weex_client

SERVICE_KEY = "academy-secret-key"
HEADERS = {"X-Service-Key": SERVICE_KEY}


# ── Учёт на уровне базы ─────────────────────────────────────────────────────


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/claim.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    from backend import coin_ledger

    return db_module, coin_ledger


def _student(session, coins: int = 0) -> Student:
    student = Student(tg_id=1, username="alex", coins=coins)
    session.add(student)
    session.flush()
    return student


def test_награда_ждёт_и_не_меняет_баланс(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=50)
        ledger.add_reward(session, student.id, 10, "trade_win", "trade_t1")
        session.commit()

        assert session.get(Student, student.id).coins == 50
        waiting = ledger.pending_of(session, student.id)
        assert [(t.amount, t.reason) for t in waiting] == [(10, "trade_win")]


def test_получение_переносит_всё_в_баланс(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=5)
        ledger.add_reward(session, student.id, 10, "trade_win", "trade_t1")
        ledger.add_reward(session, student.id, 15, "trade_streak", "streak_t1_3")
        session.commit()

        result = ledger.claim_all(session, student.id)
        session.commit()

        assert result.amount == 25
        assert result.balance == 30
        assert len(result.transactions) == 2
        assert session.get(Student, student.id).coins == 30
        assert ledger.pending_of(session, student.id) == []

        claimed = session.query(CoinTransaction).filter_by(student_id=student.id).all()
        assert all(t.claimed_at is not None for t in claimed)


def test_повторное_получение_ничего_не_даёт(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ledger.add_reward(session, student.id, 10, "trade_win", "trade_t1")
        session.commit()

        ledger.claim_all(session, student.id)
        session.commit()
        again = ledger.claim_all(session, student.id)
        session.commit()

        assert again.amount == 0
        assert again.transactions == ()
        assert session.get(Student, student.id).coins == 10


def test_долг_вычитается_при_получении(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ledger.add_debt(session, student.id, 3, "trade_loss", "trade_t1:debt")
        ledger.add_reward(session, student.id, 10, "trade_win", "trade_t2")
        session.commit()

        result = ledger.claim_all(session, student.id)
        session.commit()

        assert result.amount == 7
        assert session.get(Student, student.id).coins == 7


def test_один_долг_без_наград_забрать_нельзя(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=20)
        ledger.add_debt(session, student.id, 5, "trade_loss", "trade_t1")
        session.commit()

        result = ledger.claim_all(session, student.id)
        session.commit()

        # Забирать нечего: долг ждёт первой награды, а не съедает баланс,
        # который уже был потрачен или заработан раньше.
        assert result.amount == 0
        assert session.get(Student, student.id).coins == 20
        assert len(ledger.pending_of(session, student.id)) == 1


def test_получение_не_уводит_баланс_в_минус(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ledger.add_debt(session, student.id, 5, "trade_loss", "trade_t1")
        ledger.add_reward(session, student.id, 2, "achievement", "first_trade")
        session.commit()

        result = ledger.claim_all(session, student.id)
        session.commit()

        assert result.balance == 0
        assert session.get(Student, student.id).coins == 0
        assert ledger.pending_of(session, student.id) == []


def test_сводка_ожидания(db):
    db_module, ledger = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ledger.add_debt(session, student.id, 5, "trade_loss", "trade_t1")
        ledger.add_reward(session, student.id, 10, "trade_win", "trade_t2")
        ledger.add_reward(session, student.id, 25, "achievement", "streak_7")
        session.commit()

        summary = ledger.summary(ledger.pending_of(session, student.id))
        # Итог - сколько прибавится к балансу; счётчик - сколько наград ждёт.
        # Долг наградой не считается и в значок на шапке не попадает.
        assert summary.total == 30
        assert summary.count == 2


# ── Ручки кабинета ──────────────────────────────────────────────────────────


def _config() -> BackendConfig:
    return BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        service_api_key=SERVICE_KEY, uid_login_enabled=True,
    )


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/claim_api.sqlite3")
    app = create_app(config=_config(), weex=get_weex_client(use_mock=True))
    return TestClient(app)


def _login(client, uid: str) -> dict:
    r = client.post("/api/auth/login-by-uid", json={"weex_uid": uid})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_ожидающие_награды_видны_в_кабинете(client):
    client.post(
        "/api/coins/grant", headers=HEADERS,
        json={"weex_uid": "424242", "ref": "m1", "reason": "module_completed"},
    )
    auth = _login(client, "424242")

    body = client.get("/api/coins", headers=auth).json()
    assert body["balance"] == 0
    assert body["pending_total"] == 15
    assert body["pending_count"] == 1
    assert body["pending"][0]["reason"] == "module_completed"
    assert body["pending"][0]["pending"] is True


def test_получение_через_кабинет(client):
    for ref in ("m1", "m2"):
        client.post(
            "/api/coins/grant", headers=HEADERS,
            json={"weex_uid": "515151", "ref": ref, "reason": "module_completed"},
        )
    auth = _login(client, "515151")

    first = client.post("/api/coins/claim", headers=auth)
    assert first.status_code == 200
    assert first.json()["claimed"] == 30
    assert first.json()["balance"] == 30
    assert len(first.json()["transactions"]) == 2

    second = client.post("/api/coins/claim", headers=auth)
    assert second.json()["claimed"] == 0
    assert second.json()["balance"] == 30

    after = client.get("/api/coins", headers=auth).json()
    assert after["pending"] == []
    assert after["pending_total"] == 0
    assert after["balance"] == 30
    # Забранное уходит в историю начислений.
    assert {t["ref"] for t in after["transactions"]} == {"m1", "m2"}


def test_получение_только_для_вошедшего(client):
    assert client.post("/api/coins/claim").status_code == 401
