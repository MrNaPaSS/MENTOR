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
from backend.trading import connect as connect_mod
from backend.deps import get_current_student, get_session, get_weex
from core.db import Base
from core.models import LiveTrade, Student


class FakeExchange:
    """Биржа без сети: запоминает, что ей отправили."""

    def __init__(self):
        self.orders: list[dict] = []
        self.pending = []
        self.plans = []
        self.plans_open = []
        self.fills = []
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
    fills: list[dict] = []
    cancelled: list[str] = []
    algo_cancelled: list[str] = []

    async def positions(self):
        return [self.position] if self.position else []

    async def open_orders(self, symbol):
        return list(self.pending)

    async def cancel_order(self, symbol, order_id):
        # Снятая заявка уходит из списка - как на бирже. Пока она там
        # оставалась, проверка «убрали ли за собой» ничего не проверяла: код
        # видел её снова и снимал второй раз.
        self.cancelled.append(order_id)
        self.pending = [
            o
            for o in self.pending
            if str(order_id)
            not in {
                str(o.get(name) or "")
                for name in ("orderId", "id", "clientOrderId", "clientOid")
            }
        ]

    async def algo_orders(self, symbol):
        return list(self.plans_open)

    async def cancel_algo_order(self, symbol, order_id):
        # Снятая заявка со списка уходит - как на бирже. Пока она оставалась в
        # ответе, проверка «действительно ли сняли» ничего не проверяла.
        #
        # Снимаем и по метке: у части условных заявок своего номера в списке
        # нет вовсе, и биржа принимает снятие по той метке, которую мы задали
        # при постановке.
        self.algo_cancelled.append(order_id)
        self.plans_open = [
            o
            for o in self.plans_open
            if str(order_id)
            not in {
                str(o.get(name) or "")
                for name in ("orderId", "algoId", "id", "clientAlgoId", "clientOid")
            }
        ]

    async def cancel_all_algo(self, symbol):
        self.algo_cancelled.append(symbol)

    async def user_trades(self, symbol, limit=100):
        # Биржа сообщает, что вышло на самом деле: результат и комиссия.
        return list(self.fills)

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
        order_id = f"p{len(self.plans)}"
        # Поставленная заявка появляется в списке висящих - как на бирже. Пока
        # её там не было, проверки «что реально стоит на позиции» проверяли
        # пустоту.
        self.plans_open = [
            *self.plans_open,
            {
                "orderId": order_id,
                "planType": kw.get("plan_type", ""),
                "triggerPrice": kw.get("trigger_price", ""),
                "quantity": kw.get("quantity", ""),
                "clientAlgoId": kw.get("client_algo_id", ""),
            },
        ]
        return [{"success": True, "orderId": order_id}]

    async def modify_tp_sl(self, **kw):
        self.modified.append(kw)
        return {"ok": True}


class _NoAffiliate:
    """Партнёрка, которая этого UID не знает."""

    async def get_affiliate_balance(self, uid):
        return None


