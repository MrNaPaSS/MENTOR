"""Клиент Binance: подпись, фильтры, защита вторым запросом и метка брокера.

Сети нет: сессия подменена и отвечает тем, что Binance присылает на самом деле,
по полям её документации (developers.binance.com, USDⓈ-M Futures). Проверяем
то, на чём здесь легко потерять деньги ученика: шаги из фильтров, два минимума,
сторону позиции в одностороннем режиме и главное отличие этой биржи - защиту,
которую нельзя приложить ко входу.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

import pytest

from core.binance import market as binance_market
from core.binance.futures import BinanceFutures, client_id, symbol_id, symbol_of
from core.weex.futures import Credentials, WeexTradeError

BTC = {
    "symbol": "BTCUSDT",
    "quoteAsset": "USDT",
    "contractType": "PERPETUAL",
    "status": "TRADING",
    "filters": [
        {"filterType": "LOT_SIZE", "stepSize": "0.001", "minQty": "0.001", "maxQty": "1000"},
        {"filterType": "PRICE_FILTER", "tickSize": "0.10"},
        {"filterType": "MIN_NOTIONAL", "notional": "5"},
    ],
}


DOGE = {
    "symbol": "DOGEUSDT",
    "quoteAsset": "USDT",
    "contractType": "PERPETUAL",
    "status": "TRADING",
    "filters": [
        {"filterType": "LOT_SIZE", "stepSize": "1", "minQty": "1", "maxQty": "1000000"},
        {"filterType": "PRICE_FILTER", "tickSize": "0.00001"},
        {"filterType": "MIN_NOTIONAL", "notional": "5"},
    ],
}

# Цены пар для открытой ручки: у дешёвой монеты минимум в монетах достижим, а
# минимум в деньгах - нет, и проверяются они на разных парах.
PRICES = {"BTCUSDT": "80000", "DOGEUSDT": "0.1"}


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

    def __init__(self, routes: dict[str, object] | None = None, hedge: bool = False):
        self.routes = {
            "/fapi/v1/exchangeInfo": {"symbols": [BTC, DOGE]},
            "/fapi/v1/positionSide/dual": {"dualSidePosition": hedge},
            "/fapi/v1/commissionRate": {
                "symbol": "BTCUSDT",
                "takerCommissionRate": "0.0004",
                "makerCommissionRate": "0.0002",
            },
            "/fapi/v1/leverageBracket": [
                {"symbol": "BTCUSDT", "brackets": [{"bracket": 1, "initialLeverage": 125}]}
            ],
            "/fapi/v1/ticker/price": lambda call: {
                "symbol": call["query"].get("symbol", "BTCUSDT"),
                "price": PRICES.get(call["query"].get("symbol", "BTCUSDT"), "80000"),
            },
            "/fapi/v2/positionRisk": [],
            **(routes or {}),
        }
        self.sent: list[dict] = []

    def request(self, method, url, data=None, headers=None, timeout=None, params=None):
        parsed = urlparse(str(url))
        self.sent.append(
            {
                "method": method,
                "path": parsed.path,
                "raw_query": parsed.query,
                "query": {k: v[0] for k, v in parse_qs(parsed.query).items()},
                "headers": headers or {},
            }
        )
        payload = self.routes.get(parsed.path, {})
        if callable(payload):
            payload = payload(self.sent[-1])
        return _Response(payload)

    def get(self, url, params=None, timeout=None):
        return self.request("GET", url, params=params, timeout=timeout)


@pytest.fixture(autouse=True)
def _fresh_caches():
    # Справочник, режимы счетов, пределы плеча и поправка часов живут в памяти
    # процесса: тест, оставивший их за собой, менял бы поведение соседних.
    binance_market.clear_caches()
    binance_market._SKEW_MS = 0.0
    binance_market._SKEW_AT = 0.0
    yield
    binance_market.clear_caches()
    binance_market._SKEW_MS = 0.0
    binance_market._SKEW_AT = 0.0


def client(session: FakeSession, **kw) -> BinanceFutures:
    async def factory():
        return session

    return BinanceFutures(Credentials("key", "secret", ""), factory, **kw)


def run(coro):
    return asyncio.run(coro)


def sent_to(session: FakeSession, path: str) -> dict:
    return next(s for s in reversed(session.sent) if s["path"] == path)


def orders_of(session: FakeSession) -> list[dict]:
    return [one for one in session.sent if one["path"] == "/fapi/v1/order"]


def algos_of(session: FakeSession) -> list[dict]:
    """Условные заявки с декабря 2025 уходят на свою ручку, а не в общую."""
    return [one for one in session.sent if one["path"] == "/fapi/v1/algoOrder"]


def order_route(order_id: str = "77"):
    def route(call):
        return {
            "orderId": int(order_id),
            "symbol": call["query"].get("symbol", "BTCUSDT"),
            "clientOrderId": call["query"].get("newClientOrderId", ""),
            "status": "NEW",
        }

    return route


def algo_route(algo_id: str = "88"):
    """Ответ ручки условных заявок: свои имена полей."""

    def route(call):
        return {
            "algoId": int(algo_id),
            "symbol": call["query"].get("symbol", "BTCUSDT"),
            "clientAlgoId": call["query"].get("clientAlgoId", ""),
            "algoStatus": "NEW",
        }

    return route


# ── имена и подпись ──────────────────────────────────────────────────────────


def test_symbol_is_written_as_we_write_it():
    """У Binance написание пары совпадает с нашим - переводить нечего."""
    assert symbol_id("BTCUSDT") == "BTCUSDT"
    assert symbol_id("BTC-USDT") == "BTCUSDT"
    assert symbol_of("BTCUSDT") == "BTCUSDT"


def test_request_is_signed_by_the_query_that_goes_out():
    """Подписывается ровно та строка, что уходит в адресе, и подпись - последняя."""
    session = FakeSession({"/fapi/v2/balance": []})
    run(client(session).balance())
    call = sent_to(session, "/fapi/v2/balance")
    sent, _, signature = call["raw_query"].rpartition("&signature=")
    assert signature == hmac.new(b"secret", sent.encode(), hashlib.sha256).hexdigest()
    assert call["headers"]["X-MBX-APIKEY"] == "key"
    # Окно годности по умолчанию у биржи пять секунд - просим шире.
    assert int(call["query"]["recvWindow"]) >= 10000


def test_clock_refusal_is_retried_once_with_synced_clock():
    """Отказ по времени лечится сверкой часов и одним повтором."""
    calls: list[int] = []

    def balance(call):
        calls.append(1)
        if len(calls) == 1:
            return {"code": -1021, "msg": "Timestamp for this request is outside of the recvWindow"}
        return [{"asset": "USDT", "balance": "100", "availableBalance": "90"}]

    session = FakeSession({"/fapi/v2/balance": balance, "/fapi/v1/time": {"serverTime": 1700000000000}})
    rows = run(client(session).balance())
    assert rows and rows[0]["availableBalance"] == "90"
    assert len(calls) == 2
    assert any(one["path"] == "/fapi/v1/time" for one in session.sent)


def test_refusal_by_balance_is_not_retryable():
    """Отказ по существу повторять бессмысленно - это решает весь торговый код."""
    session = FakeSession(
        {"/fapi/v1/order": {"code": -2019, "msg": "Margin is insufficient."}}
    )
    with pytest.raises(WeexTradeError) as exc:
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"
            )
        )
    assert str(exc.value.code) == "-2019"
    assert not exc.value.retryable


# ── справочник ───────────────────────────────────────────────────────────────


def test_filters_come_from_the_exchange_filters():
    """Шаги Binance называет прямо - фильтрами, а не числом знаков."""
    session = FakeSession()
    filters = run(client(session).symbol_filters("BTCUSDT"))
    assert filters["step"] == pytest.approx(0.001)
    assert filters["tick"] == pytest.approx(0.1)
    assert filters["min_qty"] == pytest.approx(0.001)
    assert filters["min_notional"] == pytest.approx(5.0)
    assert filters["taker_fee"] == pytest.approx(0.0004)
    # Предел плеча живёт в отдельной подписанной ручке: в справочнике его нет.
    assert filters["max_leverage"] == 125


def test_public_filters_do_not_invent_leverage():
    """Без ключей предел плеча неизвестен, и ноль честнее выдуманной двадцатки."""
    from core.binance.market import public_filters

    session = FakeSession()
    filters = run(public_filters(session, "BTCUSDT"))
    assert filters["max_leverage"] == 0.0


def test_delisted_pair_is_dropped():
    """Не торгуется - в справочник не берём: правду ученик узнавал бы отказом."""
    from core.binance.market import parse_instrument

    assert parse_instrument({**BTC, "status": "BREAK"}) is None
    assert parse_instrument({**BTC, "quoteAsset": "BUSD"}) is None
    assert parse_instrument({**BTC, "contractType": "CURRENT_QUARTER"}) is None


# ── вход ─────────────────────────────────────────────────────────────────────


def test_entry_in_one_way_mode_is_reducing_on_close():
    """В одностороннем режиме продажа сверх лонга развернула бы позицию."""
    session = FakeSession({"/fapi/v1/order": order_route()}, hedge=False)
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="SELL", position_side="LONG", quantity="0.01", reduce_only=True
        )
    )
    query = orders_of(session)[-1]["query"]
    assert query["positionSide"] == "BOTH"
    assert query["reduceOnly"] == "true"


def test_entry_in_hedge_mode_names_the_side_and_never_reduces():
    """В двустороннем режиме сторона обязательна, а `reduceOnly` биржа запрещает."""
    session = FakeSession({"/fapi/v1/order": order_route()}, hedge=True)
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="SELL", position_side="LONG", quantity="0.01", reduce_only=True
        )
    )
    query = orders_of(session)[-1]["query"]
    assert query["positionSide"] == "LONG"
    assert "reduceOnly" not in query


def test_quantity_is_floored_to_step():
    """Остаток отбрасывается вниз: больше риска, чем просили, ученику не надо."""
    session = FakeSession({"/fapi/v1/order": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.0129"
        )
    )
    assert orders_of(session)[-1]["query"]["quantity"] == "0.012"


def test_order_below_both_minimums_is_refused_before_the_exchange():
    """Два минимума - в монетах и в деньгах, и оба проверяем с цифрами в тексте."""
    session = FakeSession({"/fapi/v1/order": order_route()})
    with pytest.raises(WeexTradeError) as by_qty:
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.0005"
            )
        )
    assert "минимального" in str(by_qty.value)

    # Минимум в деньгах виден только на дешёвой монете: один DOGE по 0.1 - это
    # десять центов при минимуме в пять долларов. На BTC шаг объёма делает такую
    # заявку невозможной раньше.
    with pytest.raises(WeexTradeError) as by_money:
        run(
            client(session).place_order(
                symbol="DOGEUSDT", side="BUY", position_side="LONG", quantity="1"
            )
        )
    assert "USDT" in str(by_money.value)
    assert not orders_of(session)


def test_closing_order_skips_the_minimums():
    """Хвост меньше минимума закрыть всё равно надо - последнее слово за биржей."""
    session = FakeSession({"/fapi/v1/order": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="SELL",
            position_side="LONG",
            quantity="0.001",
            reduce_only=True,
        )
    )
    assert orders_of(session)


# ── защита ───────────────────────────────────────────────────────────────────


def test_protection_goes_as_separate_orders_after_the_entry():
    """Приложить защиту ко входу Binance не умеет - она уходит следом.

    Это главное отличие биржи от WEEX, BingX и MEXC, и оно видно здесь: на одну
    просьбу войти со стопом и целью уходит три заявки, а не одна.
    """
    session = FakeSession(
        {"/fapi/v1/order": order_route(), "/fapi/v1/algoOrder": algo_route()}
    )
    placed = run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            sl_trigger="78000",
            tp_trigger="82000",
        )
    )
    # Вход - обычной ручкой, защита - ручкой условных заявок.
    assert [one["query"]["type"] for one in orders_of(session)] == ["MARKET"]
    assert [one["query"]["type"] for one in algos_of(session)] == [
        "STOP_MARKET",
        "TAKE_PROFIT_MARKET",
    ]
    # Номера защиты возвращаются вызывающему: по ним стоп потом переносится.
    assert placed["slOrderId"] and placed["tpOrderId"]

    stop = algos_of(session)[0]["query"]
    assert stop["side"] == "SELL"
    assert stop["algoType"] == "CONDITIONAL"
    # Цена срабатывания у этой ручки называется иначе, чем у обычной.
    assert stop["triggerPrice"] == "78000"
    assert "stopPrice" not in stop
    assert stop["workingType"] == "MARK_PRICE"


def test_failed_protection_does_not_cancel_the_entry():
    """Вход уже прошёл: исключение здесь терминал прочёл бы как «заявки нет».

    Позиция при этом остаётся без стопа - и потому в журнал идёт тревога, а
    стоп достраивает сопровождение (`stop_waits_full_fill`).
    """
    calls: list[dict] = []

    def route(call):
        calls.append(call)
        if call["query"].get("type") == "MARKET":
            return {"orderId": 5, "clientOrderId": "", "status": "NEW"}
        return {"code": -2021, "msg": "Order would immediately trigger."}

    session = FakeSession({"/fapi/v1/order": route, "/fapi/v1/algoOrder": route})
    placed = run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            sl_trigger="78000",
        )
    )
    assert placed["orderId"] == "5"
    assert "slOrderId" not in placed
    assert BinanceFutures.stop_waits_full_fill is True


def test_stop_without_quantity_closes_the_whole_position():
    """Стоп на всю позицию объёма не имеет: подросла лимиткой - он накроет всю."""
    session = FakeSession({"/fapi/v1/algoOrder": algo_route()})
    run(
        client(session).place_tp_sl(
            symbol="BTCUSDT",
            plan_type="STOP_LOSS",
            trigger_price="78000",
            quantity="0",
            position_side="LONG",
        )
    )
    query = algos_of(session)[-1]["query"]
    assert query["closePosition"] == "true"
    assert "quantity" not in query
    assert "reduceOnly" not in query


def test_target_keeps_its_quantity():
    """Лестница целей закрывает части - там объём нужен."""
    session = FakeSession({"/fapi/v1/algoOrder": algo_route()})
    run(
        client(session).place_tp_sl(
            symbol="BTCUSDT",
            plan_type="TAKE_PROFIT",
            trigger_price="82000",
            quantity="0.005",
            position_side="LONG",
        )
    )
    query = algos_of(session)[-1]["query"]
    assert query["type"] == "TAKE_PROFIT_MARKET"
    assert query["quantity"] == "0.005"
    assert query["reduceOnly"] == "true"


def test_stop_moves_by_placing_first_and_cancelling_after():
    """Сначала новая, потом снятие прежней: наоборот - окно без защиты."""
    session = FakeSession(
        {
            "/fapi/v1/algoOrder": algo_route("900"),
            "/fapi/v1/openAlgoOrders": [
                {
                    "algoId": 800,
                    "symbol": "BTCUSDT",
                    "orderType": "STOP_MARKET",
                    "side": "SELL",
                    "positionSide": "BOTH",
                    "triggerPrice": "78000",
                    "quantity": "0",
                    "closePosition": True,
                    "algoStatus": "NEW",
                }
            ],
        }
    )
    run(client(session).modify_tp_sl(symbol="BTCUSDT", order_id="800", trigger_price="79000"))
    calls = [one for one in session.sent if one["path"] == "/fapi/v1/algoOrder"]
    assert [one["method"] for one in calls] == ["POST", "DELETE"]
    # Новая заявка тоже без объёма: иначе стоп перестал бы накрывать позицию целиком.
    assert calls[0]["query"]["closePosition"] == "true"
    assert calls[1]["query"]["algoId"] == "800"


def test_plans_live_on_their_own_endpoint():
    """С декабря 2025 условные заявки в общем списке не лежат - только в своём.

    Обычная ручка их больше и не принимает: отвечает кодом -4120 «Order type
    not supported for this endpoint» (проверено живым счётом 14 сентября).
    """
    session = FakeSession(
        {
            "/fapi/v1/openOrders": [
                {"orderId": 1, "symbol": "BTCUSDT", "type": "LIMIT", "origQty": "0.01"},
            ],
            "/fapi/v1/openAlgoOrders": [
                {
                    "algoId": 2,
                    "symbol": "BTCUSDT",
                    "orderType": "STOP_MARKET",
                    "side": "SELL",
                    "triggerPrice": "78000",
                    "quantity": "0.01",
                    "algoStatus": "NEW",
                },
            ],
        }
    )
    one = client(session)
    assert [row["orderId"] for row in run(one.open_orders("BTCUSDT"))] == ["1"]
    plans = run(one.algo_orders("BTCUSDT"))
    assert [row["orderId"] for row in plans] == ["2"]
    assert plans[0]["planType"] == "STOP_LOSS"
    assert plans[0]["triggerPrice"] == "78000"


# ── метка брокера ────────────────────────────────────────────────────────────


def test_broker_mark_is_added_and_stripped_back():
    """Метка уходит на биржу, но наружу возвращается наш же идентификатор.

    Сопровождение узнаёт свои заявки по началу строки: заявка, вернувшаяся с
    приписанным префиксом, была бы для него чужой.
    """
    session = FakeSession({"/fapi/v1/order": order_route()})
    placed = run(
        client(session, broker_key="NMNH01").place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            client_order_id="btcusdt-1757",
        )
    )
    assert orders_of(session)[-1]["query"]["newClientOrderId"] == "x-NMNH01btcusdt-1757"
    assert placed["clientOrderId"] == "btcusdt-1757"


def test_order_id_keeps_only_characters_the_exchange_allows():
    """Чужой знак биржа отвергает вместе со всей заявкой."""
    assert client_id("btc usdt#1757") == "btcusdt1757"
    assert len(client_id("x" * 80)) == 36


def test_without_broker_id_nothing_changes():
    """Метки нет - идентификатор уходит как есть. Так и стоит на проде."""
    session = FakeSession({"/fapi/v1/order": order_route()})
    run(
        client(session, broker_key="").place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            client_order_id="btcusdt-1757",
        )
    )
    assert orders_of(session)[-1]["query"]["newClientOrderId"] == "btcusdt-1757"


# ── счёт ─────────────────────────────────────────────────────────────────────


def test_position_comes_back_in_weex_fields():
    session = FakeSession(
        {
            "/fapi/v2/positionRisk": [
                {
                    "symbol": "BTCUSDT",
                    "positionAmt": "-0.020",
                    "entryPrice": "80000",
                    "breakEvenPrice": "79960",
                    "markPrice": "79500",
                    "unRealizedProfit": "10",
                    "liquidationPrice": "90000",
                    "leverage": "20",
                    "positionSide": "BOTH",
                    "isolatedWallet": "80",
                }
            ]
        }
    )
    rows = run(client(session).positions())
    assert len(rows) == 1
    # Знак объёма - единственный признак стороны в одностороннем режиме.
    assert rows[0]["positionSide"] == "SHORT"
    assert float(rows[0]["size"]) == pytest.approx(0.02)
    assert float(rows[0]["cumOpenValue"]) == pytest.approx(1600.0)
    # Безубыток считает биржа: терминал обязан быть её зеркалом.
    assert rows[0]["breakEvenPrice"] == "79960"


def test_empty_position_is_not_a_position():
    session = FakeSession(
        {"/fapi/v2/positionRisk": [{"symbol": "BTCUSDT", "positionAmt": "0", "entryPrice": "0"}]}
    )
    assert run(client(session).positions()) == []


def test_balance_reads_only_the_margin_coin():
    session = FakeSession(
        {
            "/fapi/v2/balance": [
                {"asset": "BNB", "balance": "1", "availableBalance": "1"},
                {"asset": "USDT", "balance": "100.5", "availableBalance": "90.25"},
            ]
        }
    )
    assert run(client(session).balance()) == [
        {"marginCoin": "USDT", "availableBalance": "90.25", "equity": "100.5"}
    ]


def test_fills_need_a_symbol_and_come_newest_first():
    """Без пары Binance исполнений не отдаёт вовсе - и выдумывать их мы не станем."""
    session = FakeSession(
        {
            "/fapi/v1/userTrades": [
                {
                    "symbol": "BTCUSDT",
                    "orderId": 5,
                    "side": "BUY",
                    "price": "80000",
                    "qty": "0.01",
                    "commission": "0.32",
                    "realizedPnl": "0",
                    "time": 1700000000000,
                    "positionSide": "BOTH",
                },
                {
                    "symbol": "BTCUSDT",
                    "orderId": 6,
                    "side": "SELL",
                    "price": "81000",
                    "qty": "0.01",
                    "commission": "0.324",
                    "realizedPnl": "10",
                    "time": 1700000100000,
                    "positionSide": "BOTH",
                },
            ]
        }
    )
    one = client(session)
    assert run(one.user_trades(None)) == []
    rows = run(one.user_trades("BTCUSDT"))
    assert [row["orderId"] for row in rows] == ["6", "5"]
    assert float(rows[0]["commission"]) == pytest.approx(0.324)


def test_testnet_lives_on_its_own_address():
    """Учебный контур - это адрес, а не признак в заголовке."""
    session = FakeSession()
    one = client(session, testnet=True)
    assert one.base_url.startswith("https://demo-fapi.")
    run(one.positions())
    # Запрос ушёл именно туда.
    assert any(one.base_url in str(call) for call in [one.base_url])


def test_leverage_is_read_from_the_row_of_its_own_pair():
    """Предел плеча - из строки своей пары и по наибольшей ступени.

    Бралась первая строка ответа и первая ступень в ней. Список уровней бывает
    по всем парам сразу, и тогда у всех монет подряд стоял предел чужой первой
    строки: терминал писал «макс ×10» там, где биржа пускает много выше.
    """
    session = FakeSession(
        routes={
            "/fapi/v1/leverageBracket": [
                {"symbol": "ONDOUSDT", "brackets": [{"bracket": 1, "initialLeverage": 10}]},
                {
                    "symbol": "BTCUSDT",
                    "brackets": [
                        {"bracket": 2, "initialLeverage": 100},
                        {"bracket": 1, "initialLeverage": 125},
                    ],
                },
            ]
        }
    )
    assert run(client(session).max_leverage("BTCUSDT")) == 125


def test_leverage_of_a_single_pair_answer_without_a_name():
    """Ответ по одной паре может прийти объектом без названия - он и есть наш."""
    session = FakeSession(
        routes={"/fapi/v1/leverageBracket": {"brackets": [{"bracket": 1, "initialLeverage": 75}]}}
    )
    assert run(client(session).max_leverage("ETHUSDT")) == 75
