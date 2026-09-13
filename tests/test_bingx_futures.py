"""Клиент BingX: подпись, справочник, заявки и перевод ответов в поля WEEX.

Сети нет: сессия подменена и отвечает тем, что BingX присылает на самом деле,
по полям из документации (docs/integrations/bingx-api.md). Проверяем то, на чём
здесь легко потерять деньги ученика: точности вместо шагов, два минимума,
защиту строкой с JSON внутри, сторону позиции в одностороннем режиме и метку
брокера, которая идёт заголовком и потому забывается в одном месте разом.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest

from core.bingx import futures as bingx
from core.bingx import market as bingx_market
from core.bingx.futures import (
    BingxFutures,
    client_id,
    fill_time,
    sign,
    symbol_id,
    symbol_of,
)
from core.weex.futures import Credentials, WeexTradeError, plan_order_id

BTC = {
    "symbol": "BTC-USDT",
    "quantityPrecision": 4,
    "pricePrecision": 1,
    "tradeMinQuantity": 0.0001,
    "tradeMinUSDT": 2,
    "takerFeeRate": 0.0005,
    "makerFeeRate": 0.0002,
    "maxLeverage": 125,
    "status": 1,
    "apiStateOpen": "true",
    "apiStateClose": "true",
    "brokerState": False,
}


class _Response:
    def __init__(self, payload, status=200, headers=None):
        self._text = json.dumps(payload)
        self.status = status
        self.headers = headers or {}

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Отвечает по пути; запоминает, что ушло."""

    def __init__(self, routes: dict[str, object], hedge: bool = True, headers=None):
        self.routes = {
            "/openApi/swap/v2/quote/contracts": {"code": 0, "data": [BTC]},
            "/openApi/swap/v1/positionSide/dual": {
                "code": 0,
                "data": {"dualSidePosition": "true" if hedge else "false"},
            },
            "/openApi/swap/v2/user/commissionRate": {
                "code": 0,
                "data": {"takerCommissionRate": 0.0005, "makerCommissionRate": 0.0002},
            },
            "/openApi/swap/v2/quote/ticker": {"code": 0, "data": {"lastPrice": "80000"}},
            **routes,
        }
        self.headers = headers or {}
        self.sent: list[dict] = []

    def request(self, method, url, data=None, headers=None, timeout=None, params=None):
        # Адрес приходит объектом библиотеки: подпись считается по строке
        # запроса, и она обязана дойти до биржи ровно такой (`signed_url`).
        parsed = urlparse(str(url))
        query = parse_qs(parsed.query)
        self.sent.append(
            {
                "method": method,
                "path": parsed.path,
                "raw_query": parsed.query,
                "query": {k: v[0] for k, v in query.items()},
                "headers": headers or {},
            }
        )
        payload = self.routes.get(parsed.path, {"code": 0, "data": []})
        if callable(payload):
            payload = payload(self.sent[-1])
        return _Response(payload, headers=self.headers)

    def get(self, url, params=None, timeout=None):
        return self.request("GET", url, params=params, timeout=timeout)


@pytest.fixture(autouse=True)
def _fresh_caches():
    # Справочник, режим счёта и отметка о проверенной метке брокера живут в
    # памяти процесса: между тестами их надо забывать.
    bingx_market._INSTRUMENTS.clear()
    bingx_market._MODES.clear()
    bingx_market._SOURCE_SEEN.clear()
    bingx_market._INSTRUMENTS_AT = 0.0
    yield


def client(session: FakeSession, **kw) -> BingxFutures:
    async def factory():
        return session

    return BingxFutures(
        Credentials("key", "secret", ""),
        factory,
        broker_key=kw.pop("broker", ""),
        demo=kw.pop("demo", False),
    )


def run(coro):
    return asyncio.run(coro)


def sent_to(session: FakeSession, path: str) -> dict:
    return next(s for s in reversed(session.sent) if s["path"] == path)


# ── основа ───────────────────────────────────────────────────────────────────


