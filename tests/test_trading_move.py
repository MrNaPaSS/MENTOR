"""Перенос входа, стопа и цели мышью по графику.

Проверяем ровно то различие, ради которого написан модуль: до входа заявка
переставляется целиком, после входа защита двигается на месте. Перепутать эти
два случая - значит либо оставить позицию без стопа, либо завести вторую.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import trading as trading_api
from backend.api import trading_move
from backend.deps import get_current_student, get_session
from core.db import Base
from core.models import LiveTrade, Student

from tests.test_trading_api import FakeExchange


@pytest.fixture()
def moving(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()

    exchange = FakeExchange()
    monkeypatch.setattr(trading_move, "_require_client", lambda *_: exchange)

    live = LiveTrade(
        student_id=student.id,
        client_id="BTCUSDT-1",
        symbol="BTCUSDT",
        side="long",
        entry=80_000.0,
        initial_stop=79_900.0,
        current_stop=79_900.0,
        targets_json=json.dumps([80_400.0]),
        qty=0.01,
        leverage=10,
        status="waiting",
    )
    session.add(live)
    session.commit()

    app = FastAPI()
    app.include_router(trading_move.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student

    with TestClient(app) as client:
        yield client, exchange, session, live


def move(client, **body):
    return client.post(
        "/api/trading/move", json={"symbol": "BTCUSDT", "side": "long", **body}
    )


def test_waiting_order_is_replaced_whole(moving):
    """Стоп ждущей лимитки живёт полем самой заявки - её и переставляем."""
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    body = move(client, stop=79_800.0).json()

    assert body["stop"] == 79_800.0
    assert exchange.cancelled == ["e1"]
    placed = exchange.orders[-1]
    assert placed["order_type"] == "LIMIT"
    assert placed["price"] == "80000"
    assert placed["sl_trigger"] == "79800"
    # Идентификатор для биржи новый, наш собственный прежний: к нему привязаны
    # метки заявок и запись в журнале.
    assert placed["client_order_id"].startswith("BTCUSDT-1")
    assert placed["client_order_id"] != "BTCUSDT-1"

    session.refresh(live)
    assert float(live.current_stop) == 79_800.0
    assert float(live.initial_stop) == 79_800.0


def test_moving_the_limit_carries_stop_and_target(moving):
    """Вход переехал - защита едет с ним: иначе риск станет не тем, что показан."""
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    body = move(client, entry=79_500.0, stop=79_400.0, take=79_900.0).json()

    assert body["entry"] == 79_500.0
    assert body["stop"] == 79_400.0
    assert body["takes"] == [79_900.0]

    placed = exchange.orders[-1]
    assert placed["price"] == "79500"
    assert placed["sl_trigger"] == "79400"

    session.refresh(live)
    assert float(live.entry) == 79_500.0
    assert json.loads(live.targets_json) == [79_900.0]


def test_waiting_target_touches_only_the_plan(moving):
    """Целей ждущей заявки на бирже нет: сокращать нечего, пока вход не исполнен."""
    client, exchange, session, live = moving

    body = move(client, take=80_900.0).json()

    assert body["takes"] == [80_900.0]
    assert body["planned"] is True
    # Ни одного запроса к бирже: ни снятия, ни постановки.
    assert exchange.cancelled == []
    assert exchange.orders == []
    assert exchange.modified == []

    session.refresh(live)
    assert json.loads(live.targets_json) == [80_900.0]


def test_open_position_moves_protection_in_place(moving):
    """У открытой позиции защиту не снимают: двигаем одним запросом."""
    client, exchange, session, live = moving
    live.status = "open"
    live.tp_orders_json = json.dumps([{"price": 80_400.0, "order_id": "p1"}])
    session.commit()

    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}
    exchange.plans_open = [
        {"orderId": "s1", "planType": "STOP_LOSS", "triggerPrice": "79900"},
        {"orderId": "p1", "planType": "TAKE_PROFIT", "triggerPrice": "80400"},
    ]

    move(client, stop=79_950.0)
    move(client, take=80_700.0)

    assert exchange.cancelled == []
    assert exchange.algo_cancelled == []
    assert [(m["order_id"], m["trigger_price"]) for m in exchange.modified] == [
        ("s1", "79950"),
        ("p1", "80700"),
    ]

    session.refresh(live)
    assert float(live.current_stop) == 79_950.0
    assert json.loads(live.targets_json) == [80_700.0]


def test_entry_is_not_moved_under_an_open_position(moving):
    """Вход уже состоялся: перенос его цены ничего не значит и молчать нельзя."""
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()
    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}

    answer = move(client, entry=79_500.0)

    assert answer.status_code == 409
    assert "открыта" in answer.json()["detail"]
    assert exchange.cancelled == []


@pytest.mark.parametrize(
    "field,price,words",
    [
        ("stop", 80_500.0, "ниже входа"),
        ("take", 79_500.0, "выше входа"),
    ],
)
def test_level_on_the_wrong_side_is_refused_by_words(moving, field, price, words):
    """Уровень по ту сторону входа - это другая сделка, а не перенос."""
    client, exchange, _, _ = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    answer = move(client, **{field: price})

    assert answer.status_code == 422
    assert words in answer.json()["detail"]
    # Отказ до биржи: ни снятия, ни постановки.
    assert exchange.cancelled == []
    assert exchange.orders == []


def test_nothing_to_move_is_refused(moving):
    client, _, _, _ = moving
    assert move(client).status_code == 422


def test_two_waiting_limits_do_not_both_open(moving):
    """Две лимитки на покупку: исполнилась одна - открыться должна одна.

    Биржа отдаёт одну сводную позицию на монету и сторону, и по ней заявки
    неразличимы. Отличает их только то, стоит ли ещё сам вход.
    """
    from backend.trading.watcher import decide

    _, _, session, live = moving
    lower = LiveTrade(
        student_id=live.student_id,
        client_id="BTCUSDT-2",
        symbol="BTCUSDT",
        side="long",
        entry=79_000.0,
        initial_stop=78_900.0,
        current_stop=78_900.0,
        targets_json=json.dumps([79_400.0]),
        qty=0.01,
        leverage=10,
        status="waiting",
    )
    session.add(lower)
    session.commit()

    position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}

    # Верхняя исполнилась: её заявки в стакане уже нет.
    assert decide(live, position, set(), None, 0, resting=False).opened is True
    # Нижняя всё ещё стоит - к этой позиции она отношения не имеет.
    assert decide(lower, position, set(), None, 0, resting=True).opened is False