@pytest.fixture()
def app_and_exchange(monkeypatch):
    monkeypatch.setenv("WEEX_KEYS_SECRET", "мастер-ключ-для-тестов")

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    # Ученик академии: WEEX открыт ему самим фактом регистрации по UID.
    student = Student(tg_id=1, weex_uid="6067083524")
    session.add(student)
    session.commit()

    exchange = FakeExchange()
    monkeypatch.setattr(trading_api, "_require_client", lambda *_: exchange)

    app = FastAPI()
    app.include_router(trading_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student
    # Партнёрка при подключении ключей: этот ученик не реферал академии.
    app.dependency_overrides[get_weex] = lambda: _NoAffiliate()
    # Доступ к разделу проверяется отдельно — здесь он не предмет теста.

    with TestClient(app) as client:
        yield client, exchange, session


def test_status_reports_configuration(app_and_exchange):
    client, _, _ = app_and_exchange
    body = client.get("/api/trading/status").json()
    assert body["enabled"] is True
    assert body["connected"] is False


def test_keys_are_stored_encrypted_and_never_returned(app_and_exchange, monkeypatch):
    client, exchange, session = app_and_exchange
    # Проверка ключей живёт в общем месте подключения: одни правила у ключей
    # и у входа биржей (backend/trading/connect.py).
    monkeypatch.setattr(
        connect_mod, "PROBES", {**connect_mod.PROBES, "weex": lambda *_a, **_k: exchange}
    )

    body = client.put(
        "/api/trading/keys",
        json={"api_key": "key-1234", "secret_key": "secret-x", "passphrase": "pass"},
    ).json()
    assert body["key_tail"] == "…1234"

    from core.models import ExchangeAccount

    row = session.query(ExchangeAccount).one()
    assert row.exchange == "weex"
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

    monkeypatch.setattr(
        connect_mod, "PROBES", {**connect_mod.PROBES, "weex": lambda *_a, **_k: Rejecting()}
    )
    res = client.put(
        "/api/trading/keys",
        json={"api_key": "key-1234", "secret_key": "secret-x", "passphrase": "pass"},
    )
    assert res.status_code == 400

    from core.models import ExchangeAccount

    assert session.query(ExchangeAccount).count() == 0


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
    # Доли 30 / 50 / 20 процентов от 0.3 монеты, округлённые вниз до шага лота.
    assert [p["quantity"] for p in exchange.plans] == ["0.09", "0.15", "0.06"]


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


class Watched:
    """Сопровождение, которое отдаёт замок счёта и помнит, брали ли его."""

    def __init__(self, events: list[str]):
        self.events = events

    def account_lock(self, student_id, exchange_name):
        events = self.events

        class Lock:
            async def __aenter__(self):
                events.append("взят")
                return self

            async def __aexit__(self, *exc):
                events.append("отпущен")
                return False

        events.append(f"спрошен {exchange_name}")
        return Lock()


def test_open_goes_under_the_account_lock(app_and_exchange):
    """Вход со стопом идёт под замком счёта.

    Пока он шёл мимо, обход сопровождения мог в те же секунды двигать защиту
    соседней сделки на этой же позиции, и заявки двух переносов снимали друг
    друга.
    """
    client, exchange, _ = app_and_exchange
    events: list[str] = []
    client.app.state.position_watcher = Watched(events)

    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "btcusdt",
            "side": "long",
            "quantity": 0.5,
            "leverage": 10,
            "stop": 79000,
            "takes": [80000],
        },
    )
    assert res.status_code == 200
    assert events == ["спрошен weex", "взят", "отпущен"]
    # Заявка ушла внутри замка, а не до него.
    assert exchange.orders


def test_close_goes_under_the_account_lock(app_and_exchange):
    """Закрытие тоже под замком.

    Иначе закрытие снимает защиту, а обход в те же секунды ставит новую: стоп
    остаётся висеть на закрытой позиции, и рынок, дойдя до его цены, открывает
    её заново.
    """
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    events: list[str] = []
    client.app.state.position_watcher = Watched(events)

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    assert body["closed"] == 0.5
    assert events == ["спрошен weex", "взят", "отпущен"]


def test_breakeven_goes_under_the_account_lock(app_and_exchange):
    """Служебный перенос берёт замок счёта - тот же, что и обход сопровождения.

    Сопровождение двигает стоп в безубыток само. Начатые в одни и те же
    секунды, два переноса снимают заявки друг друга, и что останется на
    позиции - решает случай.
    """
    client, exchange, _ = app_and_exchange
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
            events.append(f"спрошен {exchange_name}")
            return Lock()

    client.app.state.position_watcher = Watcher()
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
    assert events == ["спрошен weex", "взят", "отпущен"]


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


def test_journal_gets_the_exchange_result_not_our_estimate(app_and_exchange):
    """На экране было +209, на счёт пришло 75.

    Наша цифра считается по цене маркировки и без комиссий. Правду знает
    только биржа, и в отчёт должна идти она.
    """
    client, exchange, session = app_and_exchange
    _watched(session, opened_ms=1000)
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    exchange.fills = [
        {
            "orderId": "o1",
            "realizedPnl": "83.6",
            "commission": "8.2",
            "price": "79500",
            "time": 2000,
        },
    ]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    # 83.6 по бирже минус 8.2 комиссии — столько и приходит на счёт.
    assert body["realized"] == 75.4
    assert body["fee"] == 8.2
    assert body["fill_price"] == 79500.0


def test_missing_fills_do_not_invent_a_result(app_and_exchange):
    """Биржа промолчала — возвращаем пустоту, а не придуманное число."""
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    exchange.fills = []

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    assert body["realized"] is None and body["fee"] is None


