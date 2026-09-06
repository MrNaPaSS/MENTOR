"""Торговые ручки: доступ, хранение ключей и защита от полуоткрытых позиций."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import trading as trading_api
from backend.deps import get_current_student, get_session
from core.db import Base
from core.models import Student


class FakeExchange:
    """Биржа без сети: запоминает, что ей отправили."""

    def __init__(self):
        self.orders: list[dict] = []
        self.pending = []
        self.plans = []
        self.plans_open = []
        self.cancelled = []
        self.algo_cancelled = []
        self.position = None
        self.leverage: tuple | None = None
        self.modified: list[dict] = []

    async def balance(self, margin_coin: str = "USDT"):
        return {"available": "1000"}

    async def symbol_filters(self, symbol: str):
        # Как у BTCUSDT на бирже: шаг лота четыре знака, шаг цены десятая.
        return {"step": 0.0001, "tick": 0.1, "min_qty": 0.0001}

    position: dict | None = None
    pending: list[dict] = []
    plans: list[dict] = []
    plans_open: list[dict] = []
    cancelled: list[str] = []
    algo_cancelled: list[str] = []

    async def positions(self):
        return [self.position] if self.position else []

    async def open_orders(self, symbol):
        return list(self.pending)

    async def cancel_order(self, symbol, order_id):
        self.cancelled.append(order_id)

    async def algo_orders(self, symbol):
        return list(self.plans_open)

    async def cancel_algo_order(self, symbol, order_id):
        self.algo_cancelled.append(order_id)

    async def cancel_all_algo(self, symbol):
        self.algo_cancelled.append(symbol)

    async def set_leverage(self, symbol, leverage, margin_coin="USDT"):
        self.leverage = (symbol, leverage)

    # Биржа может отказать на сокращающих ордерах: пока позиции нет, сокращать
    # нечего. Флаг включает это поведение в тестах.
    reject_reduce_only = False

    async def place_order(self, **kw):
        if self.reject_reduce_only and kw.get("reduce_only"):
            from core.weex.futures import WeexTradeError

            raise WeexTradeError("cannot set reduce only")
        self.orders.append(kw)
        return {"orderId": f"o{len(self.orders)}"}

    async def place_tp_sl(self, **kw):
        if self.reject_reduce_only:
            from core.weex.futures import WeexTradeError

            raise WeexTradeError("cannot set reduce only")
        self.plans.append(kw)
        return [{"success": True, "orderId": f"p{len(self.plans)}"}]

    async def modify_tp_sl(self, **kw):
        self.modified.append(kw)
        return {"ok": True}


@pytest.fixture()
def app_and_exchange(monkeypatch):
    monkeypatch.setenv("WEEX_KEYS_SECRET", "мастер-ключ-для-тестов")

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()

    exchange = FakeExchange()
    monkeypatch.setattr(trading_api, "_require_client", lambda *_: exchange)

    app = FastAPI()
    app.include_router(trading_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student

    with TestClient(app) as client:
        yield client, exchange, session


def test_status_reports_configuration(app_and_exchange):
    client, _, _ = app_and_exchange
    body = client.get("/api/trading/status").json()
    assert body["enabled"] is True
    assert body["connected"] is False


def test_keys_are_stored_encrypted_and_never_returned(app_and_exchange, monkeypatch):
    client, exchange, session = app_and_exchange
    monkeypatch.setattr(trading_api, "WeexFutures", lambda *_a, **_k: exchange)

    body = client.put(
        "/api/trading/keys",
        json={"api_key": "key-1234", "secret_key": "secret-x", "passphrase": "pass"},
    ).json()
    assert body["key_tail"] == "…1234"

    from core.models import WeexCredential

    row = session.query(WeexCredential).one()
    # В базе шифротекст, а не сам ключ.
    assert "key-1234" not in row.api_key_enc
    assert "secret-x" not in row.secret_enc

    # Наружу ключ не отдаётся даже владельцу.
    status = client.get("/api/trading/status").json()
    assert status["connected"] is True
    assert "key-1234" not in str(status)


def test_bad_keys_are_rejected_before_saving(app_and_exchange, monkeypatch):
    client, _, session = app_and_exchange

    class Rejecting:
        async def balance(self, margin_coin="USDT"):
            from core.weex.futures import WeexTradeError

            raise WeexTradeError("подпись не сошлась")

    monkeypatch.setattr(trading_api, "WeexFutures", lambda *_a, **_k: Rejecting())
    res = client.put(
        "/api/trading/keys",
        json={"api_key": "key-1234", "secret_key": "secret-x", "passphrase": "pass"},
    )
    assert res.status_code == 400

    from core.models import WeexCredential

    assert session.query(WeexCredential).count() == 0


def test_open_sends_stop_together_with_entry(app_and_exchange):
    """Стоп уходит тем же ордером: между двумя запросами позиция без защиты."""
    client, exchange, _ = app_and_exchange
    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "btcusdt",
            "side": "long",
            "quantity": 0.5,
            "leverage": 10,
            "stop": 79000,
            "takes": [80000, 80500, 81000],
        },
    )
    assert res.status_code == 200
    entry = exchange.orders[0]
    assert entry["symbol"] == "BTCUSDT"
    assert entry["quantity"] == "0.5"        # уже приведён к шагу лота
    assert entry["side"] == "BUY"
    assert entry["order_type"] == "MARKET"
    assert entry["sl_trigger"] == "79000"
    assert exchange.leverage == ("BTCUSDT", 10)


def test_order_size_is_floored_to_the_lot_step(app_and_exchange):
    """Объём не кратный шагу биржа отклоняет: код -1054."""
    client, exchange, _ = app_and_exchange
    client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "quantity": 0.2506265664,
            "leverage": 400,
            "stop": 79000,
            "takes": [],
        },
    )
    assert exchange.orders[0]["quantity"] == "0.2506"


def test_too_small_order_is_rejected_before_the_exchange(app_and_exchange):
    client, exchange, _ = app_and_exchange
    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "quantity": 0.00001,
            "leverage": 10,
            "stop": 79000,
        },
    )
    assert res.status_code == 422
    assert exchange.orders == []          # на биржу ничего не ушло


def test_limit_entry_does_not_place_takes_yet(app_and_exchange):
    """Пока вход висит лимиткой, позиции нет — сокращать нечего.

    Биржа на такой ордер отвечает «cannot set reduce only». Лестницу выставит
    сопровождение, когда позиция появится.
    """
    client, exchange, session = app_and_exchange
    body = client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "short",
            "quantity": 0.3,
            "leverage": 5,
            "entry": 80000,
            "stop": 80500,
            "takes": [79500, 79000, 78500],
        },
    ).json()

    assert len(exchange.orders) == 1                  # только вход
    assert exchange.orders[0]["order_type"] == "LIMIT"
    assert body["watched"]                            # сделка взята под ведение

    from core.models import LiveTrade

    live = session.query(LiveTrade).one()
    assert live.status == "waiting"
    assert json.loads(live.targets_json) == [79500, 79000, 78500]


def test_market_entry_places_takes_as_conditional_orders(app_and_exchange):
    """Цели ставятся условными заявками, а не сокращающими лимитами.

    На позиции с висящим стопом биржа отвечает «cannot set reduce only»:
    свободного к сокращению объёма у неё нет, он весь зарезервирован защитой.
    """
    client, exchange, _ = app_and_exchange
    client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "short",
            "quantity": 0.3,
            "leverage": 5,
            "stop": 80500,
            "takes": [79500, 79000, 78500],
        },
    )
    assert len(exchange.orders) == 1            # на бирже один обычный ордер — вход
    assert len(exchange.plans) == 3
    for plan in exchange.plans:
        assert plan["plan_type"] == "TAKE_PROFIT"
        assert plan["position_side"] == "SHORT"
        assert plan["quantity"] == "0.1"


def test_failed_takes_do_not_report_a_failed_entry(app_and_exchange):
    """Позиция открыта — значит сделка есть, чем бы ни кончились цели.

    Отдать отказ значит сказать трейдеру, что позиции нет, пока она стоит на
    бирже. Это дороже любой недоставленной цели.
    """
    client, exchange, session = app_and_exchange
    exchange.reject_reduce_only = True

    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "quantity": 0.3,
            "leverage": 5,
            "stop": 79000,
            "takes": [80000, 80500, 81000],
        },
    )
    assert res.status_code == 200
    assert res.json()["warning"]
    assert len(exchange.orders) == 1                  # вход прошёл

    from core.models import LiveTrade

    assert session.query(LiveTrade).one().status == "waiting"


def test_broken_side_is_rejected(app_and_exchange):
    client, _, _ = app_and_exchange
    res = client.post(
        "/api/trading/open",
        json={"symbol": "BTCUSDT", "side": "вверх", "quantity": 1, "leverage": 5, "stop": 1},
    )
    assert res.status_code == 422


def test_breakeven_accounts_for_fees_and_moves_only_forward(app_and_exchange):
    client, exchange, _ = app_and_exchange
    moved = client.post(
        "/api/trading/breakeven",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "entry": 80000,
            "quantity": 0.1,
            "order_id": "sl-1",
            "current_stop": 79000,
            "mark_price": 80500,
        },
    ).json()
    assert moved["moved"] is True
    assert moved["stop"] > 80000                 # выше входа: комиссия обеих ног
    assert exchange.modified[0]["order_id"] == "sl-1"

    # Стоп уже выше безубытка — двигать назад нельзя.
    again = client.post(
        "/api/trading/breakeven",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "entry": 80000,
            "quantity": 0.1,
            "order_id": "sl-1",
            "current_stop": 80500,
            "mark_price": 80600,
        },
    ).json()
    assert again["moved"] is False
    assert len(exchange.modified) == 1


def test_numbers_never_go_to_exchange_in_exponent_form():
    # На PEPE цена уходит в 1e-07, и биржа такой записи не понимает.
    assert trading_api._num(0.0000001) == "0.0000001"
    assert trading_api._num(80000.0) == "80000"


def test_closing_cancels_pending_orders_when_there_is_no_position(app_and_exchange):
    """Снятие расчёта убирает с биржи и лимитку входа, и стоп, и цели.

    Осевшая заявка — это позиция, о которой трейдер не знает: рынок дойдёт до
    её цены и откроет «отменённую» сделку.
    """
    client, exchange, _ = app_and_exchange
    exchange.pending = [{"orderId": "e1"}]
    exchange.plans_open = [{"orderId": "sl1"}, {"orderId": "tp1"}]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    # Обычные и условные снимаются разными ручками: обычная про условные не
    # знает и оставила бы стоп висеть.
    assert exchange.cancelled == ["e1"]
    assert exchange.algo_cancelled == ["sl1", "tp1"]
    assert body["closed"] == 0.0


def test_full_close_removes_the_stop_and_the_takes(app_and_exchange):
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    exchange.pending = [{"orderId": "tp1"}]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    assert body["closed"] == 0.5 and body["remaining"] == 0.0
    close_order = exchange.orders[-1]
    # Без reduce_only: сторону позиции биржа знает из positionSide, а
    # сокращающий ордер на защищённой позиции она отклоняет.
    assert "reduce_only" not in close_order or close_order["reduce_only"] is None
    assert close_order["order_type"] == "MARKET"
    assert close_order["side"] == "SELL"          # лонг закрывается продажей
    assert close_order["position_side"] == "LONG"


def test_partial_close_keeps_the_rest_and_its_orders(app_and_exchange):
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    exchange.pending = [{"orderId": "tp1"}]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 0.5},
    ).json()

    assert body["closed"] == 0.25 and body["remaining"] == 0.25
    # Заявки остатка не трогаем: позиция ещё жива и должна быть под защитой.
    assert exchange.cancelled == [] and exchange.algo_cancelled == []


def test_conditional_take_defaults_to_market_execution():
    """executePrice = 0 значит «после срабатывания — по рынку»."""
    import asyncio

    from core.weex.futures import Credentials, WeexFutures

    sent: dict = {}

    class Recording(WeexFutures):
        async def _request(self, method, path, *, params=None, data=None):
            sent.update(data or {})
            return [{"success": True, "orderId": "p1"}]

    client = Recording(Credentials("k", "s", "p"), lambda: None)  # type: ignore[arg-type]
    asyncio.run(
        client.place_tp_sl(
            symbol="BTCUSDT",
            plan_type="TAKE_PROFIT",
            trigger_price="80000",
            quantity="0.1",
            position_side="LONG",
        )
    )
    assert sent["executePrice"] == "0"
    assert sent["triggerPriceType"] == "MARK_PRICE"
