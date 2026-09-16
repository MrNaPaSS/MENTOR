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

    # Цену биржа отдаёт отдельной ручкой: в ответе по позиции её нет. В тестах
    # она постоянна - проверяем разбор заявок, а не сеть.
    async def price(_session, _symbol):
        return 80_050.0

    monkeypatch.setattr(trading_move, "public_price", price)
    monkeypatch.setattr(trading_move, "_get_session", lambda: _nothing())

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


async def _nothing():
    """Сеанс сети в тестах не нужен: цену подменяем целиком."""
    return None


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


def opened(session, live, exchange):
    """Позиция набрана, на бирже стоят стоп и цель."""
    live.status = "open"
    live.tp_orders_json = json.dumps([{"price": 80_400.0, "order_id": "p1"}])
    session.commit()
    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}
    exchange.plans_open = [
        {"orderId": "s1", "planType": "STOP_LOSS", "triggerPrice": "79900", "quantity": "0.01"},
        {"orderId": "p1", "planType": "TAKE_PROFIT", "triggerPrice": "80400", "quantity": "0.01"},
    ]


def test_moved_stop_replaces_the_old_one(moving):
    """Стоп ставится новый, прежний снимается - вторым он висеть не должен.

    Ручка биржи для переноса условной заявки не двигает её, а заводит вторую:
    на позиции оказывались два стопа в паре долларов друг от друга.
    """
    client, exchange, session, live = moving
    opened(session, live, exchange)

    move(client, stop=79_950.0)

    # Никаких «передвинуть»: только новая заявка и снятие прежней.
    assert exchange.modified == []
    assert [p["plan_type"] for p in exchange.plans] == ["STOP_LOSS"]
    assert exchange.plans[-1]["trigger_price"] == "79950"
    assert "s1" in exchange.algo_cancelled

    session.refresh(live)
    assert float(live.current_stop) == 79_950.0
    # Отметка «поставлен руками»: сопровождение не вернёт его расчётом.
    assert live.hand_stop == live.takes_hit


def test_moved_target_replaces_the_old_one(moving):
    """Цель тоже переставляется заявкой, а не переносом."""
    client, exchange, session, live = moving
    opened(session, live, exchange)

    move(client, take=80_700.0)

    assert exchange.modified == []
    assert "p1" in exchange.algo_cancelled
    placed = exchange.plans[-1]
    assert placed["plan_type"] == "TAKE_PROFIT"
    assert placed["trigger_price"] == "80700"
    # Объём берём у снятой заявки: цель закрывает свою долю позиции, а не всю.
    assert placed["quantity"] == "0.01"

    session.refresh(live)
    assert json.loads(live.targets_json) == [80_700.0]
    # Идентификатор записан тот, что вернула биржа на новую заявку: по старому
    # сопровождение ждало бы исполнения снятой и цель считалась бы невзятой.
    assert json.loads(live.tp_orders_json)[0]["order_id"] == f"p{len(exchange.plans)}"


def test_hand_set_stop_survives_the_breakeven_rule(moving):
    """Стоп, поставленный руками, расчёт безубытка не возвращает."""
    from backend.trading.watcher import decide

    _, _, session, live = moving
    live.status = "open"
    live.takes_hit = 1
    live.qty = 0.01
    live.entry = 80_000.0
    live.current_stop = 79_800.0
    live.tp_orders_json = json.dumps([{"price": 80_400.0, "order_id": "p1", "filled": True}])
    session.commit()

    position = {
        "symbol": "BTCUSDT",
        "positionSide": "LONG",
        "size": "0.01",
        "cumOpenValue": "800",
        "cumOpenSize": "0.01",
        "cumOpenFee": "0.6",
        "cumCloseValue": "0",
        "cumCloseSize": "0",
        "cumCloseFee": "0",
    }

    live.hand_stop = -1
    session.commit()
    free = decide(live, position, {"p1"}, 80_100.0, 0)

    live.hand_stop = 1
    session.commit()
    held = decide(live, position, {"p1"}, 80_100.0, 0)

    # Без отметки расчёт вправе двигать стоп, с отметкой - нет.
    assert held.move_stop_to is None
    assert free.move_stop_to is None or held.move_stop_to != free.move_stop_to


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