def _watched(session, opened_ms: int) -> None:
    """Сделка под ведением: без неё сервер не знает, с какого момента считать."""
    from datetime import datetime, timezone

    from core.models import LiveTrade

    session.add(
        LiveTrade(
            student_id=1,
            client_id="c1",
            symbol="BTCUSDT",
            side="long",
            entry=80000,
            initial_stop=79000,
            current_stop=79000,
            targets_json="[]",
            tp_orders_json="[]",
            qty=0.5,
            leverage=10,
            margin=100,
            status="open",
            opened_at=datetime.fromtimestamp(opened_ms / 1000, tz=timezone.utc),
        )
    )
    session.commit()


def test_result_counts_every_fill_of_the_trade_minus_fees(app_and_exchange):
    """Сделка — это вход, сработавшие цели и выход, а не один ордер.

    Спрашивать только закрывающий ордер значит потерять остальное; а если биржа
    не успела его проиндексировать — потерять всё и записать свою оценку.
    Комиссия вычитается: биржа считает результат до неё, трейдер видит после.
    """
    client, exchange, session = app_and_exchange
    _watched(session, opened_ms=1000)
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    exchange.fills = [
        {"orderId": "tp1", "realizedPnl": "20.0", "commission": "3.0", "time": 2000},
        {"orderId": "o1", "realizedPnl": "-10.0", "commission": "1.57", "time": 3000},
    ]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1},
    ).json()

    # 20 − 10 = 10 по бирже, минус 4.57 комиссии.
    assert body["realized"] == 5.43
    assert body["fee"] == 4.57


def test_limits_name_the_ceiling_of_the_instrument(app_and_exchange, monkeypatch):
    """Потолок плеча у каждой монеты свой, и знать его нужно до ордера.

    У большинства инструментов биржи он ×20 или ×50, а кнопки в окне расчёта
    доходят до ×400: без этой ручки отказ приходил уже после «Войти».
    """
    client, _, _ = app_and_exchange

    async def fake(session, symbol):
        assert symbol == "SKHYNIXUSDT"
        return {
            "step": 0.001,
            "tick": 0.01,
            "min_qty": 0.001,
            "max_leverage": 50.0,
            "taker_fee": 0.0008,
        }

    monkeypatch.setattr(trading_api, "public_filters", fake)

    body = client.get("/api/trading/limits/skhynixusdt").json()
    assert body["max_leverage"] == 50
    assert body["taker_fee"] == 0.0008


def test_cancelling_a_limit_keeps_the_other_trade_protected(app_and_exchange):
    """Снятие ждущей лимитки не трогает защиту открытой сделки.

    Самый дорогой из возможных исходов: заявку сняли, а вместе с ней ушли стоп
    и цели соседней позиции - и она осталась голой, ничего об этом не сказав.
    Так и было: неопознанная сделка снимала всё по монете подряд.
    """
    import json as _json

    from core.models import LiveTrade

    client, exchange, session = app_and_exchange
    student = session.query(Student).one()

    # Открытая сделка со своей защитой.
    session.add(
        LiveTrade(
            student_id=student.id,
            client_id="BTCUSDT-open",
            symbol="BTCUSDT",
            side="short",
            entry=80_000.0,
            initial_stop=80_200.0,
            current_stop=80_200.0,
            targets_json=_json.dumps([79_600.0]),
            tp_orders_json=_json.dumps([{"price": 79_600.0, "order_id": "tp-open"}]),
            sl_order_id="sl-open",
            qty=0.01,
            leverage=10,
            status="open",
        )
    )
    session.commit()

    exchange.position = None
    exchange.pending = [{"orderId": "limit-1", "clientOrderId": "BTCUSDT-gone"}]
    exchange.plans_open = [
        {"orderId": "sl-open", "planType": "STOP_LOSS", "triggerPrice": "80200"},
        {"orderId": "tp-open", "planType": "TAKE_PROFIT", "triggerPrice": "79600"},
        # Ничья заявка: хозяина среди наших сделок нет - её и убираем.
        {"orderId": "orphan", "planType": "STOP_LOSS", "triggerPrice": "81000"},
    ]

    # Снимаем лимитку, записи о которой на сервере уже нет.
    answer = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1, "trade_id": "BTCUSDT-gone"},
    )
    assert answer.status_code == 200

    # Защита открытой сделки на месте, ничья заявка снята.
    assert "sl-open" not in exchange.algo_cancelled
    assert "tp-open" not in exchange.algo_cancelled
    assert "orphan" in exchange.algo_cancelled


