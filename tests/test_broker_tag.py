"""Метка брокера: она должна попадать на биржу и не попадать внутрь терминала.

Две стороны одной ошибки. Не поставили метку — биржа не заплатит за оборот.
Не сняли при чтении — сопровождение не узнает свою заявку по началу строки
(`backend/trading/watcher.py`), и позиция останется без переноса стопа.
Поэтому проверяется и то, и другое.
"""

from __future__ import annotations

import asyncio

import pytest

from core.broker import BrokerMark, weex_mark
from core.weex.futures import Credentials, WeexFutures

BROKER = "WEEX123456"
PREFIX = f"b-{BROKER}-"


# ── сама метка ───────────────────────────────────────────────────────────────

def test_weex_prefix_follows_documented_format():
    """`b-{brokerId}` перед идентификатором — так описано в брокерском API WEEX."""
    mark = weex_mark(BROKER)
    assert mark.tag("BTCUSDT-1757500000000") == f"{PREFIX}BTCUSDT-1757500000000"


def test_without_broker_id_nothing_changes():
    """Пока мы не брокер, заявка обязана уходить ровно такой же, как раньше."""
    mark = weex_mark("")
    assert not mark.enabled
    assert mark.tag("BTCUSDT-1757500000000") == "BTCUSDT-1757500000000"
    assert mark.untag("BTCUSDT-1757500000000") == "BTCUSDT-1757500000000"


def test_untag_returns_the_terminal_identifier():
    mark = weex_mark(BROKER)
    assert mark.untag(f"{PREFIX}BTCUSDT-1_x2") == "BTCUSDT-1_x2"


def test_tag_is_not_applied_twice():
    """Помеченный идентификатор не должен получить вторую метку."""
    mark = weex_mark(BROKER)
    once = mark.tag("BTCUSDT-1")
    assert mark.tag(once) == once


def test_too_long_identifier_goes_without_the_mark():
    """Обрезать нельзя: по идентификатору потом ищут заявку.

    Лучше потерять ребейт с одной заявки, чем потерять саму заявку.
    """
    mark = weex_mark(BROKER)
    long_id = "X" * 60
    assert mark.tag(long_id) == long_id


def test_clean_does_not_touch_the_original_row():
    """Ответ биржи не мутируем: это общий словарь, его читают и другие."""
    mark = weex_mark(BROKER)
    row = {"clientOid": f"{PREFIX}BTCUSDT-1", "orderId": "77"}
    cleaned = mark.clean(row)

    assert cleaned["clientOid"] == "BTCUSDT-1"
    assert row["clientOid"] == f"{PREFIX}BTCUSDT-1"
    assert cleaned["orderId"] == "77"


def test_clean_covers_every_name_the_exchange_uses():
    mark = weex_mark(BROKER)
    row = {
        "clientOid": f"{PREFIX}a",
        "clientOrderId": f"{PREFIX}b",
        "newClientOrderId": f"{PREFIX}c",
        "clientAlgoId": f"{PREFIX}d",
    }
    cleaned = mark.clean(row)
    assert [cleaned[name] for name in ("clientOid", "clientOrderId", "newClientOrderId", "clientAlgoId")] == [
        "a",
        "b",
        "c",
        "d",
    ]


def test_mark_is_immutable():
    mark = BrokerMark(prefix=PREFIX, limit=64)
    with pytest.raises(Exception):
        mark.prefix = "other"  # type: ignore[misc]


# ── клиент биржи ─────────────────────────────────────────────────────────────

def _client(broker_id: str) -> WeexFutures:
    return WeexFutures(Credentials("k", "s", "p"), lambda: None, broker_id=broker_id)  # type: ignore[arg-type]


def _capture(client: WeexFutures, answer):
    """Подменить сеть: запоминаем, что ушло бы на биржу, и отвечаем заготовкой."""
    sent: dict = {}

    async def fake(method, path, *, params=None, data=None):
        sent["method"] = method
        sent["path"] = path
        sent["params"] = params
        sent["data"] = data
        return answer

    client._request = fake  # type: ignore[assignment]
    return sent


def test_order_leaves_with_the_broker_mark():
    client = _client(BROKER)
    sent = _capture(client, {"orderId": "1"})

    asyncio.run(
        client.place_order(
            symbol="cmt_btcusdt",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            client_order_id="BTCUSDT-1757500000000",
        )
    )

    assert sent["data"]["newClientOrderId"] == f"{PREFIX}BTCUSDT-1757500000000"


def test_order_without_broker_id_keeps_the_plain_identifier():
    client = _client("")
    sent = _capture(client, {"orderId": "1"})

    asyncio.run(
        client.place_order(
            symbol="cmt_btcusdt",
            side="BUY",
            position_side="LONG",
            quantity="0.01",
            client_order_id="BTCUSDT-1757500000000",
        )
    )

    assert sent["data"]["newClientOrderId"] == "BTCUSDT-1757500000000"


