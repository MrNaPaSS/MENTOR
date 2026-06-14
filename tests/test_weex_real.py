"""Тесты реального WEEX-клиента: подпись, HTTP-вызовы (фейковая сессия), парсинг."""

from decimal import Decimal

import base64
import hashlib
import hmac

import pytest

from core.weex.real import RealWeexClient, sign, _search_field, _PRICE_FIELDS, _BALANCE_FIELDS
from core.weex import get_weex_client
from core.weex.mock import MockWeexClient


# ── Подпись ──

def test_sign_matches_hmac():
    secret, ts, method, path, body = "s3cr3t", "1700000000000", "GET", "/capi/v3/market/time", ""
    expected = base64.b64encode(
        hmac.new(secret.encode(), f"{ts}{method}{path}{body}".encode(), hashlib.sha256).digest()
    ).decode()
    assert sign(secret, ts, method, path, body) == expected


def test_signed_headers_contain_fields():
    client = RealWeexClient("key", "secret", "pass")
    headers = client._headers("GET", "/capi/v3/market/time")
    assert headers["ACCESS-KEY"] == "key"
    assert headers["ACCESS-PASSPHRASE"] == "pass"
    assert headers["ACCESS-SIGN"] and headers["ACCESS-TIMESTAMP"]


# ── Защитный парсинг ──

def test_search_field_nested():
    assert _search_field({"data": {"last": "65000"}}, _PRICE_FIELDS) == Decimal("65000")
    assert _search_field({"data": [{"x": 1}, {"balance": "12.5"}]}, _BALANCE_FIELDS) == Decimal("12.5")
    assert _search_field({"nope": 1}, _PRICE_FIELDS) is None


# ── HTTP через фейковую сессию ──

class FakeResp:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def json(self):
        return self._payload


class FakeSession:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.calls = []

    def get(self, url, params=None, headers=None):
        self.calls.append({"url": url, "params": params, "headers": headers})
        return FakeResp(self.status, self.payload)

    async def close(self):
        return None


def _client(payload, status=200):
    return RealWeexClient(
        "k", "s", "p", session=FakeSession(payload, status),
        affiliate_key="ak", affiliate_secret="as", affiliate_passphrase="ap",
    )


async def test_get_price_parses():
    client = _client({"code": "0", "data": {"symbol": "BTCUSDT", "last": "65000.5"}})
    assert await client.get_price("BTCUSDT") == Decimal("65000.5")


async def test_get_price_missing_raises():
    client = _client({"code": "0", "data": {}})
    with pytest.raises(RuntimeError):
        await client.get_price("BTCUSDT")


async def test_get_price_http_error_raises():
    client = _client({}, status=500)
    with pytest.raises(RuntimeError):
        await client.get_price("BTCUSDT")


async def test_affiliate_balance_signed():
    client = _client({"data": {"futuresBalance": "1234.56"}})
    balance = await client.get_affiliate_balance("123456")
    assert balance == Decimal("1234.56")
    # Запрос был подписан (аффилиат-ключ).
    call = client._session.calls[0]
    assert call["headers"]["ACCESS-KEY"] == "ak"
    assert call["headers"]["ACCESS-SIGN"]


async def test_affiliate_balance_none_on_error():
    client = _client({}, status=404)
    assert await client.get_affiliate_balance("123456") is None


async def test_get_klines_returns_list():
    client = _client({"data": [[1, "1", "2", "0.5", "1.5", "100"]]})
    klines = await client.get_klines("ETHUSDT", limit=1)
    assert isinstance(klines, list) and len(klines) == 1


async def test_get_server_time():
    client = _client({"data": 1700000000000})
    assert await client.get_server_time() == 1700000000000


async def test_min_order_default():
    client = _client({})
    assert await client.get_min_order_usd("BTCUSDT") == Decimal("5")


# ── Фабрика ──

def test_factory_real_path(monkeypatch):
    monkeypatch.setenv("WEEX_API_KEY", "k")
    monkeypatch.setenv("WEEX_SECRET_KEY", "s")
    monkeypatch.setenv("WEEX_PASSPHRASE", "p")
    assert isinstance(get_weex_client(use_mock=False), RealWeexClient)


def test_factory_env_default(monkeypatch):
    monkeypatch.setenv("WEEX_USE_MOCK", "true")
    assert isinstance(get_weex_client(), MockWeexClient)