def test_manual_close_writes_the_trade_to_the_journal(app_and_exchange):
    """Закрытая кнопкой сделка попадает в журнал.

    Сопровождение ведёт только живые сделки. Закрытие снимает сделку с ведения
    - и записывать её становилось некому: на бирже прибыль есть, а в журнале
    сделки нет вовсе.
    """
    import json as _json

    from core.models import LiveTrade, ScalpTrade

    client, exchange, session = app_and_exchange
    student = session.query(Student).one()

    session.add(
        LiveTrade(
            student_id=student.id,
            client_id="BTCUSDT-1",
            symbol="BTCUSDT",
            side="long",
            entry=80_000.0,
            initial_stop=79_800.0,
            current_stop=79_800.0,
            targets_json=_json.dumps([80_400.0]),
            qty=0.01,
            leverage=10,
            margin=80.0,
            status="open",
        )
    )
    session.commit()

    exchange.position = {"symbol": "BTCUSDT", "positionSide": "LONG", "total": "0.01"}
    exchange.fills = [
        {
            "orderId": "o1",
            "side": "SELL",
            "price": "80500",
            "qty": "0.01",
            "realizedPnl": "5.0",
            "commission": "0.64",
            "time": 9_999_999_999_999,
        }
    ]

    answer = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1, "trade_id": "BTCUSDT-1"},
    ).json()
    assert answer["remaining"] == 0

    row = session.query(ScalpTrade).one()
    assert row.symbol == "BTCUSDT"
    assert row.side == "long"
    # Результат за вычетом комиссии - то же число, что ушло на экран. База
    # хранит деньги десятичными, поэтому сравниваем через float.
    assert float(row.pnl) == pytest.approx(5.0 - 0.64, rel=1e-9)
    assert row.outcome == "manual"
    # Помечена биржевой: оценка с экрана её не перепишет.
    assert row.from_exchange is True


def test_cancelling_a_waiting_limit_never_closes_the_position(app_and_exchange):
    """Две лимитки на продажу, исполнилась нижняя. Снятие верхней не трогает позицию.

    Раньше здесь смотрели только на объём позиции: она есть - значит закрываем.
    И снятие ещё стоящей заявки уходило рыночным приказом закрывать позицию,
    набранную соседней сделкой. Трейдер отменял одну, а закрывались обе.
    """
    import json as _json

    from core.models import LiveTrade

    client, exchange, session = app_and_exchange
    student = session.query(Student).one()

    for client_id, status in (("BTCUSDT-low", "open"), ("BTCUSDT-high", "waiting")):
        session.add(
            LiveTrade(
                student_id=student.id,
                client_id=client_id,
                symbol="BTCUSDT",
                side="short",
                entry=80_000.0,
                initial_stop=80_200.0,
                current_stop=80_200.0,
                targets_json=_json.dumps([79_600.0]),
                tp_orders_json="[]",
                qty=0.01,
                leverage=10,
                margin=80.0,
                status=status,
            )
        )
    session.commit()

    # Позиция набрана нижней сделкой, верхняя лимитка ещё стоит в заявках.
    exchange.position = {"symbol": "BTCUSDT", "positionSide": "SHORT", "total": "0.01"}
    exchange.pending = [{"orderId": "e2", "clientOrderId": "BTCUSDT-high"}]

    answer = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "short", "share": 1, "trade_id": "BTCUSDT-high"},
    ).json()

    # Ни одного рыночного приказа: позицию никто не закрывал.
    assert exchange.orders == []
    assert answer["closed"] == 0
    # Позиция соседней сделки осталась - терминал не должен решить, что всё ушло.
    assert answer["remaining"] == 0.01
    # А сама заявка снята.
    assert "e2" in exchange.cancelled


