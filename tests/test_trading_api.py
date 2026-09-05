"""Торговые ручки: доступ, хранение ключей и защита от полуоткрытых позиций."""

from __future__ import annotations

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
        self.leverage: tuple | None = None
        self.modified: list[dict] = []

    async def balance(self, margin_coin: str = "USDT"):
        return {"available": "1000"}

    async def symbol_filters(self, symbol: str):
        # Как у BTCUSDT на бирже: шаг лота четыре знака, шаг цены десятая.
        return {"step": 0.0001, "tick": 0.1, "min_qty": 0.0001}

    async def positions(self):
        return []

    async def set_leverage(self, symbol, leverage, margin_coin="USDT"):
        self.leverage = (symbol, leverage)

    async def place_order(self, **kw):
        self.orders.append(kw)
        return {"orderId": f"o{len(self.orders)}"}

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


def test_takes_are_reduce_only_and_split_the_volume(app_and_exchange):
    client, exchange, _ = app_and_exchange
    client.post(
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
    )
    takes = exchange.orders[1:]
    assert len(takes) == 3
    for order in takes:
        assert order["reduce_only"] is True
        assert order["side"] == "BUY"           # шорт закрывается покупкой
        assert order["quantity"] == "0.1"
    assert exchange.orders[0]["order_type"] == "LIMIT"


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