def test_signature_is_hmac_of_the_query_string():
    expected = hmac.new(b"secret", b"symbol=BTC-USDT&timestamp=1", hashlib.sha256).hexdigest()
    assert sign("secret", "symbol=BTC-USDT&timestamp=1") == expected


def test_the_address_keeps_the_query_exactly_as_signed():
    """Перекодирование строки запроса - это другая подпись, то есть отказ.

    Библиотека адресов по умолчанию возвращает `%3A` двоеточием, и заявка с
    приложенной защитой (JSON внутри параметра) не прошла бы ни разу.
    """
    from core.bingx.market import signed_url

    query = "stopLoss=%7B%22type%22%3A%22STOP_MARKET%22%7D&timestamp=1"
    assert str(signed_url("https://x", "/o", query)) == f"https://x/o?{query}"


def test_request_is_signed_and_carries_the_key():
    session = FakeSession({"/openApi/swap/v2/user/positions": {"code": 0, "data": []}})
    run(client(session).positions())
    call = sent_to(session, "/openApi/swap/v2/user/positions")
    query = call["raw_query"]
    body, _, signature = query.rpartition("&signature=")
    # Подписывается ровно та строка, что ушла в адресе.
    assert signature == sign("secret", body)
    assert call["headers"]["X-BX-APIKEY"] == "key"
    # Метки брокера нет - значит и заголовка нет вовсе.
    assert "X-SOURCE-KEY" not in call["headers"]


def test_request_carries_the_window_and_corrected_time():
    """Метка времени идёт с поправкой на часы биржи, и с окном годности.

    Часы машины расходятся с биржей сами по себе: на живом счёте поймано 4.6
    секунды при пятисекундном окне - запросы проходили через раз.
    """
    session = FakeSession({"/openApi/swap/v2/user/positions": {"code": 0, "data": []}})
    bingx_market._SKEW_MS = 4600.0
    try:
        before = int(time.time() * 1000)
        run(client(session).positions())
    finally:
        bingx_market._SKEW_MS = 0.0

    query = sent_to(session, "/openApi/swap/v2/user/positions")["query"]
    assert query["recvWindow"] == str(bingx.RECV_WINDOW)
    # Время ушло вперёд на поправку, а не осталось местным.
    assert int(query["timestamp"]) - before >= 4000


def test_refusal_by_timestamp_is_retried_with_a_fresh_clock():
    """Отказ по времени лечится сверкой часов и повтором - один раз.

    Заявка при таком отказе на биржу не попала, значит повтор ничего не
    задваивает; а вторая попытка уже со сверенными часами.
    """
    answers = [
        {"code": 100421, "msg": "timestamp is invalid"},
        {"code": 0, "data": []},
    ]
    session = FakeSession(
        {
            "/openApi/swap/v2/user/positions": lambda call: answers.pop(0),
            "/openApi/swap/v2/server/time": {
                "code": 0,
                "data": {"serverTime": int(time.time() * 1000) + 4600},
            },
        }
    )
    bingx_market._SKEW_AT = 0.0
    try:
        assert run(client(session).positions()) == []
    finally:
        bingx_market._SKEW_MS = 0.0
        bingx_market._SKEW_AT = 0.0

    paths = [s["path"] for s in session.sent]
    assert paths.count("/openApi/swap/v2/user/positions") == 2
    assert "/openApi/swap/v2/server/time" in paths


def test_demo_account_is_kept_in_vst():
    """На демо-контуре биржа ведёт счёт в VST: строки с USDT там нет вовсе."""
    session = FakeSession(
        {
            "/openApi/swap/v3/user/balance": {
                "code": 0,
                "data": [
                    {
                        "asset": "VST",
                        "balance": "99601.7448",
                        "equity": "99601.7448",
                        "availableMargin": "99601.7448",
                    }
                ],
            }
        }
    )
    rows = run(client(session, demo=True).balance())
    assert rows == [
        {"marginCoin": "VST", "availableBalance": "99601.7448", "equity": "99601.7448"}
    ]

    from backend.trading.funds import usdt_from

    # Для остального кода это те же деньги счёта: учебные, но свои.
    assert float(usdt_from(rows)) == pytest.approx(99601.7448)


