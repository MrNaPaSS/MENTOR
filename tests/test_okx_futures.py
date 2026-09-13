"""Клиент OKX: подпись, контракты и перевод ответов в поля WEEX.

Сети нет: сессия подменена и отвечает тем, что OKX присылает на самом деле, по
полям из документации v5. Главное здесь - объём: OKX считает в контрактах, и
ошибка перевода означает стоп на объём в сто раз больше позиции.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

import pytest

from core.okx import futures as okx
from core.okx.futures import OkxFutures, client_id, inst_id, sign, symbol_of
from core.weex.futures import Credentials, WeexTradeError, plan_order_id

BTC = {
    "instId": "BTC-USDT-SWAP",
    "ctVal": "0.01",
    "lotSz": "0.01",
    "minSz": "0.01",
    "tickSz": "0.1",
    "lever": "100",
    "maxLmtSz": "100000",
}


class _Response:
    def __init__(self, payload, status=200):
        self._text = json.dumps(payload)
        self.status = status

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Отвечает по пути; запоминает, что ушло."""

    def __init__(self, routes: dict[str, object], mode: str = "long_short_mode"):
        self.routes = {
            "/api/v5/public/instruments": {"code": "0", "data": [BTC]},
            "/api/v5/account/config": {"code": "0", "data": [{"posMode": mode}]},
            "/api/v5/account/trade-fee": {"code": "0", "data": [{"takerU": "-0.0005"}]},
            **routes,
        }
        self.sent: list[dict] = []

    def request(self, method, url, data=None, headers=None, timeout=None):
        parsed = urlparse(url)
        body = json.loads(data.decode()) if data else None
        self.sent.append(
            {"method": method, "path": parsed.path, "query": parse_qs(parsed.query), "body": body, "headers": headers}
        )
        payload = self.routes.get(parsed.path, {"code": "0", "data": []})
        if callable(payload):
            payload = payload(self.sent[-1])
        return _Response(payload)


@pytest.fixture(autouse=True)
def _fresh_caches():
    okx._INSTRUMENTS.clear()
    okx._MODES.clear()
    okx._INSTRUMENTS_AT = 0.0
    yield


def client(session: FakeSession, **kw) -> OkxFutures:
    async def factory():
        return session

    return OkxFutures(Credentials("key", "secret", "phrase"), factory, broker_code=kw.pop("broker", "NMNH"), demo=kw.pop("demo", False))


def run(coro):
    return asyncio.run(coro)


def sent_to(session: FakeSession, path: str) -> dict:
    return next(s for s in reversed(session.sent) if s["path"] == path)


# ── основа ───────────────────────────────────────────────────────────────────


def test_signature_is_hmac_of_time_method_path_and_body():
    expected = base64.b64encode(
        hmac.new(b"secret", b"2026-09-13T10:00:00.000ZGET/api/v5/account/positions?instType=SWAP", hashlib.sha256).digest()
    ).decode()
    assert sign("secret", "2026-09-13T10:00:00.000Z", "get", "/api/v5/account/positions?instType=SWAP", "") == expected


def test_request_is_signed_with_the_query_and_marked_demo():
    session = FakeSession({"/api/v5/account/positions": {"code": "0", "data": []}})
    run(client(session, demo=True).positions())
    call = sent_to(session, "/api/v5/account/positions")
    headers = call["headers"]
    expected = sign("secret", headers["OK-ACCESS-TIMESTAMP"], "GET", "/api/v5/account/positions?instType=SWAP", "")
    assert headers["OK-ACCESS-SIGN"] == expected
    assert headers["OK-ACCESS-KEY"] == "key"
    assert headers["OK-ACCESS-PASSPHRASE"] == "phrase"
    assert headers["x-simulated-trading"] == "1"


def test_instrument_names_go_both_ways():
    assert inst_id("btcusdt") == "BTC-USDT-SWAP"
    assert inst_id("BTC-USDT-SWAP") == "BTC-USDT-SWAP"
    assert symbol_of("PEPE-USDT-SWAP") == "PEPEUSDT"


