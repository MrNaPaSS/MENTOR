"""Оборот в /api/trades/me: журнал подставляется, когда биржа молчит.

Оборот брался только у биржи - партнёрская ручка по UID. Ученик без UID не
проходил дальше раннего выхода, а если строки по его UID в отчёте не
оказывалось, сводка приходила пустой. На нуле оборота обнулялось всё, что на
нём стоит: вехи объёма, дни торговли и путь трейдера - последний вообще не
рисовался.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client
from core.db import SessionLocal
from core.models import ScalpTrade, Student
from core import repo


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/trades.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        uid_login_enabled=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app)


def _student(client, uid="123456"):
    """Ученик с UID: без него в кабинет не войти, вход устроен по нему."""
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=int(uid), username="alex")
        st.weex_uid = uid
        st.is_approved = True
        st.balance_usdt = Decimal("1000")
        s.commit()
        sid = st.id
    code = client.post("/api/auth/request-code", json={"weex_uid": uid}).json()["code"]
    tokens = client.post("/api/auth/verify", json={"weex_uid": uid, "code": code}).json()
    return sid, {"Authorization": f"Bearer {tokens['access_token']}"}


def _forget_uid(student_id: int) -> None:
    """Убрать UID уже после входа: ключи есть, а UID наставник ещё не завёл."""
    with SessionLocal() as s:
        s.get(Student, student_id).weex_uid = None
        s.commit()


def _trade(student_id: int, client_id: str, qty: str, entry: str, exit_price: str,
           fee: str = "0", days_ago: int = 1) -> None:
    closed = datetime.now(timezone.utc) - timedelta(days=days_ago)
    with SessionLocal() as s:
        s.add(ScalpTrade(
            student_id=student_id, client_id=client_id, symbol="BTCUSDT", side="short",
            entry=Decimal(entry), stop=Decimal("80000"), exit_price=Decimal(exit_price),
            qty=Decimal(qty), margin=Decimal("100"), leverage=20,
            outcome="take", pnl=Decimal("10"), fee=Decimal(fee), closed_at=closed,
        ))
        s.commit()


def test_volume_from_journal_when_partner_row_missing(ctx):
    """Строки по UID в отчёте нет - оборот берём из журнала, а не ноль."""
    client = ctx
    sid, h = _student(client)
    _trade(sid, "t1", qty="2", entry="100", exit_price="110", fee="1.5")

    r = client.get("/api/trades/me?days=90", headers=h)
    assert r.status_code == 200
    summary = r.json()["summary"]
    assert summary is not None
    # Обе ноги: 2x100 + 2x110.
    assert summary["total_volume"] == pytest.approx(420.0)
    assert summary["commission"] == pytest.approx(1.5)


def test_volume_from_journal_without_uid(ctx):
    """UID не заведён - ручка всё равно отвечает оборотом.

    Раньше здесь стоял ранний выход: терминал работает по ключам, а UID заводит
    наставник, и до тех пор ученик видел нулевой путь трейдера.
    """
    client = ctx
    sid, h = _student(client)
    _trade(sid, "t1", qty="1", entry="200", exit_price="200")
    _forget_uid(sid)

    r = client.get("/api/trades/me?days=90", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["needs_uid"] is True
    assert body["summary"]["total_volume"] == pytest.approx(400.0)


def test_no_trades_no_made_up_summary(ctx):
    """Сделок нет - сводки нет. Ноль оборота придумывать не из чего."""
    client = ctx
    sid, h = _student(client)
    _forget_uid(sid)

    r = client.get("/api/trades/me?days=90", headers=h)
    assert r.json()["summary"] is None


def test_old_trades_fall_outside_the_window(ctx):
    """За срок берётся только то, что в него попало."""
    client = ctx
    sid, h = _student(client)
    _trade(sid, "t1", qty="1", entry="100", exit_price="100", days_ago=200)
    _forget_uid(sid)

    r = client.get("/api/trades/me?days=30", headers=h)
    assert r.json()["summary"] is None