def test_exchange_made_stop_is_removed_by_side(moving):
    """Стоп, заведённый биржей вместе со входом, снимается по стороне.

    Название вида у него своё, и разбор по имени его не узнавал: заявка
    оставалась висеть, и после переноса на позиции оказывались два стопа -
    новый и прежний. Живой стоп лонга всегда ниже рынка, живая цель выше: это
    факт о заявке, а не догадка о её имени.
    """
    client, exchange, session, live = moving
    live.status = "open"
    live.tp_orders_json = json.dumps([{"price": 80_400.0, "order_id": "p1"}])
    session.commit()

    exchange.position = {
        "symbol": "BTCUSDT",
        "positionSide": "LONG",
        "size": "0.01",
        "markPrice": "80050",
    }
    exchange.plans_open = [
        # Ни «stop», ни «loss», ни «sl» в названии - ровно то, что приезжает
        # вместе с лимиткой.
        {"orderId": "s1", "planType": "POSITION_TPSL", "triggerPrice": "79900", "quantity": "0.01"},
        {"orderId": "p1", "planType": "TAKE_PROFIT", "triggerPrice": "80400", "quantity": "0.01"},
    ]

    move(client, stop=79_950.0)

    # Прежний стоп снят, цель не тронута.
    assert "s1" in exchange.algo_cancelled
    assert "p1" not in exchange.algo_cancelled
    assert [p["plan_type"] for p in exchange.plans] == ["STOP_LOSS"]

    session.refresh(live)
    assert float(live.current_stop) == 79_950.0


def test_a_stop_without_a_number_is_still_cancelled(moving):
    """Прежний стоп снимается и тогда, когда номера у него нет - только метка.

    Часть условных заявок биржа отдаёт без собственного номера: есть лишь
    метка, которую мы сами задали при постановке. Такие пропускались молча, на
    позиции оставалось два стопа, и терминал отвечал отказом со словами
    «снимите лишний в приложении биржи» - то есть просил трейдера сделать
    нашу работу в чужом приложении.
    """
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()

    exchange.position = {
        "symbol": "BTCUSDT",
        "positionSide": "LONG",
        "size": "0.01",
        "markPrice": "80050",
    }
    exchange.plans_open = [
        {
            "clientAlgoId": "sl0_BTCUSDT-1",
            "planType": "STOP_LOSS",
            "triggerPrice": "79900",
            "quantity": "0.01",
        },
    ]

    answer = move(client, stop=79_950.0)

    assert answer.status_code == 200
    assert "sl0_BTCUSDT-1" in exchange.algo_cancelled
    session.refresh(live)
    assert float(live.current_stop) == 79_950.0


def test_target_above_market_is_never_taken_for_a_stop(moving):
    """Чужая цель выше рынка стопом не считается и под нож не идёт."""
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()

    exchange.position = {
        "symbol": "BTCUSDT",
        "positionSide": "LONG",
        "size": "0.01",
        "markPrice": "80050",
    }
    exchange.plans_open = [
        {"orderId": "s1", "planType": "POSITION_TPSL", "triggerPrice": "79900", "quantity": "0.01"},
        # Название незнакомое и заявка не наша - но она выше рынка, значит цель.
        {"orderId": "x9", "planType": "SOMETHING", "triggerPrice": "80600", "quantity": "0.01"},
    ]

    move(client, stop=79_950.0)

    assert "s1" in exchange.algo_cancelled
    assert "x9" not in exchange.algo_cancelled


