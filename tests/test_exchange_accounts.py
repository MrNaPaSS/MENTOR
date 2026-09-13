"""Мультибиржа: счета по биржам, выбор активного и биржа сделки.

Два правила, на которых держатся деньги ученика:

* новая сделка уходит на активную биржу;
* идущая сделка ведётся ключом той биржи, где открыта, что бы ни было выбрано.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import trading as trading_api
from backend.deps import get_current_student, get_session, get_weex
from backend.trading import accounts
from backend.trading.accounts import active_account, client_for, trade_exchange
from backend.trading.watcher import client_matches
from core.db import Base
from core.models import AcademyUid, ExchangeAccount, LiveTrade, Student, WeexCredential
from core.okx.futures import OkxFutures
from core.weex.futures import WeexFutures
from backend.trading import connect as connect_mod


def _session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)()


def _account(student_id: int, exchange: str, active: bool = True) -> ExchangeAccount:
    return ExchangeAccount(
        student_id=student_id, exchange=exchange, api_key_enc="k", secret_enc="s",
        passphrase_enc="p", key_tail="1234", is_active=active,
    )


# ── счета ────────────────────────────────────────────────────────────────────


def test_weex_keys_move_to_accounts_once():
    from core.db import _move_weex_keys

    engine, session = _session()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()
    session.add(WeexCredential(student_id=student.id, api_key_enc="enc-k", secret_enc="enc-s",
                               passphrase_enc="enc-p", key_tail="…9999", is_active=True))
    session.commit()

    _move_weex_keys(engine)
    _move_weex_keys(engine)

    rows = session.query(ExchangeAccount).all()
    assert len(rows) == 1
    assert (rows[0].exchange, rows[0].api_key_enc, rows[0].key_tail) == ("weex", "enc-k", "…9999")


def test_replaced_keys_are_not_overwritten_by_the_old_copy():
    from core.db import _move_weex_keys

    engine, session = _session()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()
    session.add(WeexCredential(student_id=student.id, api_key_enc="old", secret_enc="s", passphrase_enc="p"))
    session.add(ExchangeAccount(student_id=student.id, exchange="weex", api_key_enc="new", secret_enc="s", passphrase_enc="p"))
    session.commit()

    _move_weex_keys(engine)
    assert [r.api_key_enc for r in session.query(ExchangeAccount).all()] == ["new"]


def test_active_account_is_the_chosen_one_while_it_is_connected():
    _, session = _session()
    student = Student(tg_id=1, active_exchange="okx")
    session.add(student)
    session.commit()
    session.add_all([_account(student.id, "okx"), _account(student.id, "weex")])
    session.commit()

    assert active_account(session, student).exchange == "okx"

    # Выбранный счёт отключён - новые сделки уходят на подключённый, а не в никуда.
    okx = session.query(ExchangeAccount).filter_by(exchange="okx").one()
    okx.is_active = False
    session.commit()
    assert active_account(session, student).exchange == "weex"


def test_without_a_choice_the_first_exchange_in_order_is_active():
    _, session = _session()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()
    session.add_all([_account(student.id, "okx"), _account(student.id, "weex")])
    session.commit()
    assert active_account(session, student).exchange == "weex"


def test_client_is_the_client_of_the_account_exchange(monkeypatch):
    monkeypatch.setattr(accounts.keystore, "decrypt", lambda value: value)

    async def factory():
        return None

    assert isinstance(client_for(_account(1, "weex"), factory), WeexFutures)
    assert isinstance(client_for(_account(1, "okx"), factory), OkxFutures)


def test_trade_recorded_before_multi_exchange_is_weex():
    assert trade_exchange("") == "weex"
    assert trade_exchange(None) == "weex"
    assert trade_exchange("OKX") == "okx"


def test_client_ids_match_after_the_exchange_cleaned_them():
    # WEEX возвращает как отправили, с номером переноса.
    assert client_matches("BTCUSDT-1789248000000-2", "BTCUSDT-1789248000000")
    # OKX вычищает всё, кроме букв и цифр.
    assert client_matches("BTCUSDT1789248000000x1", "BTCUSDT-1789248000000_x1")
    # И режет до 32 знаков - обрезанный длинный идентификатор всё ещё наш.
    long_id = "trade-" + "a1b2c3d4" * 5
    assert client_matches("".join(ch for ch in long_id if ch.isalnum())[:32], long_id)
    # Короткое совпадение начала ничего не доказывает.
    assert not client_matches("BTC", "BTCUSDT-1789248000000")
    assert not client_matches("", "x")


# ── торговые ручки ───────────────────────────────────────────────────────────


class _Probe:
    """Клиент биржи при подключении ключей: отвечает балансом."""

    async def balance(self, margin_coin="USDT"):
        return [{"marginCoin": "USDT", "availableBalance": "100"}]


class _Exchange:
    """Минимальная биржа для входа по рынку."""

    def __init__(self, exchange: str):
        self.exchange = exchange
        self.orders: list[dict] = []

    async def symbol_filters(self, symbol):
        return {"step": 0.001, "tick": 0.1, "min_qty": 0.001}

    async def set_leverage(self, symbol, leverage, margin_coin="USDT"):
        return None

    async def place_order(self, **kw):
        self.orders.append(kw)
        return {"orderId": "1"}

    async def place_tp_sl(self, **kw):
        return {"orderId": "p1"}

    async def positions(self):
        return []

    async def open_orders(self, symbol):
        return []

    async def algo_orders(self, symbol):
        return []

    async def cancel_order(self, symbol, order_id):
        return None

    async def cancel_algo_order(self, symbol, order_id):
        return None


class _NoAffiliate:
    async def get_affiliate_balance(self, uid):
        return None


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("WEEX_KEYS_SECRET", "мастер-ключ-для-тестов")
    _, session = _session()
    # Ученик пришёл через академию на WEEX, а счёт на OKX ему подтвердили
    # отдельно: без подтверждения биржа в настройках не появляется вовсе
    # (backend/trading/accounts.py, may_connect).
    student = Student(tg_id=1, weex_uid="6067083524")
    session.add(student)
    session.flush()
    session.add(AcademyUid(student_id=student.id, exchange="okx", uid="777000"))
    session.commit()

    # Проверка ключей живёт в общем месте подключения: её используют и ручка
    # ключей, и вход биржей (backend/trading/connect.py).
    monkeypatch.setattr(
        connect_mod, "PROBES", {"weex": lambda *_a, **_k: _Probe(), "okx": lambda *_a, **_k: _Probe()}
    )

    app = FastAPI()
    app.include_router(trading_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student
    app.dependency_overrides[get_weex] = lambda: _NoAffiliate()
    with TestClient(app) as client:
        yield client, session, student


KEYS = {"api_key": "key-12345678", "secret_key": "secret-xx", "passphrase": "pass"}


def test_one_student_connects_several_exchanges(api):
    client, session, student = api
    assert client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"}).json()["exchange"] == "okx"
    assert client.put("/api/trading/keys", json=KEYS).json()["exchange"] == "weex"

    assert {r.exchange for r in session.query(ExchangeAccount).all()} == {"okx", "weex"}
    status = client.get("/api/trading/status").json()
    # Первый подключённый стал активным.
    assert status["active"] == "okx"
    # В списке все биржи с адаптером, а не только подключённые: ученик должен
    # видеть, куда ещё может принести ключи.
    assert {a["exchange"]: a["connected"] for a in status["accounts"]} == {
        "weex": True,
        "okx": True,
        "bingx": False,
    }
    assert "key-12345678" not in str(status)


def test_unknown_exchange_is_refused(api):
    client, _, _ = api
    assert client.put("/api/trading/keys", json={**KEYS, "exchange": "mtgox"}).status_code == 422


def test_active_exchange_needs_its_keys(api):
    client, _, student = api
    client.put("/api/trading/keys", json=KEYS)
    assert client.put("/api/trading/active", json={"exchange": "okx"}).status_code == 409
    client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})
    assert client.put("/api/trading/active", json={"exchange": "okx"}).status_code == 200
    assert student.active_exchange == "okx"


def test_exchange_with_a_live_trade_cannot_be_disconnected(api):
    client, session, student = api
    client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})
    session.add(LiveTrade(student_id=student.id, client_id="c1", symbol="BTCUSDT", side="long",
                          entry=1, initial_stop=1, current_stop=1, qty=1, exchange="okx"))
    session.commit()

    assert client.delete("/api/trading/keys", params={"exchange": "okx"}).status_code == 409
    assert session.query(ExchangeAccount).count() == 1


def test_disconnecting_clears_the_choice(api):
    client, session, student = api
    client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})
    assert client.delete("/api/trading/keys", params={"exchange": "okx"}).json() == {"ok": True}
    assert session.query(ExchangeAccount).count() == 0
    assert student.active_exchange == ""


def test_new_trade_remembers_its_exchange(api, monkeypatch):
    client, session, _ = api
    exchange = _Exchange("okx")
    monkeypatch.setattr(trading_api, "_require_client", lambda *_a, **_k: exchange)
    res = client.post(
        "/api/trading/open",
        json={"symbol": "BTCUSDT", "side": "long", "quantity": 0.01, "leverage": 10,
              "stop": 70000, "takes": [], "client_order_id": "BTCUSDT-1"},
    )
    assert res.status_code == 200, res.text
    assert session.query(LiveTrade).one().exchange == "okx"


def test_trade_is_closed_on_its_own_exchange(api, monkeypatch):
    client, session, student = api
    session.add(LiveTrade(student_id=student.id, client_id="c1", symbol="BTCUSDT", side="long",
                          entry=1, initial_stop=1, current_stop=1, qty=1, exchange="okx", status="waiting"))
    session.commit()
    asked: list = []

    def require(_session, _student, exchange=None):
        asked.append(exchange)
        return _Exchange(exchange or "weex")

    monkeypatch.setattr(trading_api, "_require_client", require)
    client.post("/api/trading/close", json={"symbol": "BTCUSDT", "side": "long", "share": 1, "trade_id": "c1"})
    assert asked == ["okx"]


# ── стоп частично исполнившейся лимитки на OKX ──────────────────────────────


class _OkxPlans:
    """Биржа, где приложенный стоп ждёт полного исполнения входа."""

    stop_waits_full_fill = True

    def __init__(self, plans: list[dict]):
        self.plans = plans
        self.placed: list[dict] = []

    async def algo_orders(self, symbol):
        return list(self.plans)

    async def symbol_filters(self, symbol):
        return {"step": 0.001, "tick": 0.1, "min_qty": 0.001}

    async def positions(self):
        return []

    async def place_tp_sl(self, **kw):
        self.placed.append(kw)
        self.plans.append({"orderId": "new", "planType": kw["plan_type"], "positionSide": kw["position_side"],
                           "triggerPrice": kw["trigger_price"], "clientAlgoId": kw.get("client_algo_id", "")})
        return {"orderId": "new"}

    async def cancel_algo_order(self, symbol, order_id):
        return None


def _open_trade(**over) -> LiveTrade:
    values = dict(student_id=1, client_id="BTCUSDT-1", symbol="BTCUSDT", side="long", entry=80000,
                  initial_stop=79000, current_stop=79000, qty=0.5, status="open", exchange="okx",
                  tp_orders_json="[]", targets_json="[]")
    values.update(over)
    return LiveTrade(**values)


def test_open_position_without_a_stop_gets_one():
    from backend.trading.watcher import Decision, PositionWatcher

    watcher = PositionWatcher(lambda: None, lambda: None)
    client = _OkxPlans([])
    trade = _open_trade()
    asyncio.run(watcher._apply(None, client, trade, Decision(0, size=0.2), 80100.0))

    assert len(client.placed) == 1
    stop = client.placed[0]
    assert stop["plan_type"] == "STOP_LOSS"
    assert stop["position_side"] == "LONG"
    # Стоп на тот объём, что реально набран, а не на задуманный.
    assert float(stop["quantity"]) == pytest.approx(0.2)
    assert trade.sl_order_id == "new"


def test_stop_already_on_the_exchange_is_not_doubled():
    from backend.trading.watcher import Decision, PositionWatcher

    watcher = PositionWatcher(lambda: None, lambda: None)
    client = _OkxPlans([{"orderId": "9", "planType": "STOP_LOSS", "positionSide": "LONG", "triggerPrice": "79000"}])
    asyncio.run(watcher._apply(None, client, _open_trade(), Decision(0, size=0.5), 80100.0))
    assert client.placed == []


def test_exchange_with_stop_attached_at_once_is_not_touched():
    from backend.trading.watcher import Decision, PositionWatcher

    watcher = PositionWatcher(lambda: None, lambda: None)
    client = _OkxPlans([])
    client.stop_waits_full_fill = False
    asyncio.run(watcher._apply(None, client, _open_trade(exchange="weex"), Decision(0, size=0.5), 80100.0))
    assert client.placed == []