def test_live_trades_lists_what_the_watcher_still_leads(app_and_exchange):
    """Второе мнение о том, жива ли сделка.

    Терминал хоронил разметку по пустому ответу биржи: 10 сентября две живые
    позиции по ETH ушли с графика за две секунды, пока на бирже они стояли.
    Теперь перед похоронами он спрашивает сервер, и пока сопровождение сделку
    ведёт, она остаётся на экране.
    """
    import json as _json

    client, _, session = app_and_exchange
    student = session.query(Student).one()

    from core.models import LiveTrade

    session.add_all(
        [
            LiveTrade(
                student_id=student.id,
                client_id="ETHUSDT-1789062954087",
                symbol="ETHUSDT",
                side="long",
                entry=2464.0,
                initial_stop=2459.0,
                current_stop=2459.0,
                targets_json=_json.dumps([2470.0]),
                tp_orders_json="[]",
                qty=40.584,
                leverage=200,
                status="open",
                takes_hit=1,
            ),
            LiveTrade(
                student_id=student.id,
                client_id="BTCUSDT-done",
                symbol="BTCUSDT",
                side="short",
                entry=80_000.0,
                initial_stop=80_200.0,
                current_stop=80_200.0,
                targets_json="[]",
                tp_orders_json="[]",
                qty=0.01,
                leverage=10,
                status="closed",
            ),
        ]
    )
    session.commit()

    body = client.get("/api/trading/live").json()
    ids = [row["client_id"] for row in body["trades"]]
    # Закрытой сделки в списке нет: её сервер уже не ведёт.
    assert ids == ["ETHUSDT-1789062954087"]

    one = body["trades"][0]
    assert one["symbol"] == "ETHUSDT"
    assert one["side"] == "long"
    assert one["status"] == "open"
    assert one["takes_hit"] == 1
    assert one["qty"] == pytest.approx(40.584)


def test_live_trades_hide_other_students(app_and_exchange):
    """Чужая сделка в ответ не попадает: список читается по своему ученику."""
    import json as _json

    client, _, session = app_and_exchange

    from core.models import LiveTrade

    stranger = Student(tg_id=777)
    session.add(stranger)
    session.commit()
    session.add(
        LiveTrade(
            student_id=stranger.id,
            client_id="ETHUSDT-stranger",
            symbol="ETHUSDT",
            side="short",
            entry=2464.0,
            initial_stop=2470.0,
            current_stop=2470.0,
            targets_json=_json.dumps([2450.0]),
            tp_orders_json="[]",
            qty=1.0,
            leverage=10,
            status="open",
        )
    )
    session.commit()

    body = client.get("/api/trading/live").json()
    assert body["trades"] == []


def test_live_trades_carry_what_just_closed(app_and_exchange):
    """Только что закрытая сделка приходит с настоящими ценой выхода и итогом.

    По ним терминал говорит, чем кончилась сделка. Раньше он угадывал: по
    снятым вместе со стопом целям объявлял «взята цель 3», а следом - «стоп».
    Старые записи в ответ не попадают - список должен оставаться коротким.
    """
    from datetime import timedelta

    from core.models import ScalpTrade, utcnow

    client, _, session = app_and_exchange
    student = session.query(Student).one()

    def journal(client_id: str, closed_at, pnl: float) -> ScalpTrade:
        return ScalpTrade(
            student_id=student.id,
            client_id=client_id,
            symbol="ETHUSDT",
            side="long",
            entry=2464.0,
            stop=2459.0,
            exit_price=2458.6,
            qty=40.0,
            margin=100.0,
            leverage=200,
            outcome="stop",
            pnl=pnl,
            fee=1.2,
            closed_at=closed_at,
        )

    session.add_all(
        [
            journal("ETHUSDT-fresh", utcnow() - timedelta(minutes=1), -21.5),
            journal("ETHUSDT-old", utcnow() - timedelta(hours=2), -3.0),
        ]
    )
    session.commit()

    body = client.get("/api/trading/live").json()
    assert [row["client_id"] for row in body["closed"]] == ["ETHUSDT-fresh"]
    one = body["closed"][0]
    assert one["exit_price"] == pytest.approx(2458.6)
    assert one["pnl"] == pytest.approx(-21.5)
    assert one["fee"] == pytest.approx(1.2)


def _open_body(**over):
    body = {
        "symbol": "BTCUSDT",
        "side": "long",
        "quantity": 0.5,
        "leverage": 10,
        "stop": 79000,
        "takes": [80000, 80500, 81000],
        "client_order_id": "BTCUSDT-1",
    }
    body.update(over)
    return body


