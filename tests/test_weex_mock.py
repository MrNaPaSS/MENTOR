"""Тесты мок-клиента WEEX."""

from decimal import Decimal

import pytest

from core.weex import get_weex_client, MockWeexClient


@pytest.fixture
def client():
    return get_weex_client(use_mock=True)


def test_factory_returns_mock():
    assert isinstance(get_weex_client(use_mock=True), MockWeexClient)


async def test_price_is_positive(client):
    price = await client.get_price("BTCUSDT")
    assert price > 0


async def test_unknown_symbol_has_price(client):
    assert await client.get_price("FOOUSDT") > 0


async def test_klines_shape(client):
    candles = await client.get_klines("ETHUSDT", limit=10)
    assert len(candles) == 10
    assert len(candles[0]) == 6  # [ts, o, h, l, c, v]


async def test_affiliate_balance_stable(client):
    b1 = await client.get_affiliate_balance("123456")
    b2 = await client.get_affiliate_balance("123456")
    assert b1 == b2
    assert Decimal("100") <= b1 <= Decimal("5000")


async def test_affiliate_balance_not_found(client):
    assert await client.get_affiliate_balance("404") is None
    assert await client.get_affiliate_balance("") is None


async def test_min_order(client):
    assert await client.get_min_order_usd("BTCUSDT") == Decimal("5")
