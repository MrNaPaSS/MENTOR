"""Тесты слоя доступа к данным (in-memory SQLite)."""

from decimal import Decimal

import pytest

from core.db import init_engine, create_all, SessionLocal
from core import repo


@pytest.fixture
def session():
    init_engine("sqlite:///:memory:")
    create_all()
    s = SessionLocal()
    yield s
    s.close()


def test_seed_and_load_settings(session):
    repo.seed_settings(session)
    settings = repo.load_settings(session)
    assert settings.moderate_sl_percent == Decimal("1.5")
    assert settings.turbo_margin_cap == Decimal("150")


def test_update_setting(session):
    repo.seed_settings(session)
    repo.update_setting(session, "turbo_margin_cap", "200")
    assert repo.load_settings(session).turbo_margin_cap == Decimal("200")


def test_student_lifecycle(session):
    st = repo.get_or_create_student(session, tg_id=111, username="alex")
    assert st.id is not None and st.is_approved is False
    # повторный вызов не создаёт дубль
    again = repo.get_or_create_student(session, tg_id=111)
    assert again.id == st.id
    assert repo.get_student_by_username(session, "@alex").id == st.id


def test_audience_filtering(session):
    a = repo.get_or_create_student(session, tg_id=1, username="a")
    b = repo.get_or_create_student(session, tg_id=2, username="b")
    a.is_approved = b.is_approved = True
    a.mode, b.mode = "moderate", "turbo"
    session.commit()
    assert len(repo.audience_students(session, "all")) == 2
    assert len(repo.audience_students(session, "turbo")) == 1


def test_delivery_idempotent(session):
    st = repo.get_or_create_student(session, tg_id=5, username="x")
    st.is_approved = True
    session.commit()
    sig = repo.create_signal(
        session, symbol="XLMUSDT", direction="LONG", leverage=20,
        entry_price=Decimal("0.15"), entry_type="market", margin_type="cross",
        target_audience="all", status="active",
    )
    repo.record_delivery(session, sig.id, st.id, status="failed", error="boom")
    repo.record_delivery(session, sig.id, st.id, status="sent", error=None)
    # та же пара (signal, student) — одна запись, обновлённая
    assert len(sig.deliveries) == 1
    assert sig.deliveries[0].status == "sent"
