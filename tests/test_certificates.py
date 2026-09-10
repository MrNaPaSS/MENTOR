"""Сертификат трейдера: столпы, уровни и выдача только вверх."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.models import Certificate, CoinTransaction, ScalpTrade, Student
from core.weex import get_weex_client


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/certs.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    from backend import certificates

    return db_module, certificates


def _student(session) -> Student:
    s = Student(tg_id=1, username="alex", coins=0)
    session.add(s)
    session.flush()
    return s


def _trades(session, student, *, count: int, start: datetime, per_day: int = 1, stop: float = 99.0, pnl: float = 2.0):
    for i in range(count):
        session.add(ScalpTrade(
            student_id=student.id, client_id=f"t{start.timestamp()}-{stop}-{i}", symbol="BTCUSDT", side="long",
            entry=100.0, stop=stop, exit_price=101.0, qty=1.0, margin=10.0, leverage=10, takes_hit=1,
            outcome="take", pnl=pnl, fee=0.1, closed_at=start + timedelta(days=i // per_day, minutes=i),
            from_exchange=True,
        ))
    session.flush()


def _course(session, student):
    session.add(CoinTransaction(student_id=student.id, amount=100, reason="course_completed", ref="course_1"))
    session.flush()


START = datetime(2026, 8, 1, 10, tzinfo=timezone.utc)


def test_без_столпов_сертификата_нет(db):
    db_module, certs = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ps, cert = certs.issue(session, student.id)
        assert cert is None
        assert [p.done for p in ps] == [False, False, False, False]


def test_три_столпа_серебро(db):
    db_module, certs = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        _course(session, student)
        # 50 сделок в один месяц: практика и развитие, но дней всего 25 - по
        # две сделки в день, со стопом. Это уже три столпа.
        _trades(session, student, count=50, start=START, per_day=10)
        ps, cert = certs.issue(session, student.id)
        done = {p.key for p in ps if p.done}
        assert done == {"knowledge", "practice", "growth"}
        assert cert is not None and cert.level == "silver"


def test_уровень_растёт_только_вверх(db):
    db_module, certs = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        _course(session, student)
        _trades(session, student, count=12, start=START, per_day=12)  # знания + месяц в плюсе
        _, first = certs.issue(session, student.id)
        assert first.level == "bronze"
        # Повторный подсчёт с тем же уровнем второй бронзы не даёт.
        _, again = certs.issue(session, student.id)
        assert again is None

        # 20 дней со стопом и всего больше 50 сделок - золото.
        _trades(session, student, count=40, start=START + timedelta(days=5), per_day=2)
        _, gold = certs.issue(session, student.id)
        assert gold.level == "gold"
        assert session.query(Certificate).count() == 2


def test_день_без_стопа_не_в_счёт_дисциплине(db):
    db_module, certs = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        _trades(session, student, count=25, start=START, stop=99.0)
        _trades(session, student, count=25, start=START, stop=0.0)  # те же дни, без стопа
        ps = {p.key: p for p in certs.pillars(session, student.id)}
        assert ps["discipline"].value == 0


def test_оценка_с_экрана_не_считается(db):
    db_module, certs = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        session.add(ScalpTrade(
            student_id=student.id, client_id="screen", symbol="BTCUSDT", side="long", entry=100.0,
            stop=99.0, exit_price=101.0, qty=1.0, margin=10.0, leverage=10, takes_hit=1,
            outcome="take", pnl=5.0, fee=0.1, closed_at=START, from_exchange=False,
        ))
        session.flush()
        ps = {p.key: p for p in certs.pillars(session, student.id)}
        assert ps["practice"].value == 0


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/certs_api.sqlite3")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        uid_login_enabled=True,
    )
    return TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))


def test_сертификат_выдаётся_и_отмечается_полученным(client):
    from core.db import SessionLocal

    token = client.post("/api/auth/login-by-uid", json={"weex_uid": "810001"}).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    with SessionLocal() as s:
        student = s.query(Student).filter_by(weex_uid="810001").one()
        _course(s, student)
        _trades(s, student, count=12, start=START, per_day=12)
        s.commit()

    body = client.get("/api/certificates", headers=auth).json()
    assert body["level"] == "bronze"
    assert len(body["certificates"]) == 1
    cert = body["certificates"][0]
    assert cert["seen"] is False
    assert cert["number"].startswith("NMNH-")

    assert client.post(f"/api/certificates/{cert['id']}/seen", headers=auth).status_code == 200
    again = client.get("/api/certificates", headers=auth).json()
    assert again["certificates"][0]["seen"] is True
    assert len(again["certificates"]) == 1
