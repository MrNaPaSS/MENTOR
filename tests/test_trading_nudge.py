"""Внеочередная проверка сделок ученика.

Терминал видит взятую цель раньше сопровождения и просит проверить сделки
сейчас: иначе стоп в безубыток переезжал через полминуты после цели.
"""

from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import trading_nudge
from backend.deps import get_current_student
from backend.trading.watcher import PositionWatcher
from core.db import Base
from core.models import LiveTrade, Student


def sessions():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def trade(student_id: int, client_id: str, status: str = "open") -> LiveTrade:
    return LiveTrade(
        student_id=student_id,
        client_id=client_id,
        symbol="BTCUSDT",
        side="long",
        entry=100.0,
        initial_stop=99.0,
        current_stop=99.0,
        targets_json="[101]",
        qty=1.0,
        leverage=10,
        status=status,
    )


def watching(factory):
    """Сопровождение, у которого вместо биржи - запись, кого проверили."""
    watcher = PositionWatcher(factory, lambda: None)
    seen: list[tuple[int, list[str]]] = []

    async def handle(_session, student_id, trades):
        seen.append((student_id, sorted(t.client_id for t in trades)))

    watcher._handle_student = handle
    return watcher, seen


def test_only_this_students_live_trades_are_checked():
    factory = sessions()
    session = factory()
    session.add_all([trade(1, "a"), trade(2, "b"), trade(1, "c", status="closed")])
    session.commit()
    watcher, seen = watching(factory)

    assert asyncio.run(watcher.check_student(1)) is True
    # Чужие сделки и закрытые свои не трогаем.
    assert seen == [(1, ["a"])]


def test_repeated_request_within_the_gap_is_skipped():
    """Просят все открытые вкладки ученика - проверка одна на пару секунд."""
    factory = sessions()
    session = factory()
    session.add(trade(1, "a"))
    session.commit()
    watcher, seen = watching(factory)

    async def twice():
        return await watcher.check_student(1), await watcher.check_student(1)

    assert asyncio.run(twice()) == (True, False)
    assert len(seen) == 1


def test_student_without_trades_is_not_checked():
    watcher, seen = watching(sessions())
    assert asyncio.run(watcher.check_student(3)) is False
    assert seen == []


def test_endpoint_asks_the_watcher_about_this_student():
    app = FastAPI()
    app.include_router(trading_nudge.router)
    student = Student(tg_id=1)
    student.id = 7
    app.dependency_overrides[get_current_student] = lambda: student

    class Watcher:
        def __init__(self):
            self.asked: list[int] = []

        async def check_student(self, student_id):
            self.asked.append(student_id)
            return True

    watcher = Watcher()
    app.state.position_watcher = watcher

    with TestClient(app) as client:
        assert client.post("/api/trading/nudge").json() == {"checked": True}
    assert watcher.asked == [7]


def test_endpoint_without_a_watcher_answers_calmly():
    """Ведение выключено - просьба не падает, а говорит, что проверки не было."""
    app = FastAPI()
    app.include_router(trading_nudge.router)
    app.dependency_overrides[get_current_student] = lambda: Student(tg_id=1)

    with TestClient(app) as client:
        assert client.post("/api/trading/nudge").json() == {"checked": False}