def test_entry_without_answer_is_watched(app_and_exchange):
    """Биржа не ответила на вход - сделка встаёт под наблюдение, а не теряется.

    Заявка могла исполниться: без записи для сопровождения такая позиция
    оставалась без стопа и целей, а трейдер думал, что входа нет.
    """
    client, exchange, session = app_and_exchange
    from core.models import LiveTrade
    from core.weex.futures import WeexTradeError

    async def silent(**kw):
        exchange.orders.append(kw)
        raise WeexTradeError("Биржа не ответила вовремя", retryable=True)

    exchange.place_order = silent
    res = client.post("/api/trading/open", json=_open_body())
    assert res.status_code == 502
    assert "наблюдение" in res.json()["detail"]

    row = session.query(LiveTrade).one()
    assert row.client_id == "BTCUSDT-1"
    assert row.status == "waiting"
    assert float(row.initial_stop) == 79000
    assert json.loads(row.targets_json) == [80000, 80500, 81000]
    # Целей по неизвестному входу не ставили: их выставит сопровождение.
    assert exchange.plans == []


def test_refused_entry_is_not_watched(app_and_exchange):
    """Отказ биржи по существу - записи нет: следить не за чем."""
    client, exchange, session = app_and_exchange
    from core.models import LiveTrade
    from core.weex.futures import WeexTradeError

    async def refused(**kw):
        raise WeexTradeError("insufficient margin")

    exchange.place_order = refused
    res = client.post("/api/trading/open", json=_open_body())
    assert res.status_code == 400
    assert session.query(LiveTrade).count() == 0


def test_entry_is_not_sent_on_guessed_steps(app_and_exchange):
    """Биржа не отдала шаги инструмента - вход по угаданным не уходит."""
    client, exchange, _ = app_and_exchange

    async def guessed(symbol):
        return {"step": 0.001, "tick": 0.01, "min_qty": 0.001, "guessed": 1.0}

    exchange.symbol_filters = guessed
    res = client.post("/api/trading/open", json=_open_body())
    assert res.status_code == 503
    assert exchange.orders == []


def test_live_lists_recently_finished_trades(app_and_exchange):
    """Терминал узнаёт, какие сделки сервер уже завершил - за дни, а не минуты.

    Ждущая лимитка, исполнившаяся и закрытая ночью, иначе висела на графике
    «ждущей»: сервер о ней молчал, а похороны касаются только открытых сделок.
    """
    from datetime import timedelta

    from core.models import LiveTrade, Student, utcnow

    client, _, session = app_and_exchange
    student = session.query(Student).first()

    def row(client_id, status, closed_at=None):
        return LiveTrade(
            student_id=student.id,
            client_id=client_id,
            symbol="BTCUSDT",
            side="long",
            entry=100,
            initial_stop=99,
            current_stop=99,
            qty=1,
            status=status,
            closed_at=closed_at,
        )

    session.add_all(
        [
            row("fresh", "closed", utcnow() - timedelta(hours=10)),
            row("old", "closed", utcnow() - timedelta(days=10)),
            row("live", "waiting"),
        ]
    )
    session.commit()

    body = client.get("/api/trading/live").json()
    assert body["finished"] == ["fresh"]
    assert [t["client_id"] for t in body["trades"]] == ["live"]


def test_a_forgotten_limit_is_cancelled_by_its_mark(app_and_exchange):
    """Отмена сделки снимает лимитку и тогда, когда метки в списке нет.

    Биржа возвращает наше имя заявки не всегда: на MEXC список приходил без
    него. Опознать в таком списке свою заявку нечем, и она оставалась висеть -
    рынок, дойдя до её цены, открыл бы позицию, о которой никто не знает.
    """
    client, exchange, session = app_and_exchange
    session.add(
        LiveTrade(
            student_id=1,
            client_id="BTCUSDT-7",
            symbol="BTCUSDT",
            side="long",
            entry=80_000.0,
            initial_stop=79_000.0,
            current_stop=79_000.0,
            targets_json="[80500]",
            qty=0.5,
            leverage=10,
            status="waiting",
        )
    )
    session.commit()
    # Заявка на бирже есть, но без нашего имени.
    exchange.pending = [{"orderId": "e9"}]

    body = client.post(
        "/api/trading/close",
        json={"symbol": "BTCUSDT", "side": "long", "share": 1, "trade_id": "BTCUSDT-7"},
    ).json()

    assert body["closed"] == 0.0
    assert exchange.cancelled == ["BTCUSDT-7"]


MEXC_LOCK = "Leverage adjustment unavailable while orders are open"


def _short_body(leverage: int = 10) -> dict:
    return {
        "symbol": "BTCUSDT",
        "side": "short",
        "quantity": 0.5,
        "leverage": leverage,
        "entry": 81000,
        "stop": 82000,
        "takes": [80000],
    }