def test_client_ids_keep_only_letters_and_digits():
    assert client_id("BTCUSDT-1789248000000_x1") == "BTCUSDT1789248000000x1"
    assert len(client_id("a" * 64)) == 32


def test_filters_are_in_coins_not_contracts():
    session = FakeSession({})
    filters = run(client(session).symbol_filters("BTCUSDT"))
    # Лот 0.01 контракта по 0.01 BTC - шаг 0.0001 BTC.
    assert filters["step"] == pytest.approx(0.0001)
    assert filters["min_qty"] == pytest.approx(0.0001)
    assert filters["tick"] == pytest.approx(0.1)
    assert filters["max_leverage"] == 100
    assert filters["taker_fee"] == pytest.approx(0.0005)


# ── ответы в полях WEEX ──────────────────────────────────────────────────────


def test_position_is_translated_to_coins_and_weex_fields():
    session = FakeSession(
        {
            "/api/v5/account/positions": {
                "code": "0",
                "data": [
                    {"instId": "BTC-USDT-SWAP", "posSide": "long", "pos": "250", "avgPx": "80000",
                     "markPx": "80500", "upl": "12.5", "lever": "20", "bePx": "80064"},
                    {"instId": "BTC-USDT-SWAP", "posSide": "short", "pos": "0", "avgPx": ""},
                ],
            }
        }
    )
    rows = run(client(session).positions())
    assert len(rows) == 1
    row = rows[0]
    from backend.trading.watcher import average_entry, exchange_breakeven, position_for, position_size

    # 250 контрактов по 0.01 BTC - 2.5 BTC.
    assert position_size(row) == pytest.approx(2.5)
    assert position_for(rows, "BTCUSDT", "long") is row
    assert position_for(rows, "BTCUSDT", "short") is None
    assert average_entry(row) == pytest.approx(80000)
    # Безубыток - тот, что показывает биржа.
    assert exchange_breakeven(row, side="long") == pytest.approx(80064)


def test_net_mode_position_side_comes_from_the_sign():
    session = FakeSession(
        {"/api/v5/account/positions": {"code": "0", "data": [{"instId": "BTC-USDT-SWAP", "posSide": "net", "pos": "-30", "avgPx": "80000"}]}}
    )
    row = run(client(session).positions())[0]
    assert row["positionSide"] == "SHORT"
    assert float(row["size"]) == pytest.approx(0.3)


def test_balance_reads_like_weex():
    session = FakeSession(
        {"/api/v5/account/balance": {"code": "0", "data": [{"details": [{"ccy": "USDT", "availEq": "1234.5", "eq": "1300"}]}]}}
    )
    from backend.trading.funds import usdt_from

    assert usdt_from(run(client(session).balance())) == pytest.approx(1234.5)


def test_fills_are_in_coins_with_fee_as_a_positive_amount():
    session = FakeSession(
        {
            "/api/v5/trade/fills": {
                "code": "0",
                "data": [
                    {"instId": "BTC-USDT-SWAP", "side": "sell", "posSide": "long", "fillPx": "81000",
                     "fillSz": "100", "fee": "-4.05", "fillPnl": "1000", "ts": "1789248000000",
                     "ordId": "777", "clOrdId": "abc", "billId": "9"},
                ],
            }
        }
    )
    fills = run(client(session).user_trades("BTCUSDT", limit=100))
    assert fills == [
        {
            "symbol": "BTCUSDT", "orderId": "777", "clientOrderId": "abc", "side": "SELL",
            "positionSide": "LONG", "price": "81000", "qty": "1", "commission": "4.05",
            "realizedPnl": "1000", "time": 1789248000000,
        }
    ]
    from backend.trading.watcher import settle

    gross, fee, exit_price = settle(fills, 80000, "long")
    assert gross == pytest.approx(1000)
    assert fee == pytest.approx(4.05)
    assert exit_price == pytest.approx(81000)