def test_stop_is_recognised_without_a_price_in_the_position(moving):
    """Цены в ответе по позиции нет - её спрашивают отдельно.

    Без цены правило «стоп ниже рынка» не работает вовсе, и прежний стоп
    оставался висеть рядом с новым. Именно это и происходило на счёте.
    """
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()

    # Ровно как отвечает биржа: объёмы и стоимости, ни одной цены.
    exchange.position = {
        "symbol": "BTCUSDT",
        "positionSide": "LONG",
        "size": "0.01",
        "cumOpenValue": "800",
        "cumOpenSize": "0.01",
    }
    exchange.plans_open = [
        {"orderId": "s1", "planType": "POSITION_TPSL", "triggerPrice": "79900", "quantity": "0.01"},
    ]

    move(client, stop=79_950.0)

    assert "s1" in exchange.algo_cancelled


def test_open_position_may_put_the_stop_beyond_the_entry(moving):
    """Безубыток стоит за ценой входа - и туда стоп переносить можно.

    Запрет «стоп по ту сторону входа» верен для ждущей заявки, но у открытой
    позиции он не давал перенести стоп в безубыток вовсе.
    """
    client, exchange, session, live = moving
    opened(session, live, exchange)

    # Лонг со входом 80 000 при рынке 80 050: стоп поднимаем выше входа, в
    # безубыток, но ниже рынка - иначе он сработал бы в тот же миг.
    answer = move(client, stop=80_020.0)

    assert answer.status_code == 200
    assert exchange.plans[-1]["trigger_price"] == "80020"
    session.refresh(live)
    assert float(live.current_stop) == 80_020.0


def test_stop_on_the_wrong_side_of_the_market_is_pulled_to_it(moving):
    """Стоп выше рынка биржа не примет - постановка подводит его к цене."""
    client, exchange, session, live = moving
    opened(session, live, exchange)

    move(client, stop=80_500.0)   # рынок 80 050

    # Ровно на шаг ниже рынка: в саму цену биржа тоже не пускает.
    assert exchange.plans[-1]["trigger_price"] == "80049.9"


def test_a_target_can_be_moved_again_and_again(moving):
    """Цель переносится сколько угодно раз, а не до первого раза.

    Раньше цель искалась по месту в списке, отсортированном по цене. Перенос
    менял цену - менялся и порядок, «третьей» становилась другая заявка, а
    после нескольких переносов нужная не находилась вовсе.
    """
    client, exchange, session, live = moving
    live.status = "open"
    live.tp_orders_json = json.dumps(
        [
            {"price": 80_200.0, "order_id": "t1", "filled": False},
            {"price": 80_400.0, "order_id": "t2", "filled": False},
            {"price": 80_600.0, "order_id": "t3", "filled": False},
        ]
    )
    session.commit()

    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.03"}
    exchange.plans_open = [
        {"orderId": "t1", "planType": "TAKE_PROFIT", "triggerPrice": "80200", "quantity": "0.01"},
        {"orderId": "t2", "planType": "TAKE_PROFIT", "triggerPrice": "80400", "quantity": "0.01"},
        {"orderId": "t3", "planType": "TAKE_PROFIT", "triggerPrice": "80600", "quantity": "0.01"},
    ]

    # Третью цель тянем четыре раза подряд, в том числе ниже второй - туда, где
    # порядок по цене перестаёт совпадать с порядком целей.
    for price in (80_900.0, 80_300.0, 81_200.0, 80_250.0):
        answer = move(client, take=price, take_index=2)
        assert answer.status_code == 200, answer.json()

        placed = exchange.plans[-1]
        assert placed["plan_type"] == "TAKE_PROFIT"
        assert float(placed["trigger_price"]) == price

        # Новая заявка встала на место прежней третьей, а не завела четвёртую.
        session.refresh(live)
        recorded = json.loads(live.tp_orders_json)
        assert len(recorded) == 3
        assert recorded[2]["price"] == price
        assert len([o for o in exchange.plans_open if "PROFIT" in o["planType"]]) == 3

    # Первые две цели никто не трогал.
    assert "t1" not in exchange.algo_cancelled
    assert "t2" not in exchange.algo_cancelled