def test_demo_contour_lives_on_its_own_address():
    session = FakeSession({"/openApi/swap/v2/user/positions": {"code": 0, "data": []}})
    assert client(session, demo=True).base_url == bingx.DEMO_URL
    assert client(session).base_url == bingx.BASE_URL


def test_instrument_names_go_both_ways():
    assert symbol_id("btcusdt") == "BTC-USDT"
    assert symbol_id("BTC-USDT") == "BTC-USDT"
    assert symbol_of("PEPE-USDT") == "PEPEUSDT"


def test_client_ids_are_lowercased_for_the_exchange():
    """Биржа переводит идентификатор в нижний регистр - делаем это сами."""
    assert client_id("BTCUSDT-1789248000000_x1") == "btcusdt-1789248000000_x1"
    assert len(client_id("A" * 64)) == 40

    from backend.trading.watcher import client_matches

    # И сверка сходится: иначе сделка осталась бы без сопровождения.
    assert client_matches(client_id("BTCUSDT-1789248000000"), "BTCUSDT-1789248000000")


def test_precision_becomes_step_and_tick():
    session = FakeSession({})
    filters = run(client(session).symbol_filters("BTCUSDT"))
    assert filters["step"] == pytest.approx(0.0001)   # quantityPrecision 4
    assert filters["tick"] == pytest.approx(0.1)      # pricePrecision 1
    assert filters["min_qty"] == pytest.approx(0.0001)
    assert filters["min_notional"] == pytest.approx(2)
    assert filters["max_leverage"] == 125
    assert filters["taker_fee"] == pytest.approx(0.0005)


def test_unlisted_or_stopped_pairs_are_not_in_the_book():
    """Пара вне торгов в справочник не попадает: отказ биржи ученику непонятен."""
    rows = [
        {**BTC, "symbol": "AAA-USDT", "status": 25},
        {**BTC, "symbol": "BBB-USD"},
        BTC,
    ]
    session = FakeSession({"/openApi/swap/v2/quote/contracts": {"code": 0, "data": rows}})
    specs = run(bingx.load_instruments(session))
    assert list(specs) == ["BTC-USDT"]


# ── ответы в полях WEEX ──────────────────────────────────────────────────────


def test_position_reads_like_weex():
    session = FakeSession(
        {
            "/openApi/swap/v2/user/positions": {
                "code": 0,
                "data": [
                    {
                        "symbol": "BTC-USDT",
                        "positionId": "12345",
                        "positionSide": "LONG",
                        "positionAmt": "2.5",
                        "avgPrice": "80000",
                        "markPrice": "80500",
                        "unrealizedProfit": "12.5",
                        "leverage": 20,
                        "liquidationPrice": "70000",
                    },
                    {"symbol": "BTC-USDT", "positionSide": "SHORT", "positionAmt": "0"},
                ],
            }
        }
    )
    rows = run(client(session).positions())
    assert len(rows) == 1
    row = rows[0]

    from backend.trading.watcher import average_entry, position_for, position_size

    assert position_size(row) == pytest.approx(2.5)
    assert position_for(rows, "BTCUSDT", "long") is row
    assert position_for(rows, "BTCUSDT", "short") is None
    assert average_entry(row) == pytest.approx(80000)
    assert row["positionId"] == "12345"


def test_net_mode_position_side_comes_from_the_sign():
    session = FakeSession(
        {
            "/openApi/swap/v2/user/positions": {
                "code": 0,
                "data": [
                    {"symbol": "BTC-USDT", "positionSide": "BOTH", "positionAmt": "-0.3", "avgPrice": "80000"}
                ],
            }
        },
        hedge=False,
    )
    row = run(client(session).positions())[0]
    assert row["positionSide"] == "SHORT"
    assert float(row["size"]) == pytest.approx(0.3)