def test_mexc_leverage_lock_with_the_same_leverage_lets_the_entry_through(app_and_exchange):
    """Плечо не меняется, пока висят заявки, - но менять его и не нужно.

    MEXC пишет отказ словами в обратном порядке («orders are open»), и он не
    узнавался: трейдер получал сырой текст биржи и думал, что лимитки в две
    стороны запрещены. Запрещена только смена плеча - а если на бирже стоит
    ровно запрошенное, вход уходит как задуман.
    """
    from core.weex.futures import WeexTradeError

    client, exchange, _ = app_and_exchange

    async def locked(symbol, leverage, margin_coin="USDT"):
        raise WeexTradeError(MEXC_LOCK)

    async def leverage_of(symbol, long=True):
        return 10

    exchange.set_leverage = locked  # type: ignore[assignment]
    exchange.leverage_of = leverage_of  # type: ignore[attr-defined]

    res = client.post("/api/trading/open", json=_short_body(10))
    assert res.status_code == 200
    assert exchange.orders and exchange.orders[-1]["side"] == "SELL"


def test_mexc_leverage_lock_with_another_leverage_is_explained(app_and_exchange):
    """Плечо на бирже другое - вход не уходит, а причина сказана словами."""
    from core.weex.futures import WeexTradeError

    client, exchange, _ = app_and_exchange

    async def locked(symbol, leverage, margin_coin="USDT"):
        raise WeexTradeError(MEXC_LOCK)

    async def leverage_of(symbol, long=True):
        return 20

    exchange.set_leverage = locked  # type: ignore[assignment]
    exchange.leverage_of = leverage_of  # type: ignore[attr-defined]

    res = client.post("/api/trading/open", json=_short_body(10))
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert "x20" in detail and "x10" in detail
    assert MEXC_LOCK not in detail
    assert exchange.orders == []


def test_the_leverage_is_read_for_the_side_of_the_entry(app_and_exchange):
    """У MEXC плечо своё у лонга и шорта - спрашиваем сторону входа."""
    from core.weex.futures import WeexTradeError

    client, exchange, _ = app_and_exchange
    asked: list[bool] = []

    async def locked(symbol, leverage, margin_coin="USDT"):
        raise WeexTradeError(MEXC_LOCK)

    async def leverage_of(symbol, long=True):
        asked.append(long)
        return 10

    exchange.set_leverage = locked  # type: ignore[assignment]
    exchange.leverage_of = leverage_of  # type: ignore[attr-defined]

    assert client.post("/api/trading/open", json=_short_body(10)).status_code == 200
    assert asked == [False]


def test_leverage_500_passes_the_field_check(app_and_exchange):
    """Плечо x500 - не ошибка проверки полей.

    MEXC даёт x500, а модель входа держала потолок x400: вход отбивался 422 со
    списком ошибок, и трейдер видел «[object Object]». Предел монеты проверяет
    биржа и окно расчёта, а не форма запроса.
    """
    client, exchange, _ = app_and_exchange
    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "BTCUSDT",
            "side": "long",
            "quantity": 0.5,
            "leverage": 500,
            "stop": 79000,
            "takes": [80000],
        },
    )
    assert res.status_code == 200
    assert exchange.leverage == ("BTCUSDT", 500)


def test_a_whole_close_goes_through_the_exchange_close_endpoint(app_and_exchange):
    """Биржа умеет закрывать позицию своей ручкой - вся позиция уходит через неё.

    На OKX рыночный приказ «только сокращение» на позиции с висящими целями и
    стопом отбивался кодом 51169, и закрыть сделку из терминала было нельзя.
    """
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    closed: list[dict] = []

    async def close_position(**kw):
        closed.append(kw)
        return {"orderId": "c1"}

    exchange.close_position = close_position  # type: ignore[attr-defined]

    body = client.post(
        "/api/trading/close", json={"symbol": "BTCUSDT", "side": "long", "share": 1}
    ).json()

    assert body["closed"] == 0.5
    assert closed and closed[0]["position_side"] == "LONG"
    assert exchange.orders == []


def test_a_partial_close_stays_an_ordinary_order(app_and_exchange):
    """Часть позиции ручкой закрытия не закрыть - она закрывает всё."""
    client, exchange, _ = app_and_exchange
    exchange.position = {"symbol": "BTCUSDT", "total": "0.5"}
    closed: list[dict] = []

    async def close_position(**kw):
        closed.append(kw)
        return {"orderId": "c1"}

    exchange.close_position = close_position  # type: ignore[attr-defined]

    client.post("/api/trading/close", json={"symbol": "BTCUSDT", "side": "long", "share": 0.5})

    assert closed == []
    assert exchange.orders and exchange.orders[-1]["order_type"] == "MARKET"


