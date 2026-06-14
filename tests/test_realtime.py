"""Тесты реалтайм-слоя: ConnectionManager, сборщик цен, WebSocket."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
import asyncio

from backend.ws import ConnectionManager
from backend.price_collector import collect_once, PriceCollector
from backend.security import create_access_token
from core.weex import get_weex_client
from core.db import SessionLocal
from core import repo


class FakeWS:
    def __init__(self, broken=False):
        self.broken = broken
        self.messages = []

    async def send_json(self, message):
        if self.broken:
            raise RuntimeError("closed")
        self.messages.append(message)


# ── ConnectionManager ──

async def test_manager_broadcast_to_all():
    mgr = ConnectionManager()
    a, b = FakeWS(), FakeWS()
    await mgr.connect(a)
    await mgr.connect(b)
    await mgr.broadcast("price_update", {"symbol": "BTCUSDT", "price": "100"})
    assert mgr.count == 2
    assert a.messages[0]["event"] == "price_update"
    assert b.messages[0]["payload"]["symbol"] == "BTCUSDT"


async def test_manager_drops_dead_connections():
    mgr = ConnectionManager()
    ok, dead = FakeWS(), FakeWS(broken=True)
    await mgr.connect(ok)
    await mgr.connect(dead)
    await mgr.broadcast("x", {})
    assert mgr.count == 1  # битое соединение удалено


# ── Сборщик цен ──

@pytest.fixture
def app_with_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/rt.sqlite3")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True), price_interval=3600)
    return app, config


async def test_collect_once_broadcasts_active_symbols(app_with_db):
    app, _ = app_with_db
    with SessionLocal() as s:
        repo.create_signal(
            s, symbol="XLMUSDT", direction="LONG", leverage=20,
            entry_price=Decimal("0.15"), entry_type="market", margin_type="cross",
            target_audience="all", status="active",
        )
    mgr = ConnectionManager()
    ws = FakeWS()
    await mgr.connect(ws)
    weex = get_weex_client(use_mock=True)
    count = await collect_once(weex, mgr)
    assert count == 1
    assert ws.messages[0]["event"] == "price_update"
    assert ws.messages[0]["payload"]["symbol"] == "XLMUSDT"


async def test_collect_once_no_active_signals(app_with_db):
    mgr = ConnectionManager()
    weex = get_weex_client(use_mock=True)
    assert await collect_once(weex, mgr) == 0


async def test_price_collector_lifecycle(app_with_db):
    with SessionLocal() as s:
        repo.create_signal(
            s, symbol="ETHUSDT", direction="LONG", leverage=10,
            entry_price=Decimal("3000"), entry_type="market", margin_type="cross",
            target_audience="all", status="active",
        )
    mgr = ConnectionManager()
    ws = FakeWS()
    await mgr.connect(ws)
    collector = PriceCollector(get_weex_client(use_mock=True), mgr, interval=0.01)
    collector.start()
    collector.start()  # повторный старт безопасен
    await asyncio.sleep(0.05)
    await collector.stop()
    assert any(m["event"] == "price_update" for m in ws.messages)


# ── WebSocket-эндпоинты ──

def test_lifespan_starts_and_stops_collector(app_with_db):
    app, _ = app_with_db
    # Контекстный менеджер TestClient запускает lifespan (старт/стоп сборщика).
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200


def test_ws_prices_sends_hello(app_with_db):
    app, _ = app_with_db
    client = TestClient(app)
    with client.websocket_connect("/ws/prices") as ws:
        msg = ws.receive_json()
    assert msg["event"] == "hello"
    assert "symbols" in msg["payload"]


def test_ws_authed_requires_valid_token(app_with_db):
    app, config = app_with_db
    client = TestClient(app)
    # Валидный токен → hello.
    token = create_access_token("1", "student", config.jwt_secret, 900)
    with client.websocket_connect(f"/ws?token={token}") as ws:
        msg = ws.receive_json()
    assert msg["event"] == "hello"
    assert msg["payload"]["sub"] == "1"


def test_ws_authed_rejects_bad_token(app_with_db):
    app, _ = app_with_db
    client = TestClient(app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws?token=garbage") as ws:
            ws.receive_json()