def test_balance_reads_like_weex():
    session = FakeSession(
        {
            "/openApi/swap/v3/user/balance": {
                "code": 0,
                "data": [
                    {"asset": "USDT", "balance": "1300", "equity": "1300", "availableMargin": "1234.5"},
                    {"asset": "VST", "balance": "100000", "availableMargin": "100000"},
                ],
            }
        }
    )
    from backend.trading.funds import usdt_from

    assert usdt_from(run(client(session).balance())) == pytest.approx(1234.5)


def test_orders_are_split_into_plain_and_conditional():
    """Своей ручки для условных заявок нет: делим один список биржи надвое."""
    pending = {
        "code": 0,
        "data": {
            "orders": [
                {
                    "orderId": 42,
                    "clientOrderId": "btcusdt-1789",
                    "symbol": "BTC-USDT",
                    "side": "BUY",
                    "positionSide": "LONG",
                    "type": "LIMIT",
                    "price": "79000",
                    "origQty": "0.1",
                    "executedQty": "0.04",
                    "status": "PARTIALLY_FILLED",
                },
                {
                    "orderId": 7001,
                    "symbol": "BTC-USDT",
                    "side": "SELL",
                    "positionSide": "LONG",
                    "type": "STOP_MARKET",
                    "stopPrice": "79000",
                    "origQty": "0.1",
                    "status": "NEW",
                },
                {
                    "orderId": 7002,
                    "symbol": "BTC-USDT",
                    "side": "SELL",
                    "positionSide": "LONG",
                    "type": "TAKE_PROFIT_MARKET",
                    "stopPrice": "82000",
                    "origQty": "0.03",
                    "status": "NEW",
                },
            ]
        },
    }
    session = FakeSession({"/openApi/swap/v2/trade/openOrders": pending})
    only = client(session)

    orders = run(only.open_orders("BTCUSDT"))
    assert [o["orderId"] for o in orders] == ["42"]
    assert orders[0]["clientOrderId"] == "btcusdt-1789"
    assert float(orders[0]["executedQty"]) == pytest.approx(0.04)

    plans = run(only.algo_orders("BTCUSDT"))
    assert [p["planType"] for p in plans] == ["STOP_LOSS", "TAKE_PROFIT"]
    assert plans[0]["triggerPrice"] == "79000"
    assert plans[1]["quantity"] == "0.03"

    from backend.trading.watcher import order_marks

    # Метки у условной заявки нет - опознаётся она номером.
    assert order_marks(plans[0]) == {"7001"}


def test_fills_are_in_coins_with_fee_as_a_positive_amount():
    session = FakeSession(
        {
            "/openApi/swap/v2/trade/allFillOrders": {
                "code": 0,
                "data": {
                    "fill_orders": [
                        {
                            "symbol": "BTC-USDT",
                            "orderId": "777",
                            "clientOrderID": "BTCUSDT-1789",
                            "side": "SELL",
                            "positionSide": "LONG",
                            "price": "81000",
                            "volume": "1",
                            "commission": "-4.05",
                            "profit": "1000",
                            "filledTm": "1789248000000",
                        }
                    ]
                },
            }
        }
    )
    fills = run(client(session).user_trades("BTCUSDT", limit=100))
    assert fills == [
        {
            "symbol": "BTCUSDT", "orderId": "777", "clientOrderId": "btcusdt-1789", "side": "SELL",
            "positionSide": "LONG", "price": "81000", "qty": "1", "commission": "4.05",
            "realizedPnl": "1000", "time": 1789248000000,
        }
    ]

    from backend.trading.watcher import settle

    gross, fee, exit_price = settle(fills, 80000, "long")
    assert gross == pytest.approx(1000)
    assert fee == pytest.approx(4.05)
    assert exit_price == pytest.approx(81000)

    # Окно обязательно: без него биржа не отвечает вовсе.
    query = sent_to(session, "/openApi/swap/v2/trade/allFillOrders")["query"]
    assert query["tradingUnit"] == "COIN"
    assert int(query["endTs"]) - int(query["startTs"]) == bingx.FILLS_WINDOW_MS


