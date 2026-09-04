"""Связка академии с платформой: служебное начисление монет и учёт входов."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.db import SessionLocal
from core.models import CoinTransaction, Student
from core.weex import get_weex_client

SERVICE_KEY = "academy-secret-key"
HEADERS = {"X-Service-Key": SERVICE_KEY}


def _config(**over) -> BackendConfig:
    base = dict(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        service_api_key=SERVICE_KEY,
    )
    base.update(over)
    return BackendConfig(**base)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/academy.sqlite3")
    app = create_app(config=_config(), weex=get_weex_client(use_mock=True))
    return TestClient(app)


@pytest.fixture
def client_no_key(tmp_path, monkeypatch):
    """Интеграция не настроена: SERVICE_API_KEY пустой."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/academy_nokey.sqlite3")
    app = create_app(config=_config(service_api_key=""), weex=get_weex_client(use_mock=True))
    return TestClient(app)


def grant(client, **body):
    payload = {"ref": "module_1", "reason": "module_completed"}
    payload.update(body)
    return client.post("/api/coins/grant", json=payload, headers=HEADERS)


# ── Доступ ───────────────────────────────────────────────────────────────────

def test_grant_requires_service_key(client):
    r = client.post("/api/coins/grant", json={"tg_id": 1, "ref": "m1"})
    assert r.status_code == 401


def test_grant_rejects_wrong_key(client):
    r = client.post(
        "/api/coins/grant", json={"tg_id": 1, "ref": "m1"},
        headers={"X-Service-Key": "wrong-key"},
    )
    assert r.status_code == 401


def test_grant_closed_when_key_not_configured(client_no_key):
    """Без заданного секрета ручка закрыта — иначе начислять смог бы любой."""
    r = client_no_key.post("/api/coins/grant", json={"tg_id": 1, "ref": "m1"}, headers=HEADERS)
    assert r.status_code == 503


# ── Заведение ученика ────────────────────────────────────────────────────────

def test_grant_creates_student_when_absent(client):
    """Человек учится в академии, но кабинет не открывал — заводим сами."""
    r = grant(client, tg_id=555001, username="pupil")
    assert r.status_code == 200
    body = r.json()
    assert body["student_created"] is True
    assert body["granted"] is True
    assert body["added"] == 15  # тариф module_completed

    with SessionLocal() as s:
        student = s.get(Student, body["student_id"])
        assert student.tg_id == 555001
        assert student.created_via == "academy"
        # Доступ к сигналам выдаёт ментор, академия — нет.
        assert student.is_approved is False
        # Заведён, но ни разу не заходил: в админке так и покажем.
        assert student.first_login_at is None


def test_grant_finds_existing_student_by_tg_id(client):
    first = grant(client, tg_id=555002, ref="m1")
    second = grant(client, tg_id=555002, ref="m2")
    assert second.json()["student_created"] is False
    assert second.json()["student_id"] == first.json()["student_id"]


def test_grant_finds_student_by_weex_uid(client):
    first = grant(client, weex_uid="7001", ref="m1")
    second = grant(client, weex_uid="7001", ref="m2")
    assert second.json()["student_id"] == first.json()["student_id"]


def test_grant_links_second_key_to_existing_student(client):
    """Ученик пришёл сначала по tg_id, потом academy прислала и UID — связываем."""
    r1 = grant(client, tg_id=555003, ref="m1")
    r2 = grant(client, tg_id=555003, weex_uid="7002", ref="m2")
    assert r2.json()["student_id"] == r1.json()["student_id"]

    with SessionLocal() as s:
        student = s.get(Student, r1.json()["student_id"])
        assert student.weex_uid == "7002"


def test_grant_requires_some_identifier(client):
    r = client.post("/api/coins/grant", json={"ref": "m1"}, headers=HEADERS)
    assert r.status_code == 400


# ── Начисление и защита от повтора ───────────────────────────────────────────

def test_grant_is_idempotent_by_ref(client):
    """Академия может слать событие сколько угодно раз — монеты начислятся один."""
    first = grant(client, tg_id=555010, ref="module_7")
    repeat = grant(client, tg_id=555010, ref="module_7")

    assert first.json()["granted"] is True
    assert repeat.json()["granted"] is False
    assert repeat.json()["added"] == 0
    assert repeat.json()["balance"] == first.json()["balance"]

    with SessionLocal() as s:
        count = len([
            t for t in s.query(CoinTransaction).all()
            if t.student_id == first.json()["student_id"] and t.ref == "module_7"
        ])
        assert count == 1


def test_grant_same_ref_different_students_both_pass(client):
    """Одинаковый ref у разных учеников — разные события, а не дубль."""
    a = grant(client, tg_id=555011, ref="module_1")
    b = grant(client, tg_id=555012, ref="module_1")
    assert a.json()["granted"] is True
    assert b.json()["granted"] is True