def test_target_recorded_on_a_neighbour_record_is_still_moved(moving):
    """Цель записана за соседней записью той же позиции - и всё равно переносится.

    Позиция на бирже одна на монету и сторону, а записей о ней бывает две.
    График узнаёт цели по меткам всех записей и рисует их, а перенос искал
    только среди меток своей - и отвечал «такой цели на бирже нет», хотя цель
    стояла на бирже и была видна на графике.
    """
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()
    neighbour = LiveTrade(
        student_id=live.student_id,
        client_id="BTCUSDT-0",
        symbol="BTCUSDT",
        side="long",
        entry=80_000.0,
        initial_stop=79_900.0,
        current_stop=79_900.0,
        targets_json=json.dumps([80_400.0]),
        tp_orders_json=json.dumps([{"price": 80_400.0, "order_id": "n1", "filled": False}]),
        qty=0.01,
        leverage=10,
        status="open",
    )
    session.add(neighbour)
    session.commit()

    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}
    exchange.plans_open = [
        # Вид незнакомый: узнать заявку можно только по номеру у соседней записи.
        {"orderId": "n1", "planType": "CONDITIONAL", "triggerPrice": "80400", "quantity": "0.01"},
    ]

    answer = move(client, take=80_700.0, trade_id="BTCUSDT-1")

    assert answer.status_code == 200, answer.json()
    assert "n1" in exchange.algo_cancelled
    assert exchange.plans[-1]["trigger_price"] == "80700"
    # Новая заявка записана за той записью, чья была прежняя.
    session.refresh(neighbour)
    session.refresh(live)
    assert json.loads(neighbour.tp_orders_json)[0]["order_id"] == f"p{len(exchange.plans)}"
    assert json.loads(neighbour.targets_json) == [80_700.0]
    assert json.loads(live.tp_orders_json or "[]") == []


def test_other_side_target_is_never_moved(moving):
    """В хедже по монете две позиции - цель шорта перенос лонга не трогает."""
    client, exchange, session, live = moving
    live.status = "open"
    session.commit()

    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}
    exchange.plans_open = [
        # Ниже по цене - и без фильтра по стороне встала бы первой в лестнице лонга.
        {
            "orderId": "x1",
            "planType": "TAKE_PROFIT",
            "positionSide": "SHORT",
            "triggerPrice": "79000",
            "quantity": "0.02",
        },
        {
            "orderId": "p1",
            "planType": "TAKE_PROFIT",
            "positionSide": "LONG",
            "triggerPrice": "80400",
            "quantity": "0.01",
        },
    ]

    answer = move(client, take=80_700.0)

    assert answer.status_code == 200, answer.json()
    assert "x1" not in exchange.algo_cancelled
    assert "p1" in exchange.algo_cancelled
    assert exchange.plans[-1]["quantity"] == "0.01"


def test_a_neighbour_keeps_its_stop_when_we_move_ours(moving):
    """Соседняя запись на ту же позицию остаётся со своим стопом.

    По одной монете и стороне сделок бывает несколько, а позиция на бирже
    одна. Снятие прежних стопов шло по стороне и цене - и стоп соседней сделки
    попадал под него: трейдер двигал свой уровень, а без защиты оставалась
    соседняя сделка.
    """
    client, exchange, session, live = moving
    opened(session, live, exchange)

    neighbour = LiveTrade(
        student_id=live.student_id,
        client_id="BTCUSDT-2",
        symbol="BTCUSDT",
        side="long",
        entry=80_000.0,
        initial_stop=79_800.0,
        current_stop=79_800.0,
        targets_json=json.dumps([80_500.0]),
        qty=0.01,
        leverage=10,
        status="open",
        sl_order_id="s2",
    )
    session.add(neighbour)
    session.commit()

    exchange.plans_open = exchange.plans_open + [
        {"orderId": "s2", "planType": "STOP_LOSS", "triggerPrice": "79800", "quantity": "0.01"},
    ]

    move(client, stop=79_950.0, trade_id="BTCUSDT-1")

    assert "s1" in exchange.algo_cancelled
    assert "s2" not in exchange.algo_cancelled
    assert any(o.get("orderId") == "s2" for o in exchange.plans_open)


