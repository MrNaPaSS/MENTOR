"""Тесты реального WEEX-клиента (подпись + заглушки)."""

import base64
import hashlib
import hmac

import pytest

from core.weex.real import RealWeexClient, sign
from core.weex import get_weex_client
from core.weex.mock import MockWeexClient


def test_sign_matches_hmac():
    secret, ts, method, path, body = "s3cr3t", "1700000000000", "GET", "/capi/v3/market/time", ""
    expected = base64.b64encode(
        hmac.new(secret.encode(), f"{ts}{method}{path}{body}".encode(), hashlib.sha256).digest()
    ).decode()
    assert sign(secret, ts, method, path, body) == expected


def test_headers_contain_signature():
    client = RealWeexClient("key", "secret", "pass")
    headers = client._headers("GET", "/capi/v3/market/time")
    assert headers["ACCESS-KEY"] == "key"
    assert headers["ACCESS-PASSPHRASE"] == "pass"
    assert headers["ACCESS-SIGN"] and headers["ACCESS-TIMESTAMP"]


async def test_real_methods_not_implemented_until_keys():
    client = RealWeexClient("key", "secret", "pass")
    with pytest.raises(NotImplementedError):
        await client.get_price("BTCUSDT")
    with pytest.raises(NotImplementedError):
        await client.get_affiliate_balance("123")


def test_factory_real_path(monkeypatch):
    monkeypatch.setenv("WEEX_API_KEY", "k")
    monkeypatch.setenv("WEEX_SECRET_KEY", "s")
    monkeypatch.setenv("WEEX_PASSPHRASE", "p")
    client = get_weex_client(use_mock=False)
    assert isinstance(client, RealWeexClient)


def test_factory_env_default(monkeypatch):
    monkeypatch.setenv("WEEX_USE_MOCK", "true")
    assert isinstance(get_weex_client(), MockWeexClient)