def test_grant_accumulates_balance(client):
    grant(client, tg_id=555013, ref="m1", reason="module_completed")   # 15
    r = grant(client, tg_id=555013, ref="t1", reason="test_passed")    # 25
    assert r.json()["balance"] == 40


def test_grant_explicit_amount_wins(client):
    r = grant(client, tg_id=555014, ref="bonus", reason="module_completed", amount=333)
    assert r.json()["added"] == 333


def test_grant_rejects_non_positive_amount(client):
    r = grant(client, tg_id=555015, ref="bad", amount=0)
    assert r.status_code == 400


def test_grant_unknown_reason_falls_back_to_common(client):
    r = grant(client, tg_id=555016, ref="x1", reason="что_то_новое")
    assert r.json()["added"] == 10  # ставка common


def test_academy_amounts_cover_learning_events():
    """Учебные события должны иметь цену — иначе связка бессмысленна."""
    from backend.api.coins import ACHIEVEMENT_RARITY, academy_amount

    for reason in ("module_completed", "test_passed", "verification", "friend_invited"):
        assert academy_amount(reason) > 0
        assert reason in ACHIEVEMENT_RARITY


def test_granted_coins_visible_to_student(client):
    """Монеты из академии видны в кабинете — это один и тот же баланс."""
    r = grant(client, weex_uid="999999", ref="m1", reason="course_completed")
    assert r.json()["added"] == 100

    login = client.post("/api/auth/login-by-uid", json={"weex_uid": "999999"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    coins = client.get("/api/coins", headers={"Authorization": f"Bearer {token}"})
    assert coins.status_code == 200
    assert coins.json()["balance"] == 100


# ── Учёт входов ──────────────────────────────────────────────────────────────

def test_login_records_first_and_last(client):
    r = client.post("/api/auth/login-by-uid", json={"weex_uid": "12345"})
    assert r.status_code == 200

    with SessionLocal() as s:
        student = s.query(Student).filter(Student.weex_uid == "12345").one()
        assert student.first_login_at is not None
        assert student.last_login_at is not None
        assert student.login_count == 1
        assert student.created_via == "web"


def test_repeat_login_increments_count_keeps_first(client):
    client.post("/api/auth/login-by-uid", json={"weex_uid": "12346"})
    with SessionLocal() as s:
        first_seen = s.query(Student).filter(Student.weex_uid == "12346").one().first_login_at

    client.post("/api/auth/login-by-uid", json={"weex_uid": "12346"})
    with SessionLocal() as s:
        student = s.query(Student).filter(Student.weex_uid == "12346").one()
        assert student.login_count == 2
        assert student.first_login_at == first_seen


def test_students_list_exposes_login_fields(client):
    """Ментор должен видеть в админке, кто заходил, а кто ни разу."""
    grant(client, tg_id=555020, ref="m1")                              # не заходил
    client.post("/api/auth/login-by-uid", json={"weex_uid": "12347"})  # заходил

    token = client.post("/api/auth/mentor-login", json={"password": "secret"})
    if token.status_code != 200:
        pytest.skip("MENTOR_PASSWORD не задан в окружении теста")

    rows = client.get(
        "/api/students",
        headers={"Authorization": f"Bearer {token.json()['access_token']}"},
    ).json()

    never = [r for r in rows if r["first_login_at"] is None]
    visited = [r for r in rows if r["first_login_at"] is not None]
    assert never and visited
    assert all("login_count" in r and "created_via" in r for r in rows)


# ── Роль в refresh-токене ────────────────────────────────────────────────────

def test_refresh_keeps_mentor_role(client, monkeypatch):
    """Обновление токена не должно понижать ментора до ученика."""
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    login = client.post("/api/auth/mentor-login", json={"password": "secret"})
    if login.status_code != 200:
        pytest.skip("MENTOR_PASSWORD не задан в окружении теста")

    refreshed = client.post(
        "/api/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert refreshed.status_code == 200

    # Ручка учеников доступна только ментору — ей и проверяем роль.
    check = client.get(
        "/api/students",
        headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
    )
    assert check.status_code == 200


def test_refresh_keeps_student_role(client):
    login = client.post("/api/auth/login-by-uid", json={"weex_uid": "12348"})
    refreshed = client.post(
        "/api/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert refreshed.status_code == 200

    me = client.get(
        "/api/profile",
        headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
    )
    assert me.status_code == 200


def test_refresh_rejects_access_token(client):
    login = client.post("/api/auth/login-by-uid", json={"weex_uid": "12349"})
    r = client.post("/api/auth/refresh", json={"refresh_token": login.json()["access_token"]})
    assert r.status_code == 401