def test_the_move_goes_under_the_same_lock_as_the_watcher(moving):
    """Ручной перенос берёт замок счёта сопровождения, а не идёт мимо него.

    Сопровождение переставляет стоп в безубыток само. Два переноса, начатых в
    одни и те же секунды, снимают заявки друг друга: на позиции остаётся то
    два стопа, то ни одного, а в сделке записана цена, которой на бирже нет.
    """
    client, exchange, session, live = moving
    opened(session, live, exchange)

    asked: list[tuple] = []
    events: list[str] = []

    class Lock:
        async def __aenter__(self):
            events.append("взят")
            return self

        async def __aexit__(self, *exc):
            events.append("отпущен")
            return False

    class Watcher:
        def account_lock(self, student_id, exchange_name):
            asked.append((student_id, exchange_name))
            return Lock()

    client.app.state.position_watcher = Watcher()

    assert move(client, stop=79_950.0).status_code == 200

    assert asked == [(live.student_id, "weex")]
    assert events == ["взят", "отпущен"]
    # И вся работа с биржей - внутри замка, а не после него.
    assert "s1" in exchange.algo_cancelled


def test_a_limit_without_our_mark_is_still_cancelled(moving):
    """Биржа не вернула метку - заявку снимаем по ней самой.

    На MEXC список заявок приходил без нашего имени: опознать прежнюю лимитку
    в нём было нечем, и она оставалась висеть, а рядом вставала новая - тот же
    вход стоял на бирже двойным объёмом.
    """
    client, exchange, session, live = moving
    # Заявка есть, но без clientOrderId: по списку её нашей не признать.
    exchange.pending = [{"orderId": "e1"}]

    assert move(client, entry=80_000.0).status_code == 200

    # Снята по метке, а не по номеру: номера у нас не было.
    assert exchange.cancelled == ["BTCUSDT-1"]
    assert exchange.orders[-1]["order_type"] == "LIMIT"
    assert exchange.orders[-1]["price"] == "80000"


def test_the_move_goes_on_when_there_is_nothing_to_cancel(moving):
    """Заявки на бирже уже нет - перенос идёт дальше, а не падает отказом."""
    client, exchange, session, live = moving
    exchange.pending = []

    async def refuse(symbol, order_id):
        from core.weex.futures import WeexTradeError

        raise WeexTradeError("order not exist")

    exchange.cancel_order = refuse  # type: ignore[assignment]

    assert move(client, entry=80_000.0).status_code == 200
    assert exchange.orders[-1]["price"] == "80000"


def test_a_refusal_that_means_there_is_nothing_to_cancel_does_not_stop_the_move(moving):
    """«Заявки нет» - это не отказ переноса.

    MEXC отвечает так и на заявку, которая ещё висит в её же списке: снятие
    прошло раньше, а список отстал. Перенос при этом падал отказом, и трейдер
    не мог двигать вход вовсе.
    """
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    async def gone(symbol, order_id):
        from core.weex.futures import WeexTradeError

        exchange.cancelled.append(order_id)
        raise WeexTradeError("Заявка e1 на MEXC не снята: order not exist", code="2040")

    exchange.cancel_order = gone  # type: ignore[assignment]

    res = move(client, entry=80_000.0)
    assert res.status_code == 200
    assert exchange.orders[-1]["price"] == "80000"