def test_close_position_resets_the_read_memory():
    from backend.trading.live_state import WRITES

    assert "close_position" in WRITES


def _binance_account(monkeypatch, signed):
    """Подключённый счёт Binance: открытый справочник плеча не называет."""
    from types import SimpleNamespace

    monkeypatch.setattr(
        trading_api, "active_account", lambda *_a: SimpleNamespace(exchange="binance", is_active=True)
    )

    async def public(session, symbol):
        return {"step": 0.001, "tick": 0.1, "min_qty": 0.001, "max_leverage": 0.0}

    monkeypatch.setattr(trading_api, "binance_public_filters", public)
    monkeypatch.setattr(trading_api, "_client", lambda _row: signed)


def test_binance_limits_show_the_leverage_of_the_account(app_and_exchange, monkeypatch):
    """Предел плеча Binance - по ключу ученика, а не запасные ×20.

    В открытом справочнике Binance плеча нет: оно приходит только подписанной
    ручкой уровней. Терминал писал «максимум ×20», а биржа по BTC пускала ×150.
    """
    client, _, _ = app_and_exchange

    class Signed:
        async def max_leverage(self, symbol):
            assert symbol == "BTCUSDT"
            return 150.0

    _binance_account(monkeypatch, Signed())
    body = client.get("/api/trading/limits/btcusdt").json()
    assert body["max_leverage"] == 150


def test_limits_survive_a_silent_exchange(app_and_exchange, monkeypatch):
    """Биржа не ответила по ключу - окно расчёта не ломается, предел прежний."""
    client, _, _ = app_and_exchange

    class Broken:
        async def max_leverage(self, symbol):
            raise RuntimeError("сеть")

    _binance_account(monkeypatch, Broken())
    body = client.get("/api/trading/limits/btcusdt").json()
    assert body["max_leverage"] == 20


def test_the_separate_stop_of_the_entry_is_remembered(app_and_exchange):
    """Номер стопа, поставленного рядом со входом, записывается в сделку.

    На Binance стоп приложить ко входу нельзя, он уходит отдельной заявкой.
    Номер её терялся, и отмена сделки снимала лимитку, а стоп оставался на
    бирже: рынок, дойдя до его цены, закрыл бы чужую позицию.
    """
    from core.models import LiveTrade

    client, exchange, session = app_and_exchange
    plain = exchange.place_order

    async def place_order(**kw):
        placed = await plain(**kw)
        return {**placed, "slOrderId": "sl-77"} if kw.get("sl_trigger") else placed

    exchange.place_order = place_order

    res = client.post(
        "/api/trading/open",
        json={
            "symbol": "btcusdt",
            "side": "long",
            "quantity": 0.5,
            "leverage": 10,
            "entry": 79500,
            "stop": 79000,
            "takes": [80000],
        },
    )
    assert res.status_code == 200

    live = session.query(LiveTrade).order_by(LiveTrade.id.desc()).first()
    assert live is not None
    assert live.sl_order_id == "sl-77"



def test_plans_asks_the_exchange_for_both_lists_at_once(app_and_exchange):
    """Защита и ждущие заявки спрашиваются разом, а не по очереди.

    Это два похода на биржу примерно по четверти секунды, и терминал ждал их
    сумму: в панели здоровья эта ручка была самой долгой из частых - 658 мс
    обычно при ответе биржи в 250.
    """
    import asyncio
    import time

    client, exchange, _session = app_and_exchange
    began: list[float] = []

    async def slow_algo(symbol):
        began.append(time.perf_counter())
        await asyncio.sleep(0.2)
        return []

    async def slow_open(symbol):
        began.append(time.perf_counter())
        await asyncio.sleep(0.2)
        return []

    exchange.algo_orders = slow_algo
    exchange.open_orders = slow_open

    started = time.perf_counter()
    answer = client.get("/api/trading/plans/BTCUSDT")
    spent = time.perf_counter() - started

    assert answer.status_code == 200
    assert len(began) == 2
    # Оба ушли почти одновременно, и ручка уложилась в один поход, а не в два.
    assert began[1] - began[0] < 0.1
    assert spent < 0.35