def test_fills_page_back_until_the_limit():
    pages = [
        {"code": "0", "data": [{"instId": "BTC-USDT-SWAP", "fillSz": "1", "fillPx": "1", "fee": "0", "ts": "1", "billId": str(i)} for i in range(100)]},
        {"code": "0", "data": [{"instId": "BTC-USDT-SWAP", "fillSz": "1", "fillPx": "1", "fee": "0", "ts": "1", "billId": "x"}]},
    ]
    session = FakeSession({"/api/v5/trade/fills": lambda call: pages.pop(0)})
    fills = run(client(session).user_trades(limit=500))
    assert len(fills) == 101
    second = [s for s in session.sent if s["path"] == "/api/v5/trade/fills"][1]
    assert second["query"]["after"] == ["99"]


def test_algo_orders_read_like_weex_plans():
    session = FakeSession(
        {
            "/api/v5/trade/orders-algo-pending": {
                "code": "0",
                "data": [
                    {"algoId": "5001", "algoClOrdId": "s0abcd1234", "instId": "BTC-USDT-SWAP", "side": "sell",
                     "posSide": "long", "sz": "250", "slTriggerPx": "79000", "tpTriggerPx": ""},
                    {"algoId": "5002", "algoClOrdId": "t1abcd1234", "instId": "BTC-USDT-SWAP", "side": "sell",
                     "posSide": "long", "sz": "75", "slTriggerPx": "", "tpTriggerPx": "82000"},
                ],
            }
        }
    )
    plans = run(client(session).algo_orders("BTCUSDT"))
    assert [p["planType"] for p in plans] == ["STOP_LOSS", "TAKE_PROFIT"]
    assert plans[0]["quantity"] == "2.5"
    assert plans[1]["triggerPrice"] == "82000"
    query = sent_to(session, "/api/v5/trade/orders-algo-pending")["query"]
    assert query["ordType"] == ["conditional,oco"]
    assert query["instId"] == ["BTC-USDT-SWAP"]

    from backend.trading.watcher import order_marks

    assert "t1abcd1234" in order_marks(plans[1])


def test_open_orders_read_like_weex():
    session = FakeSession(
        {"/api/v5/trade/orders-pending": {"code": "0", "data": [
            {"ordId": "42", "clOrdId": "BTCUSDT1789", "instId": "BTC-USDT-SWAP", "side": "buy",
             "posSide": "long", "sz": "10", "accFillSz": "4", "px": "79000", "ordType": "limit", "state": "live"}
        ]}}
    )
    order = run(client(session).open_orders("BTCUSDT"))[0]
    assert order["orderId"] == "42"
    assert order["clientOrderId"] == "BTCUSDT1789"
    assert float(order["origQty"]) == pytest.approx(0.1)
    assert float(order["executedQty"]) == pytest.approx(0.04)


# ── заявки ───────────────────────────────────────────────────────────────────


def test_entry_goes_in_contracts_with_the_stop_attached_and_broker_tag():
    session = FakeSession({"/api/v5/trade/order": {"code": "0", "data": [{"ordId": "91", "clOrdId": "BTCUSDT1", "sCode": "0"}]}})
    placed = run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.123456",
            order_type="LIMIT", price="79000", sl_trigger="78000", client_order_id="BTCUSDT-1",
        )
    )
    body = sent_to(session, "/api/v5/trade/order")["body"]
    # 0.123456 BTC - 12.3456 контракта, вниз до лота 0.01: 12.34.
    assert body["sz"] == "12.34"
    assert body["posSide"] == "long"
    assert body["tdMode"] == "cross"
    assert body["ordType"] == "limit" and body["px"] == "79000"
    assert body["clOrdId"] == "BTCUSDT1"
    assert body["tag"] == "NMNH"
    assert body["attachAlgoOrds"] == [{"slTriggerPx": "78000", "slOrdPx": "-1", "slTriggerPxType": "mark"}]
    assert "reduceOnly" not in body
    assert placed["orderId"] == "91"