def test_fill_time_reads_both_shapes():
    """Биржа называет время то числом, то строкой с поясом."""
    assert fill_time({"filledTm": 1789248000000}) == 1789248000000
    assert fill_time({"filledTm": "2026-09-13T05:37:24.000+00:00"}) == 1789277844000
    assert fill_time({}) == 0


# ── заявки ───────────────────────────────────────────────────────────────────


def _order_route(order_id: str = "91"):
    return {"code": 0, "data": {"order": {"orderId": order_id, "clientOrderID": "btcusdt-1"}}}


def test_entry_goes_in_coins_with_protection_attached_and_broker_header():
    session = FakeSession(
        {"/openApi/swap/v2/trade/order": _order_route()},
        headers={"X-SOURCE-KEY": "NMNH"},
    )
    placed = run(
        client(session, broker="NMNH").place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.12345678",
            order_type="LIMIT",
            price="79000",
            sl_trigger="78000",
            tp_trigger="82000",
            client_order_id="BTCUSDT-1",
        )
    )
    call = sent_to(session, "/openApi/swap/v2/trade/order")
    query = call["query"]
    # Объём в монетах, вниз до шага 0.0001 - больше риска, чем просили, нельзя.
    assert query["quantity"] == "0.1234"
    assert query["type"] == "LIMIT" and query["price"] == "79000"
    assert query["positionSide"] == "LONG"
    assert query["timeInForce"] == "GTC"
    assert query["clientOrderID"] == "btcusdt-1"
    # Защита - строкой с JSON внутри, исполнение по рынку по цене маркировки.
    assert json.loads(query["stopLoss"]) == {
        "type": "STOP_MARKET", "stopPrice": 78000.0, "workingType": "MARK_PRICE"
    }
    assert json.loads(query["takeProfit"])["type"] == "TAKE_PROFIT_MARKET"
    # Метка брокера - заголовком, одним на весь запрос.
    assert call["headers"]["X-SOURCE-KEY"] == "NMNH"
    assert placed["orderId"] == "91"


def test_closing_in_net_mode_is_reduce_only():
    session = FakeSession({"/openApi/swap/v2/trade/order": _order_route("92")}, hedge=False)
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="SELL", position_side="LONG", quantity="1"
        )
    )
    query = sent_to(session, "/openApi/swap/v2/trade/order")["query"]
    # В одностороннем режиме продажа сверх лонга разворачивает позицию, а не
    # закрывает её: закрытие обязано быть сокращающим.
    assert query["positionSide"] == "BOTH"
    assert query["reduceOnly"] == "true"


def test_order_below_the_coin_minimum_is_refused_before_the_exchange():
    session = FakeSession({})
    with pytest.raises(WeexTradeError, match="меньше минимального"):
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.00001"
            )
        )
    assert not any(s["path"] == "/openApi/swap/v2/trade/order" for s in session.sent)


def test_order_below_the_money_minimum_is_refused_too():
    """Второй минимум BingX - в деньгах, и отказ по нему ученику непонятен."""
    session = FakeSession({})
    with pytest.raises(WeexTradeError, match="USDT"):
        run(
            client(session).place_order(
                symbol="BTCUSDT",
                side="BUY",
                position_side="LONG",
                quantity="0.0001",  # 0.0001 BTC по 80000 - это 8 USDT... минимум 2
                order_type="LIMIT",
                price="10000",      # ...а по 10000 - только одна монета
            )
        )