def test_the_old_limit_is_swept_after_the_move(moving):
    """Прежняя лимитка, пережившая снятие, убирается после постановки новой.

    Иначе на бирже остаются две заявки на один вход - двойной объём, если
    исполнятся обе.
    """
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]
    refused: list[str] = []

    async def stubborn(symbol, order_id):
        from core.weex.futures import WeexTradeError

        # Первое снятие «не находит» заявку, второе - снимает.
        if not refused:
            refused.append(str(order_id))
            raise WeexTradeError("order not exist", code="2040")
        exchange.cancelled.append(str(order_id))
        exchange.pending = []

    exchange.cancel_order = stubborn  # type: ignore[assignment]

    assert move(client, entry=80_000.0).status_code == 200
    # Новая заявка встала, прежняя всё-таки снята - вторым заходом.
    assert exchange.orders[-1]["price"] == "80000"
    assert exchange.cancelled == ["e1"]
    assert exchange.pending == []


def test_moving_a_limit_does_not_cancel_the_new_one_on_okx(moving):
    """OKX убирает из метки дефисы - новую лимитку это не должно снимать.

    Уборка после переноса узнавала новую заявку точным сравнением метки.
    OKX возвращает `BTCUSDT-1-1` как `BTCUSDT11`: сравнение не сходилось, и
    новая лимитка снималась как прежняя. Сделка пропадала, а новой заявки на
    бирже не было.
    """
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT1"}]

    async def okx_place(**kw):
        exchange.orders.append(kw)
        mark = "".join(ch for ch in kw["client_order_id"] if ch.isalnum())
        exchange.pending = exchange.pending + [{"orderId": "new", "clientOrderId": mark}]
        return {"orderId": "new", "clientOrderId": mark}

    exchange.place_order = okx_place  # type: ignore[assignment]

    assert move(client, entry=80_000.0).status_code == 200

    assert "new" not in exchange.cancelled
    assert any(o.get("orderId") == "new" for o in exchange.pending)
    assert "e1" in exchange.cancelled


def test_the_new_limit_is_spared_by_its_number_too(moving):
    """Биржа вернула метку совсем другой - новую узнаём по номеру заявки."""
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    async def place(**kw):
        exchange.orders.append(kw)
        exchange.pending = exchange.pending + [
            {"orderId": "new", "clientOrderId": "BTCUSDT-1-zz"}
        ]
        return {"orderId": "new"}

    exchange.place_order = place  # type: ignore[assignment]

    assert move(client, entry=80_000.0).status_code == 200
    assert "new" not in exchange.cancelled


def test_same_mark_reads_marks_the_way_exchanges_return_them():
    from backend.trading.watcher import same_mark

    assert same_mark("BTCUSDT17895000000001", "BTCUSDT-1789500000000-1")  # OKX
    assert same_mark("btcusdt-1789500000000-1", "BTCUSDT-1789500000000-1")  # BingX
    assert same_mark("BTCUSDT-1789500000000-1", "BTCUSDT-1789500000000-1")
    # Прежняя метка той же сделки - не новая.
    assert not same_mark("BTCUSDT1789500000000", "BTCUSDT-1789500000000-1")
    assert not same_mark("", "BTCUSDT-1")


# ── Binance: стоп ждущей лимитки - отдельная условная заявка ────────────────


def _separate_stop_exchange(exchange):
    """Биржа, где стоп не прикладывается к заявке, а ставится рядом (Binance)."""
    plain = exchange.place_order

    async def place_order(**kw):
        placed = await plain(**kw)
        if kw.get("sl_trigger"):
            stop_id = f"sl{len(exchange.orders)}"
            exchange.plans_open.append(
                {"algoId": stop_id, "orderId": stop_id, "planType": "STOP_LOSS",
                 "positionSide": "LONG", "triggerPrice": kw["sl_trigger"]}
            )
            placed = {**placed, "slOrderId": stop_id}
        return placed

    exchange.place_order = place_order


