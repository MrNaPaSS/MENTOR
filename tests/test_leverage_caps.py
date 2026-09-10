"""Предел позиции на плече: запоминаем то, что назвала биржа.

Отказ «position exceed max size X for leverage 'L'» приходил трейдеру после
нажатия, хотя в терминале стоит проверка предельной суммы: справочный предел
биржи верен только для малого плеча, а на ×100 он меньше. Здесь проверяем, что
число из отказа запоминается, что оно правильно переносится на другие плечи и
что заявка сверх свободного места останавливается до биржи.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from backend.trading.refusals import max_size_in
from core.models import LeverageCap, utcnow

REFUSAL = (
    "FAILED_PRECONDITION: If order is filled, may lead to position exceed "
    "max size 337.570 for leverage '100'. you can cancel some order or reduce "
    "leverage and try again"
)


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/caps.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    from backend.trading import leverage_caps

    return db_module, leverage_caps


def test_число_и_плечо_берутся_из_отказа():
    assert max_size_in(REFUSAL) == (337.57, 100)
    assert max_size_in("Insufficient balance") is None
    assert max_size_in("") is None


def test_предел_переносится_на_плечо_выше_но_не_ниже():
    from backend.trading.leverage_caps import cap_at

    caps = {50: 500.0, 100: 337.57}
    # Выше ×100 предел не больше, чем на ×100.
    assert cap_at(caps, 100) == 337.57
    assert cap_at(caps, 125) == 337.57
    # Между ступенями - ближайшая узнанная снизу.
    assert cap_at(caps, 75) == 500.0
    # Ниже всех узнанных - неизвестно: занижать нельзя.
    assert cap_at(caps, 20) is None


def test_запомненный_предел_виден_и_обновляется(db):
    db_module, caps = db
    with db_module.SessionLocal() as session:
        caps.learn(session, "solusdt", 100, 337.57)
        assert caps.caps_for(session, "SOLUSDT") == {100: 337.57}

        # Биржа сменила ступени - верим последнему ответу.
        caps.learn(session, "SOLUSDT", 100, 400.0)
        assert caps.caps_for(session, "SOLUSDT") == {100: 400.0}
        assert session.query(LeverageCap).count() == 1


def test_старый_предел_не_занижает_сумму(db):
    db_module, caps = db
    with db_module.SessionLocal() as session:
        caps.learn(session, "SOLUSDT", 100, 337.57)
        row = session.query(LeverageCap).one()
        row.updated_at = utcnow() - caps.FRESH_FOR - timedelta(days=1)
        session.commit()

        assert caps.caps_for(session, "SOLUSDT") == {}


def test_предел_считается_вместе_с_позицией_и_заявками():
    from backend.trading.leverage_caps import room_note

    # 300 уже стоит, предел 337.57 - ещё 50 не помещается.
    note = room_note(quantity=50, cap=337.57, used=300, leverage=100, coin="SOL", step=0.01)
    assert note is not None
    assert "337.57" in note
    assert "свободно 37.57" in note

    # Ровно в свободное место - проходит, в том числе с округлением шага.
    assert room_note(quantity=37.57, cap=337.57, used=300, leverage=100, coin="SOL", step=0.01) is None
    assert room_note(quantity=37.574, cap=337.57, used=300, leverage=100, coin="SOL", step=0.01) is None
