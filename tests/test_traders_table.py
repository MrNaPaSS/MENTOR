"""Таблица трейдеров: объём и результат по тем, кто торгует по своим ключам.

За места в ней однажды будут давать награды, поэтому проверяется не только
арифметика, но и границы: кто в таблицу попадает, а кто нет, и что считается
за окно, а что осталось за его краем.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.db import Base
from core.models import BalanceSnapshot, ScalpTrade, Student, WeexCredential, utcnow


@pytest.fixture()
def client():
    # StaticPool обязателен: без него каждое соединение к ":memory:" получает
    # собственную пустую базу, и таблицы, созданные здесь, сессия не увидит.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    from backend.api import stats as stats_api
    from backend.deps import get_session

    app = FastAPI()
    app.include_router(stats_api.router)

    def session_for_request():
        session = Session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = session_for_request
    with TestClient(app) as http:
        yield http, Session


def student(session, name: str, *, keys: bool = True, approved: bool = True) -> Student:
    row = Student(
        username=name,
        tg_id=None,
        is_approved=approved,
        is_active=True,
        mode="moderate",
    )
    session.add(row)
    session.flush()
    if keys:
        session.add(
            WeexCredential(
                student_id=row.id,
                api_key_enc="x",
                secret_enc="x",
                passphrase_enc="x",
                key_tail="1234",
                is_active=True,
            )
        )
    return row


def traded(session, who: Student, *, pnl: float, days_ago: int = 1) -> None:
    session.add(
        ScalpTrade(
            student_id=who.id,
            client_id=f"{who.id}-{pnl}-{days_ago}",
            symbol="BTCUSDT",
            side="long",
            entry=100,
            stop=99,
            qty=1,
            margin=10,
            leverage=10,
            outcome="take" if pnl > 0 else "stop",
            pnl=pnl,
            closed_at=utcnow() - timedelta(days=days_ago),
        )
    )


def turnover(session, who: Student, *, futures: float, days_ago: int = 1) -> None:
    day = (utcnow() - timedelta(days=days_ago)).date().isoformat()
    session.add(
        BalanceSnapshot(
            student_id=who.id,
            date=day,
            balance_usdt=1000,
            futures_volume=futures,
            spot_volume=0,
        )
    )


def test_only_those_who_trade_by_keys_get_in(client):
    """Без ключей в таблицу не попадают.

    Их объём известен только со стороны и с задержкой: ставить их в один ряд с
    теми, чьи числа взяты у самой биржи, значит сравнивать несравнимое.
    """
    http, Session = client
    with Session() as session:
        keyed = student(session, "с ключами")
        bare = student(session, "без ключей", keys=False)
        turnover(session, keyed, futures=5000)
        turnover(session, bare, futures=999999)
        session.commit()

    rows = http.get("/api/stats/traders").json()

    assert [r["username"] for r in rows] == ["с ключами"]


def test_sorted_by_volume_by_default(client):
    http, Session = client
    with Session() as session:
        small = student(session, "малый")
        big = student(session, "крупный")
        turnover(session, small, futures=1000)
        turnover(session, big, futures=9000)
        session.commit()

    rows = http.get("/api/stats/traders").json()

    assert [r["username"] for r in rows] == ["крупный", "малый"]
    assert [r["rank"] for r in rows] == [1, 2]
    assert rows[0]["volume"] == pytest.approx(9000)


def test_sorted_by_result_when_asked(client):
    """По результату порядок свой: наторговать много и потерять - не заслуга."""
    http, Session = client
    with Session() as session:
        loud = student(session, "оборотистый")
        quiet = student(session, "точный")
        turnover(session, loud, futures=90000)
        turnover(session, quiet, futures=1000)
        traded(session, loud, pnl=-500)
        traded(session, quiet, pnl=120)
        session.commit()

    rows = http.get("/api/stats/traders?sort=pnl").json()

    assert [r["username"] for r in rows] == ["точный", "оборотистый"]
    assert rows[0]["pnl"] == pytest.approx(120)
    assert rows[1]["pnl"] == pytest.approx(-500)


def test_window_cuts_off_the_old(client):
    """За краем окна ничего не считается - ни объём, ни сделки."""
    http, Session = client
    with Session() as session:
        one = student(session, "давний")
        turnover(session, one, futures=5000, days_ago=100)
        traded(session, one, pnl=300, days_ago=100)
        session.commit()

    rows = http.get("/api/stats/traders?days=30").json()

    assert rows[0]["volume"] == 0
    assert rows[0]["pnl"] == 0
    assert rows[0]["trades"] == 0


def test_wins_counted_apart_from_trades(client):
    """Сделок и прибыльных - разные числа: по ним считают точность."""
    http, Session = client
    with Session() as session:
        one = student(session, "трейдер")
        traded(session, one, pnl=10, days_ago=1)
        traded(session, one, pnl=-4, days_ago=2)
        traded(session, one, pnl=7, days_ago=3)
        session.commit()

    row = http.get("/api/stats/traders?sort=pnl").json()[0]

    assert row["trades"] == 3
    assert row["wins"] == 2
    assert row["pnl"] == pytest.approx(13)


def test_unknown_sort_falls_back_instead_of_failing(client):
    """Ключ приходит с экрана: чужой не должен ронять таблицу."""
    http, Session = client
    with Session() as session:
        one = student(session, "трейдер")
        turnover(session, one, futures=1000)
        session.commit()

    assert http.get("/api/stats/traders?sort=drop%20table").status_code == 200