def test_closing_a_tail_below_the_minimum_still_goes_through():
    """Минимумы - правило входа. Хвост позиции закрыть надо в любом случае."""
    session = FakeSession({"/openApi/swap/v2/trade/order": _order_route("93")}, hedge=False)
    run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="SELL",
            position_side="LONG",
            quantity="0.0001",   # по 80000 это 8 USDT... но цена входа могла уйти
            order_type="LIMIT",
            price="10000",       # ...а тут всего одна монета при минимуме в две
        )
    )
    query = sent_to(session, "/openApi/swap/v2/trade/order")["query"]
    assert query["reduceOnly"] == "true"


def test_pair_closed_for_brokers_is_refused_with_words():
    rows = [{**BTC, "brokerState": True}]
    session = FakeSession({"/openApi/swap/v2/quote/contracts": {"code": 0, "data": rows}})
    with pytest.raises(WeexTradeError, match="брокерских"):
        run(
            client(session, broker="NMNH").place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
            )
        )


def test_pair_closed_for_brokers_does_not_block_a_plain_account():
    """Запрет касается брокерских счетов: без метки мы обычный партнёр."""
    rows = [{**BTC, "brokerState": True}]
    session = FakeSession(
        {
            "/openApi/swap/v2/quote/contracts": {"code": 0, "data": rows},
            "/openApi/swap/v2/trade/order": _order_route(),
        }
    )
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
        )
    )
    assert sent_to(session, "/openApi/swap/v2/trade/order")


def test_api_closed_for_opening_is_refused():
    rows = [{**BTC, "apiStateOpen": "false"}]
    session = FakeSession({"/openApi/swap/v2/quote/contracts": {"code": 0, "data": rows}})
    with pytest.raises(WeexTradeError, match="Открытие"):
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
            )
        )


def test_the_same_order_twice_in_a_second_is_stopped_before_the_exchange():
    """Правило BingX, которого нет у других: за дубль наказывает биржа."""
    session = FakeSession({"/openApi/swap/v2/trade/order": _order_route()})
    only = client(session)

    async def twice():
        await only.place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
        )
        await only.place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
        )

    with pytest.raises(WeexTradeError, match="дважды за секунду"):
        run(twice())
    assert len([s for s in session.sent if s["path"] == "/openApi/swap/v2/trade/order"]) == 1


def test_stop_is_a_plain_order_of_a_conditional_type():
    session = FakeSession({"/openApi/swap/v2/trade/order": _order_route("7001")})
    placed = run(
        client(session).place_tp_sl(
            symbol="BTCUSDT",
            plan_type="STOP_LOSS",
            trigger_price="79500",
            quantity="2.5",
            position_side="LONG",
            client_algo_id="s1abcd1234",
        )
    )
    query = sent_to(session, "/openApi/swap/v2/trade/order")["query"]
    assert query["type"] == "STOP_MARKET"
    assert query["side"] == "SELL" and query["positionSide"] == "LONG"
    assert query["stopPrice"] == "79500" and query["quantity"] == "2.5"
    assert query["workingType"] == "MARK_PRICE"
    # Метку условная заявка не принимает - в запрос она не уходит вовсе.
    assert "clientOrderID" not in query
    # Номер - единственное, чем эту заявку потом можно найти.
    assert plan_order_id(placed) == "7001"
    assert placed["algoId"] == "7001"


def test_take_profit_of_a_short_buys_back_and_reduces():
    session = FakeSession({"/openApi/swap/v2/trade/order": _order_route("7002")}, hedge=False)
    run(
        client(session).place_tp_sl(
            symbol="BTCUSDT",
            plan_type="TAKE_PROFIT",
            trigger_price="70000",
            quantity="0.5",
            position_side="SHORT",
        )
    )
    query = sent_to(session, "/openApi/swap/v2/trade/order")["query"]
    assert query["side"] == "BUY"
    assert query["type"] == "TAKE_PROFIT_MARKET"
    assert query["reduceOnly"] == "true"


