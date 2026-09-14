"""Клиент MEXC: подпись, контракты, сторона числом и перевод ответов в поля WEEX.

Сети нет: сессия подменена и отвечает тем, что MEXC присылает на самом деле, по
полям из §3 ТЗ (`docs/tz/mexc-tz.md`), проверенным запросами к живой бирже.
Проверяем то, на чём здесь легко потерять деньги ученика: перевод монет в
контракты, четыре случая стороны, подпись от тела POST и снятие защиты своей
ручкой.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

import pytest

from core.mexc import market as mexc_market
from core.mexc.futures import (
    MexcFutures,
    client_id,
    side_code,
    sides_of,
    symbol_id,
    symbol_of,
)
from core.weex.futures import Credentials, WeexTradeError

# Справочник BTC у MEXC: контракт - 0.0001 монеты, шаг - один контракт.
BTC = {
    "symbol": "BTC_USDT",
    "contractSize": 0.0001,
    "volUnit": 1,
    "minVol": 1,
    "maxVol": 1000000,
    "priceUnit": 0.1,
    "maxLeverage": 200,
    "takerFeeRate": 0.0002,
    "makerFeeRate": 0,
    "state": 0,
}

LONG_POSITION = {
    "positionId": 4242,
    "symbol": "BTC_USDT",
    "positionType": 1,
    "openType": 1,
    "state": 1,
    "holdVol": 100,          # сто контрактов = 0.01 BTC
    "holdAvgPrice": 80000,
    "leverage": 20,
    "im": "4",
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
    """Отвечает по пути; запоминает, что ушло - вместе с телом и заголовками."""

    def __init__(self, routes: dict[str, object] | None = None, hedge: bool = True):
        self.routes = {
            "/api/v1/contract/detail": {"code": 0, "data": [BTC]},
            "/api/v1/contract/ticker": {"code": 0, "data": {"lastPrice": "80000"}},
            "/api/v1/private/position/position_mode": {
                "code": 0,
                "data": {"positionMode": 1 if hedge else 2},
            },
            "/api/v1/private/position/open_positions": {"code": 0, "data": []},
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
                "body": json.loads(data) if data else None,
                "raw_body": data,
            }
        )
        payload = self.routes.get(parsed.path, {"code": 0, "data": []})
        if callable(payload):
            payload = payload(self.sent[-1])
        return _Response(payload)

    def get(self, url, params=None, timeout=None):
        return self.request("GET", url, params=params, timeout=timeout)


@pytest.fixture(autouse=True)
def _fresh_caches():
    # Справочник, режимы счетов и поправка часов живут в памяти процесса: тест,
    # оставивший их за собой, менял бы поведение соседних.
    mexc_market.clear_caches()
    mexc_market._SKEW_MS = 0.0
    mexc_market._SKEW_AT = 0.0
    yield
    mexc_market.clear_caches()
    mexc_market._SKEW_MS = 0.0
    mexc_market._SKEW_AT = 0.0


def client(session: FakeSession, **kw) -> MexcFutures:
    async def factory():
        return session

    return MexcFutures(Credentials("key", "secret", ""), factory, **kw)


def run(coro):
    return asyncio.run(coro)


def sent_to(session: FakeSession, path: str) -> dict:
    return next(s for s in reversed(session.sent) if s["path"] == path)


def order_route(order_id: str = "77"):
    return lambda call: {"code": 0, "data": {"orderId": order_id}}


# ── имена и подпись ──────────────────────────────────────────────────────────


def test_symbol_is_written_with_underscore():
    """Четвёртое написание пары в нашем коде - через подчёркивание."""
    assert symbol_id("BTCUSDT") == "BTC_USDT"
    assert symbol_id("BTC-USDT") == "BTC_USDT"
    assert symbol_id("BTC_USDT") == "BTC_USDT"
    assert symbol_of("BTC_USDT") == "BTCUSDT"


def test_signature_is_taken_from_key_time_and_params():
    """Правило биржи: HMAC от `apiKey + время + параметры`, параметры по ключу."""
    from core.mexc.market import sign, signing_string

    raw = signing_string({"symbol": "BTC_USDT", "page_num": 1, "empty": ""})
    assert raw == "page_num=1&symbol=BTC_USDT"

    expected = hmac.new(b"secret", b"key1700000000000" + raw.encode(), hashlib.sha256).hexdigest()
    assert sign("secret", "key", "1700000000000", raw) == expected


def test_post_is_signed_by_the_body_that_goes_out():
    """У POST подписывается тело - ровно то, что уходит на биржу.

    Пересобранное библиотекой тело разошлось бы с подписью, и биржа ответила бы
    отказом, в котором про тело не будет ни слова.
    """
    from core.mexc.market import sign

    session = FakeSession({"/api/v1/private/order/create": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"
        )
    )
    call = sent_to(session, "/api/v1/private/order/create")
    body = call["raw_body"]
    # Тело ушло строкой без пробелов - лишний пробел это другая подпись.
    assert body == json.dumps(call["body"], separators=(",", ":"), ensure_ascii=False)
    assert call["headers"]["Signature"] == sign(
        "secret", "key", call["headers"]["Request-Time"], body
    )
    assert call["headers"]["ApiKey"] == "key"
    # Окно годности у биржи десять секунд - просим шире, часы этой машины
    # съедают половину.
    assert int(call["headers"]["Recv-Window"]) >= 10000


def test_get_is_signed_by_the_sorted_query():
    """У GET подписывается строка параметров, и она же уходит в адресе."""
    from core.mexc.market import sign

    session = FakeSession({"/api/v1/private/stoporder/list/orders": {"code": 0, "data": []}})
    run(client(session).algo_orders("BTCUSDT"))
    call = sent_to(session, "/api/v1/private/stoporder/list/orders")
    keys = [pair.split("=", 1)[0] for pair in call["raw_query"].split("&")]
    assert keys == sorted(keys)
    assert call["headers"]["Signature"] == sign(
        "secret", "key", call["headers"]["Request-Time"], call["raw_query"]
    )


# ── сторона одним числом ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "side,position_side,code",
    [
        ("BUY", "LONG", 1),    # открыть лонг
        ("BUY", "SHORT", 2),   # закрыть шорт
        ("SELL", "SHORT", 3),  # открыть шорт
        ("SELL", "LONG", 4),   # закрыть лонг
    ],
)
def test_side_code_covers_all_four_cases(side, position_side, code):
    """Все четыре случая: здесь ошибка открывает встречную позицию вместо закрытия."""
    assert side_code(side, position_side) == code
    assert sides_of(code) == (side, position_side)


def test_unknown_side_code_reads_as_nothing():
    """Чужое число - две пустые строки, а не выдуманная сторона."""
    assert sides_of(9) == ("", "")
    assert sides_of(None) == ("", "")


# ── контракты и монеты ───────────────────────────────────────────────────────


def test_quantity_goes_to_exchange_in_contracts():
    """Монеты переводятся в контракты: 0.01 BTC при контракте 0.0001 - это сто."""
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"
        )
    )
    body = sent_to(session, "/api/v1/private/order/create")["body"]
    assert body["vol"] == 100
    assert body["side"] == 1
    assert body["symbol"] == "BTC_USDT"


def test_quantity_is_floored_to_contract_step():
    """Остаток отбрасывается вниз: больше риска, чем просили, ученику не надо."""
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01019"
        )
    )
    assert sent_to(session, "/api/v1/private/order/create")["body"]["vol"] == 101


def test_order_below_minimum_is_refused_before_the_exchange():
    """Меньше минимума - отказ с числами, а не код биржи без объяснений."""
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    with pytest.raises(WeexTradeError) as exc:
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.00005"
            )
        )
    assert "минимального" in str(exc.value)
    assert not [one for one in session.sent if one["path"].endswith("/order/create")]


def test_position_comes_back_in_coins_not_contracts():
    """Сто контрактов - это 0.01 BTC. В интерфейс обязаны попасть монеты."""
    session = FakeSession(
        {"/api/v1/private/position/open_positions": {"code": 0, "data": [LONG_POSITION]}}
    )
    rows = run(client(session).positions())
    assert len(rows) == 1
    assert rows[0]["symbol"] == "BTCUSDT"
    assert rows[0]["positionSide"] == "LONG"
    assert float(rows[0]["size"]) == pytest.approx(0.01)
    assert float(rows[0]["cumOpenValue"]) == pytest.approx(800.0)
    assert rows[0]["positionId"] == "4242"


def test_closed_position_is_not_a_position():
    """Закрытая позиция в список не попадает: нулевой объём это не сделка."""
    session = FakeSession(
        {
            "/api/v1/private/position/open_positions": {
                "code": 0,
                "data": [{**LONG_POSITION, "holdVol": 0, "state": 3}],
            }
        }
    )
    assert run(client(session).positions()) == []


def test_filters_are_in_coins():
    """Шаги наружу - в монетах, как у всех бирж терминала."""
    session = FakeSession()
    filters = run(client(session).symbol_filters("BTCUSDT"))
    assert filters["step"] == pytest.approx(0.0001)
    assert filters["min_qty"] == pytest.approx(0.0001)
    assert filters["tick"] == pytest.approx(0.1)
    assert filters["taker_fee"] == pytest.approx(0.0002)
    assert filters["max_leverage"] == 200


# ── справочник ───────────────────────────────────────────────────────────────


def test_assessment_zone_pairs_are_dropped():
    """Пары «зоны оценки» по API недоступны - в списке монет им не место."""
    from core.mexc.market import parse_instrument

    assert parse_instrument({**BTC, "symbol": "NEW_USDT", "isAssessmentZone": True}) is None
    assert parse_instrument({**BTC, "symbol": "NEW_USDT", "zone": "Assessment Zone"}) is None
    assert parse_instrument(BTC) is not None


def test_suspended_pair_is_dropped():
    """Не торгуется - в справочник не берём: правду ученик узнавал бы отказом."""
    from core.mexc.market import parse_instrument

    assert parse_instrument({**BTC, "state": 3}) is None


def test_pair_without_contract_size_is_dropped():
    """Без размера контракта объём не перевести, а гадать здесь нельзя."""
    from core.mexc.market import parse_instrument

    assert parse_instrument({**BTC, "contractSize": 0}) is None


# ── заявки ───────────────────────────────────────────────────────────────────


def test_entry_carries_stop_and_target_with_it():
    """Защита уходит тем же ордером: между двумя запросами позиция без стопа."""
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            sl_trigger="78000",
            tp_trigger="82000",
            client_order_id="nmnh-17",
        )
    )
    body = sent_to(session, "/api/v1/private/order/create")["body"]
    assert body["stopLossPrice"] == 78000
    assert body["takeProfitPrice"] == 82000
    assert body["externalOid"] == "nmnh-17"
    # Рыночный вход: тип 5.
    assert body["type"] == 5


def test_limit_entry_needs_a_price():
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    with pytest.raises(WeexTradeError):
        run(
            client(session).place_order(
                symbol="BTCUSDT",
                side="BUY",
                position_side="LONG",
                quantity="0.01",
                order_type="LIMIT",
            )
        )


def test_closing_order_carries_the_position_id():
    """Закрытие адресуется номером позиции: иначе биржа не знает, какую из двух."""
    session = FakeSession(
        {
            "/api/v1/private/position/open_positions": {"code": 0, "data": [LONG_POSITION]},
            "/api/v1/private/order/create": order_route(),
        }
    )
    run(
        client(session).place_order(
            symbol="BTCUSDT",
            side="SELL",
            position_side="LONG",
            quantity="0.01",
            reduce_only=True,
        )
    )
    body = sent_to(session, "/api/v1/private/order/create")["body"]
    assert body["side"] == 4          # закрыть лонг
    assert body["positionId"] == 4242
    assert body["openType"] == 1      # тот же способ маржи, что у позиции


def test_client_id_keeps_only_safe_characters():
    """Метка ездит в адресе ручки поиска - косая черта сломала бы сам адрес."""
    assert client_id("nmnh/17 20:30") == "nmnh172030"
    assert len(client_id("x" * 100)) == 32


def test_order_is_found_by_our_own_mark():
    """Своя метка ищется своей ручкой - без предварительного поиска номера."""
    session = FakeSession(
        {
            "/api/v1/private/order/external/BTC_USDT/nmnh-17": {
                "code": 0,
                "data": {
                    "orderId": 5,
                    "symbol": "BTC_USDT",
                    "side": 1,
                    "vol": 100,
                    "dealVol": 100,
                    "state": 3,
                    "externalOid": "nmnh-17",
                    "price": 80000,
                },
            }
        }
    )
    row = run(client(session).get_order("BTCUSDT", "nmnh-17"))
    assert row["status"] == "FILLED"
    assert row["clientOrderId"] == "nmnh-17"
    # Объём и здесь в монетах.
    assert float(row["origQty"]) == pytest.approx(0.01)


def test_cancel_by_mark_uses_its_own_endpoint():
    """Отмена по метке - ручка биржи, а не поиск номера у нас."""
    session = FakeSession({"/api/v1/private/order/cancel_with_external": {"code": 0}})
    run(client(session).cancel_order("BTCUSDT", "nmnh-17"))
    call = sent_to(session, "/api/v1/private/order/cancel_with_external")
    assert call["body"] == {"symbol": "BTC_USDT", "externalOid": "nmnh-17"}


def test_cancel_by_number_sends_a_list():
    """Отмена по номеру: биржа ждёт список номеров, а не один номер."""
    session = FakeSession({"/api/v1/private/order/cancel": {"code": 0}})
    run(client(session).cancel_order("BTCUSDT", "5150"))
    assert sent_to(session, "/api/v1/private/order/cancel")["body"] == [5150]


# ── защита позиции ───────────────────────────────────────────────────────────


def test_stop_is_placed_on_the_open_position():
    """Стоп ставится сокращающей заявкой с ценой срабатывания на ту позицию."""
    session = FakeSession(
        {
            "/api/v1/private/position/open_positions": {"code": 0, "data": [LONG_POSITION]},
            "/api/v1/private/order/create": order_route("900"),
        }
    )
    placed = run(
        client(session).place_tp_sl(
            symbol="BTCUSDT",
            plan_type="STOP_LOSS",
            trigger_price="78000",
            quantity="0.01",
            position_side="LONG",
        )
    )
    body = sent_to(session, "/api/v1/private/order/create")["body"]
    assert body["side"] == 4            # закрытие лонга
    assert body["stopLossPrice"] == 78000
    assert body["positionId"] == 4242
    assert body["vol"] == 100
    # Метки у защиты нет - опознаётся номером, как на BingX.
    assert placed == {"orderId": "900", "algoId": "900", "clientAlgoId": ""}


def test_stop_without_position_is_refused():
    """Ставить защиту не на что - говорим это, а не шлём заявку в пустоту."""
    session = FakeSession({"/api/v1/private/order/create": order_route()})
    with pytest.raises(WeexTradeError):
        run(
            client(session).place_tp_sl(
                symbol="BTCUSDT",
                plan_type="STOP_LOSS",
                trigger_price="78000",
                quantity="0.01",
                position_side="LONG",
            )
        )


def test_stop_moves_in_place_without_cancelling():
    """Перенос стопа - одна ручка биржи. Окна без защиты не возникает вовсе."""
    session = FakeSession(
        {
            "/api/v1/private/stoporder/list/orders": {
                "code": 0,
                "data": [
                    {
                        "id": 900,
                        "symbol": "BTC_USDT",
                        "positionId": 4242,
                        "positionType": 1,
                        "stopLossPrice": 78000,
                        "vol": 100,
                        "state": 1,
                    }
                ],
            },
            "/api/v1/private/stoporder/change_price": {"code": 0},
        }
    )
    run(client(session).modify_tp_sl(symbol="BTCUSDT", order_id="900", trigger_price="79000"))
    call = sent_to(session, "/api/v1/private/stoporder/change_price")
    assert call["body"] == {"orderId": 900, "stopLossPrice": 79000}
    # Снятия прежней заявки нет - в этом вся разница с BingX.
    assert not [one for one in session.sent if one["path"].endswith("/stoporder/cancel")]


def test_stop_and_target_of_one_record_read_as_two_orders():
    """Биржа держит стоп и цель одной записью, терминал считает их разными."""
    session = FakeSession(
        {
            "/api/v1/private/stoporder/list/orders": {
                "code": 0,
                "data": [
                    {
                        "id": 900,
                        "symbol": "BTC_USDT",
                        "positionId": 4242,
                        "positionType": 1,
                        "stopLossPrice": 78000,
                        "takeProfitPrice": 82000,
                        "vol": 100,
                        "state": 1,
                    }
                ],
            }
        }
    )
    rows = run(client(session).algo_orders("BTCUSDT"))
    assert [row["planType"] for row in rows] == ["STOP_LOSS", "TAKE_PROFIT"]
    assert [row["triggerPrice"] for row in rows] == [78000, 82000]
    # Обе половины закрывают лонг продажей и знают объём в монетах.
    assert {row["side"] for row in rows} == {"SELL"}
    assert float(rows[0]["quantity"]) == pytest.approx(0.01)


def test_one_record_is_cancelled_once():
    """Стоп и цель одной записи носят один номер: вторая отмена била бы впустую."""
    session = FakeSession(
        {
            "/api/v1/private/stoporder/list/orders": {
                "code": 0,
                "data": [
                    {
                        "id": 900,
                        "symbol": "BTC_USDT",
                        "positionId": 4242,
                        "positionType": 1,
                        "stopLossPrice": 78000,
                        "takeProfitPrice": 82000,
                        "vol": 100,
                    }
                ],
            },
            "/api/v1/private/stoporder/cancel": {"code": 0},
        }
    )
    assert run(client(session).cancel_all_algo("BTCUSDT")) == 1
    calls = [one for one in session.sent if one["path"].endswith("/stoporder/cancel")]
    assert len(calls) == 1
    assert calls[0]["body"] == [{"symbol": "BTC_USDT", "stopPlanOrderId": 900}]


# ── отказы биржи ─────────────────────────────────────────────────────────────


def test_exchange_refusal_becomes_a_trade_error():
    """Отказ в конверте - наше исключение, по которому решает весь торговый код."""
    session = FakeSession(
        {
            "/api/v1/private/order/create": {
                "success": False,
                "code": 2005,
                "message": "Balance insufficient",
            }
        }
    )
    with pytest.raises(WeexTradeError) as exc:
        run(
            client(session).place_order(
                symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"
            )
        )
    assert str(exc.value.code) == "2005"
    assert not exc.value.retryable


def test_rate_limit_refusal_is_retryable():
    """Отказ по частоте можно повторить - в отличие от отказа по существу."""
    session = FakeSession(
        {"/api/v1/private/account/assets": {"code": 510, "message": "Frequent request"}}
    )
    with pytest.raises(WeexTradeError) as exc:
        run(client(session).balance())
    assert exc.value.retryable


def test_clock_refusal_is_retried_once_with_synced_clock():
    """Отказ по времени лечится сверкой часов и одним повтором.

    Заявка при таком отказе до биржи не дошла, значит повтор ничего не
    задваивает; второго повтора нет - если и со сверенными часами не вышло,
    дело не в них.
    """
    calls: list[int] = []

    def order(call):
        calls.append(1)
        if len(calls) == 1:
            return {"success": False, "code": 602, "message": "Request time is too far"}
        return {"code": 0, "data": {"orderId": "77"}}

    session = FakeSession(
        {
            "/api/v1/private/order/create": order,
            "/api/v1/contract/ping": {"code": 0, "data": 1700000000000},
        }
    )
    placed = run(
        client(session).place_order(
            symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"
        )
    )
    assert placed["orderId"] == "77"
    assert len(calls) == 2
    # Часы сверены между попытками, а не угаданы.
    assert any(one["path"] == "/api/v1/contract/ping" for one in session.sent)


def test_unknown_order_path_falls_back_to_the_older_one():
    """Биржа держит два написания ручки заявки. Первый отказ переключает раз и навсегда."""
    session = FakeSession(
        {
            "/api/v1/private/order/create": {
                "success": False,
                "code": 404,
                "message": "path not found",
            },
            "/api/v1/private/order/submit": order_route("88"),
        }
    )
    one = client(session)
    assert run(
        one.place_order(symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01")
    )["orderId"] == "88"
    run(one.place_order(symbol="BTCUSDT", side="BUY", position_side="LONG", quantity="0.01"))
    # Во второй раз на несуществующий адрес уже не ходим.
    assert len([one for one in session.sent if one["path"].endswith("/order/create")]) == 1


# ── журнал сделок ────────────────────────────────────────────────────────────


def test_fills_come_in_coins_and_newest_first():
    """Исполнения: объём в монетах, комиссия величиной, свежие первыми."""
    session = FakeSession(
        {
            "/api/v1/private/order/list/order_deals": {
                "code": 0,
                "data": [
                    {
                        "symbol": "BTC_USDT",
                        "orderId": 5,
                        "side": 1,
                        "vol": 100,
                        "price": 80000,
                        "fee": -1.6,
                        "profit": 0,
                        "timestamp": 1700000000000,
                        "externalOid": "nmnh-17",
                    },
                    {
                        "symbol": "BTC_USDT",
                        "orderId": 6,
                        "side": 4,
                        "vol": 100,
                        "price": 81000,
                        "fee": -1.62,
                        "profit": 10,
                        "timestamp": 1700000100000,
                    },
                ],
            }
        }
    )
    rows = run(client(session).user_trades("BTCUSDT"))
    assert [row["orderId"] for row in rows] == ["6", "5"]
    assert float(rows[0]["qty"]) == pytest.approx(0.01)
    assert float(rows[0]["commission"]) == pytest.approx(1.62)
    assert rows[1]["side"] == "BUY" and rows[1]["positionSide"] == "LONG"
    assert rows[0]["side"] == "SELL" and rows[0]["positionSide"] == "LONG"


def test_balance_reads_only_the_margin_coin():
    session = FakeSession(
        {
            "/api/v1/private/account/assets": {
                "code": 0,
                "data": [
                    {"currency": "BTC", "availableBalance": 1, "equity": 1},
                    {"currency": "USDT", "availableBalance": "9.5", "equity": "10"},
                ],
            }
        }
    )
    rows = run(client(session).balance())
    assert rows == [{"marginCoin": "USDT", "availableBalance": "9.5", "equity": "10"}]