def test_the_old_separate_stop_of_a_waiting_limit_is_removed(moving):
    """Перенос стопа ждущей лимитки на Binance не оставляет прежний стоп.

    Стоп там стоит отдельной заявкой без нашей метки. Лимитка переставлялась
    целиком, а прежний стоп никто не снимал - на бирже их оказывалось два.
    """
    client, exchange, session, live = moving
    _separate_stop_exchange(exchange)
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]
    exchange.plans_open = [
        {"algoId": "old", "orderId": "old", "planType": "STOP_LOSS",
         "positionSide": "LONG", "triggerPrice": "79900"}
    ]

    assert move(client, stop=79_800.0).status_code == 200

    left = [order["algoId"] for order in exchange.plans_open]
    assert "old" not in left
    assert len(left) == 1 and left[0].startswith("sl")
    # Номер нового стопа записан: по нему сделку снимут вместе с защитой.
    session.refresh(live)
    assert live.sl_order_id == left[0]


def test_a_neighbours_stop_at_the_same_price_stays(moving):
    """Стоп соседней сделки по той же цене - чужая защита, её не трогаем."""
    client, exchange, session, live = moving
    _separate_stop_exchange(exchange)
    neighbour = LiveTrade(
        student_id=live.student_id, client_id="BTCUSDT-2", symbol="BTCUSDT", side="long",
        entry=80_100.0, initial_stop=79_900.0, current_stop=79_900.0,
        targets_json="[]", qty=0.01, leverage=10, status="open", sl_order_id="theirs",
    )
    session.add(neighbour)
    session.commit()
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]
    exchange.plans_open = [
        {"algoId": "theirs", "orderId": "theirs", "planType": "STOP_LOSS",
         "positionSide": "LONG", "triggerPrice": "79900"}
    ]

    # Сделок на монете две - какую двигаем, называем, как это делает терминал.
    assert move(client, stop=79_800.0, trade_id="BTCUSDT-1").status_code == 200
    assert "theirs" in [order["algoId"] for order in exchange.plans_open]


def test_attached_stop_exchanges_do_not_touch_conditional_orders(moving):
    """WEEX и OKX прикладывают стоп к заявке - снимать отдельно там нечего."""
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]
    exchange.plans_open = [
        {"algoId": "x", "orderId": "x", "planType": "STOP_LOSS",
         "positionSide": "LONG", "triggerPrice": "79900"}
    ]

    assert move(client, stop=79_800.0).status_code == 200
    assert exchange.algo_cancelled == []


def test_moving_the_entry_carries_the_whole_ladder(moving):
    """Вход переехал - переехали все цели, а не первая.

    На графике вход тянет за собой всю лестницу, а на сервер уезжала одна
    цель: остальные оставались на прежних ценах и вставали на бирже вразнобой,
    когда лимитка исполнялась. Трейдер видел на экране один замысел, а на счёте
    получал другой.
    """
    client, exchange, session, live = moving
    live.targets_json = json.dumps([80_400.0, 80_800.0, 81_200.0])
    session.commit()
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    body = move(
        client,
        entry=79_500.0,
        stop=79_400.0,
        take=79_900.0,
        takes=[79_900.0, 80_300.0, 80_700.0],
    ).json()

    assert body["takes"] == [79_900.0, 80_300.0, 80_700.0]
    session.refresh(live)
    assert json.loads(live.targets_json) == [79_900.0, 80_300.0, 80_700.0]


def test_a_target_on_the_wrong_side_is_refused(moving):
    """Цель ниже входа у лонга биржа примет через час и оставит сделку без неё."""
    client, exchange, session, live = moving
    exchange.pending = [{"orderId": "e1", "clientOrderId": "BTCUSDT-1"}]

    answer = move(
        client, entry=79_500.0, stop=79_400.0, takes=[79_900.0, 79_100.0]
    )

    assert answer.status_code >= 400
    session.refresh(live)
    # Замысел остался прежним: половину лестницы записывать нельзя.
    assert json.loads(live.targets_json) == [80_400.0]