def test_moving_a_stop_places_the_new_one_before_dropping_the_old():
    """Сначала новая заявка, потом снятие старой: иначе позиция без защиты."""
    pending = {
        "code": 0,
        "data": {
            "orders": [
                {
                    "orderId": 7001,
                    "symbol": "BTC-USDT",
                    "side": "SELL",
                    "positionSide": "LONG",
                    "type": "STOP_MARKET",
                    "stopPrice": "79000",
                    "origQty": "0.1",
                }
            ]
        },
    }
    session = FakeSession(
        {
            "/openApi/swap/v2/trade/openOrders": pending,
            "/openApi/swap/v2/trade/order": _order_route("7005"),
        }
    )
    run(client(session).modify_tp_sl(symbol="BTCUSDT", order_id="7001", trigger_price="80100"))

    order_calls = [s for s in session.sent if s["path"] == "/openApi/swap/v2/trade/order"]
    assert [c["method"] for c in order_calls] == ["POST", "DELETE"]
    assert order_calls[0]["query"]["stopPrice"] == "80100"
    assert order_calls[0]["query"]["quantity"] == "0.1"
    assert order_calls[1]["query"]["orderId"] == "7001"


def test_cancel_all_algo_does_not_touch_the_entry_order():
    """Снимаем условные по одной: ручка «снять всё» убрала бы и лимитку входа."""
    pending = {
        "code": 0,
        "data": {
            "orders": [
                {"orderId": 42, "symbol": "BTC-USDT", "side": "BUY", "type": "LIMIT", "origQty": "1"},
                {"orderId": 7001, "symbol": "BTC-USDT", "side": "SELL", "type": "STOP_MARKET", "origQty": "1"},
            ]
        },
    }
    session = FakeSession(
        {"/openApi/swap/v2/trade/openOrders": pending, "/openApi/swap/v2/trade/order": {"code": 0, "data": {}}}
    )
    removed = run(client(session).cancel_all_algo("BTCUSDT"))
    assert removed == 1
    dropped = [s for s in session.sent if s["method"] == "DELETE"]
    assert [d["query"]["orderId"] for d in dropped] == ["7001"]


def test_leverage_is_set_for_both_sides_in_hedge_mode():
    session = FakeSession({"/openApi/swap/v2/trade/leverage": {"code": 0, "data": {}}})
    run(client(session).set_leverage("BTCUSDT", 20))
    calls = [s for s in session.sent if s["path"] == "/openApi/swap/v2/trade/leverage"]
    assert [c["query"]["side"] for c in calls] == ["LONG", "SHORT"]
    assert calls[0]["query"]["leverage"] == "20"


def test_account_uid_comes_from_the_exchange():
    session = FakeSession({"/openApi/account/v1/uid": {"code": 0, "data": {"uid": "9100443713"}}})
    assert run(client(session).account_uid()) == "9100443713"


# ── отказы ───────────────────────────────────────────────────────────────────


def test_refusal_names_the_reason():
    session = FakeSession(
        {"/openApi/swap/v2/trade/order": {"code": 101209, "msg": "position limit exceeded"}}
    )
    with pytest.raises(WeexTradeError) as caught:
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
            )
        )
    assert str(caught.value) == "position limit exceeded"
    assert caught.value.code == "101209"
    assert caught.value.retryable is False


def test_unknown_position_mode_stops_the_order():
    """Режим позиций не угадывается: не спросили - заявка не уходит.

    В двустороннем режиме сторона позиции обязательна, в одностороннем -
    запрещена вместе с reduceOnly. Угадав неверно, мы поставили бы заявку не в
    ту сторону.
    """
    session = FakeSession(
        {"/openApi/swap/v1/positionSide/dual": {"code": 100400, "msg": "service busy"}}
    )
    with pytest.raises(WeexTradeError):
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="1"
            )
        )
    assert not any(s["path"] == "/openApi/swap/v2/trade/order" for s in session.sent)


def test_rate_limit_is_retryable():
    session = FakeSession(
        {"/openApi/swap/v2/user/positions": {"code": 100410, "msg": "rate limited"}}
    )
    with pytest.raises(WeexTradeError) as caught:
        run(client(session).positions())
    assert caught.value.retryable is True