def test_closing_in_net_mode_is_reduce_only():
    session = FakeSession({"/api/v5/trade/order": {"code": "0", "data": [{"ordId": "92", "sCode": "0"}]}}, mode="net_mode")
    run(client(session).place_order(symbol="BTCUSDT", side="SELL", position_side="LONG", quantity="1"))
    body = sent_to(session, "/api/v5/trade/order")["body"]
    assert body["reduceOnly"] is True
    assert "posSide" not in body
    assert body["sz"] == "100"


def test_too_small_order_is_refused_before_the_exchange():
    session = FakeSession({})
    with pytest.raises(WeexTradeError):
        run(client(session).place_order(symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.00001"))
    assert not any(s["path"] == "/api/v5/trade/order" for s in session.sent)


def test_stop_is_a_conditional_order_found_by_its_label():
    session = FakeSession({"/api/v5/trade/order-algo": {"code": "0", "data": [{"algoId": "7001", "algoClOrdId": "s1abcd1234", "sCode": "0"}]}})
    placed = run(
        client(session).place_tp_sl(
            symbol="BTCUSDT", plan_type="STOP_LOSS", trigger_price="79500", quantity="2.5",
            position_side="LONG", client_algo_id="s1abcd1234",
        )
    )
    body = sent_to(session, "/api/v5/trade/order-algo")["body"]
    assert body["ordType"] == "conditional"
    assert body["side"] == "sell" and body["posSide"] == "long"
    assert body["sz"] == "250"
    assert body["slTriggerPx"] == "79500" and body["slOrdPx"] == "-1" and body["slTriggerPxType"] == "mark"
    assert body["algoClOrdId"] == "s1abcd1234"
    # Закрылась позиция - биржа снимает защиту сама.
    assert body["cxlOnClosePos"] is True
    assert plan_order_id(placed) == "7001"


def test_take_profit_of_a_short_buys_back():
    session = FakeSession({"/api/v5/trade/order-algo": {"code": "0", "data": [{"algoId": "7002", "sCode": "0"}]}}, mode="net_mode")
    run(client(session).place_tp_sl(symbol="BTCUSDT", plan_type="TAKE_PROFIT", trigger_price="70000", quantity="0.5", position_side="SHORT"))
    body = sent_to(session, "/api/v5/trade/order-algo")["body"]
    assert body["side"] == "buy"
    assert body["reduceOnly"] is True
    assert body["tpTriggerPx"] == "70000" and body["tpOrdPx"] == "-1"


def test_cancel_algo_by_exchange_id_or_by_our_label():
    session = FakeSession({})
    run(client(session).cancel_algo_order("BTCUSDT", "7001"))
    assert sent_to(session, "/api/v5/trade/cancel-algos")["body"] == [{"instId": "BTC-USDT-SWAP", "algoId": "7001"}]
    run(client(session).cancel_algo_order("BTCUSDT", "t1abcd1234"))
    assert sent_to(session, "/api/v5/trade/cancel-algos")["body"] == [{"instId": "BTC-USDT-SWAP", "algoClOrdId": "t1abcd1234"}]


# ── отказы ───────────────────────────────────────────────────────────────────


def test_refusal_names_the_reason_from_the_order_row():
    session = FakeSession({"/api/v5/trade/order": {"code": "1", "msg": "All operations failed", "data": [{"sCode": "51008", "sMsg": "Insufficient margin"}]}})
    with pytest.raises(WeexTradeError) as caught:
        run(client(session).place_order(symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"))
    assert str(caught.value) == "Insufficient margin"
    assert caught.value.code == "51008"
    assert caught.value.retryable is False


def test_rate_limit_is_retryable():
    session = FakeSession({"/api/v5/account/positions": {"code": "50011", "msg": "Too Many Requests", "data": []}})
    with pytest.raises(WeexTradeError) as caught:
        run(client(session).positions())
    assert caught.value.retryable is True