# ── Условные заявки: стопы и цели ────────────────────────────────────────────


def test_protection_leaves_with_the_broker_mark():
    """Стопы и цели засчитываются - WEEX подтвердила это 12 сентября 2026.

    Метка идёт в `clientAlgoId`, и это половина оборота терминала: защиту
    терминал ставит сразу после входа.
    """
    from backend.trading.watcher import take_label

    client = _client(BROKER)
    sent = _capture(client, {"orderId": "1"})
    label = take_label("BTCUSDT-1757500000000", 0)

    asyncio.run(
        client.place_tp_sl(
            symbol="cmt_btcusdt",
            plan_type="TAKE_PROFIT",
            trigger_price="70000",
            quantity="0.01",
            position_side="LONG",
            client_algo_id=label,
        )
    )

    assert sent["data"]["clientAlgoId"] == f"{PREFIX}{label}"
    # Предел биржи - тридцать два знака вместе с меткой.
    assert len(sent["data"]["clientAlgoId"]) <= 32


def test_long_protection_label_goes_without_the_mark_but_the_order_stands():
    """Не влезло - уходит без метки. Защита позиции дороже ребейта с заявки."""
    client = _client(BROKER)
    sent = _capture(client, {"orderId": "1"})
    long_label = "tp1_BTCUSDT-1757500000000"  # прежнее длинное написание

    asyncio.run(
        client.place_tp_sl(
            symbol="cmt_btcusdt",
            plan_type="STOP_LOSS",
            trigger_price="60000",
            quantity="0.01",
            position_side="LONG",
            client_algo_id=long_label,
        )
    )

    assert sent["data"]["clientAlgoId"] == long_label


def test_protection_without_broker_id_keeps_the_plain_label():
    from backend.trading.watcher import stop_label

    client = _client("")
    sent = _capture(client, {"orderId": "1"})
    label = stop_label("BTCUSDT-1757500000000", 1)

    asyncio.run(
        client.place_tp_sl(
            symbol="cmt_btcusdt",
            plan_type="STOP_LOSS",
            trigger_price="60000",
            quantity="0.01",
            position_side="LONG",
            client_algo_id=label,
        )
    )

    assert sent["data"]["clientAlgoId"] == label


def test_protection_comes_back_without_the_mark():
    """Сопровождение ищет свой стоп по ярлыку - префикс биржи ему помешает."""
    from backend.trading.watcher import take_label

    client = _client(BROKER)
    label = take_label("BTCUSDT-1757500000000", 0)
    _capture(client, [{"clientAlgoId": f"{PREFIX}{label}", "orderId": "7"}])

    rows = asyncio.run(client.algo_orders("cmt_btcusdt"))

    assert rows[0]["clientAlgoId"] == label


def test_open_orders_come_back_without_the_mark():
    """Сопровождение сравнивает начало строки — префикс биржи ему помешает."""
    client = _client(BROKER)
    _capture(client, [{"orderId": "1", "clientOid": f"{PREFIX}BTCUSDT-1757500000000"}])

    rows = asyncio.run(client.open_orders("cmt_btcusdt"))
    assert rows[0]["clientOid"] == "BTCUSDT-1757500000000"


def test_user_trades_come_back_without_the_mark():
    client = _client(BROKER)
    _capture(client, [{"orderId": "1", "clientOrderId": f"{PREFIX}BTCUSDT-1", "commission": "0.4"}])

    rows = asyncio.run(client.user_trades("cmt_btcusdt"))
    assert rows[0]["clientOrderId"] == "BTCUSDT-1"
    assert rows[0]["commission"] == "0.4"


def test_single_order_comes_back_without_the_mark():
    client = _client(BROKER)
    _capture(client, {"orderId": "1", "clientOid": f"{PREFIX}BTCUSDT-1"})

    row = asyncio.run(client.get_order("cmt_btcusdt", "1"))
    assert row["clientOid"] == "BTCUSDT-1"


def test_broker_id_comes_from_environment(monkeypatch):
    """Клиент создаётся в четырёх местах — метку они получают из окружения."""
    monkeypatch.setenv("WEEX_BROKER_ID", BROKER)
    client = WeexFutures(Credentials("k", "s", "p"), lambda: None)  # type: ignore[arg-type]
    assert client.mark.enabled
    assert client.mark.tag("BTCUSDT-1") == f"{PREFIX}BTCUSDT-1"


def test_empty_environment_means_no_mark(monkeypatch):
    monkeypatch.delenv("WEEX_BROKER_ID", raising=False)
    client = WeexFutures(Credentials("k", "s", "p"), lambda: None)  # type: ignore[arg-type]
    assert not client.mark.enabled
