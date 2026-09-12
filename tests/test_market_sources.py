"""Рыночные ручки на общем слое источников (ТЗ этап 1, §4.4 и §4.6).

Критерий приёмки этапа: при упавшем источнике страницы продолжают показывать
цены с пометкой происхождения, стакан при этом отдаёт пустоту, а не старую
книгу, и `/api/market/status` честно показывает отказы.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import market_data
from backend.config import BackendConfig
from backend.main import create_app
from backend.sources import binance, cache, registry
from core.weex import get_weex_client


class БезBinance:
    """Второго источника в этих тестах нет: здесь проверяется кэш, а не подмена.

    Пустая сводка означает, что список пар биржи неизвестен, и карта
    соответствия подменять отказывается - ровно так же, как в бою, когда
    Binance недоступен из нашей сети.
    """

    blocked = False
    blocked_for = 0.0

    async def tickers_24h(self) -> list[dict]:
        return []


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/market.sqlite3")
    cache.reset()
    registry.reset()
    binance.reset()
    monkeypatch.setattr(binance, "rest", lambda: БезBinance())
    # Нулевой срок жизни: иначе второй запрос в том же тесте отдаст первое
    # значение из кэша и падение источника останется незамеченным.
    monkeypatch.setattr(market_data, "TTL_PRICE", 0)
    monkeypatch.setattr(market_data, "TTL_BOOK", 0)
    monkeypatch.setattr(market_data, "TTL_TICKERS", 0)
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    with TestClient(create_app(config=config, weex=get_weex_client(use_mock=True))) as c:
        yield c
    cache.reset()
    registry.reset()
    binance.reset()


def _weex_отвечает(monkeypatch, answers: dict[str, object]):
    """Подменить обращение к WEEX: путь -> ответ. Пути нет - источник падает."""

    async def fake(path: str, params: dict | None = None):
        if path not in answers:
            raise RuntimeError("WEEX HTTP 502")
        return answers[path]

    monkeypatch.setattr(market_data, "_weex_raw", fake)


DEPTH = {"bids": [["100", "1"]], "asks": [["101", "2"]]}
# Ответ `/capi/v2/market/tickers`: биржа отдаёт все пары разом, зовёт их
# `cmt_btcusdt`, а изменение цены даёт долей - 0.005 это полпроцента.
TICKERS = [
    {"symbol": "cmt_btcusdt", "last": "100.5", "priceChangePercent": "0.005",
     "volume_24h": "1000000", "timestamp": "1789000000"},
    {"symbol": "cmt_ethusdt", "last": "4000", "priceChangePercent": "-0.012",
     "volume_24h": "500000", "timestamp": "1789000000"},
]


# ── Происхождение в ответе ───────────────────────────────────────────────────


def test_цена_подписана_источником(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v2/market/tickers": TICKERS})

    answer = client.get("/api/market/tickers").json()
    assert answer["source"] == "weex"
    assert answer["stale"] is False
    assert answer["tickers"][0]["price"] == "100.5"
    # Процент больше не ноль: без него тепловую карту рисовать нечем.
    assert answer["tickers"][0]["priceChangePercent"] == "0.50"


def test_стакан_подписан_источником(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v3/market/depth": DEPTH})

    answer = client.get("/api/market/orderbook/BTCUSDT").json()
    assert (answer["source"], answer["stale"]) == ("weex", False)
    assert answer["bids"] == [["100", "1"]]


# ── Источник упал ────────────────────────────────────────────────────────────


def test_упавший_источник_не_обнуляет_цены_но_помечает_их(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v2/market/tickers": TICKERS})
    client.get("/api/market/tickers")

    _weex_отвечает(monkeypatch, {})  # WEEX выключен целиком
    answer = client.get("/api/market/tickers").json()

    assert answer["stale"] is True
    assert answer["source"] == "weex"
    assert answer["tickers"][0]["price"] == "100.5"


def test_стакан_устаревшим_не_бывает(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v3/market/depth": DEPTH})
    assert client.get("/api/market/orderbook/BTCUSDT").json()["bids"]

    _weex_отвечает(monkeypatch, {})
    answer = client.get("/api/market/orderbook/BTCUSDT")

    # Не 502 - страница жива; но и старой книги в ответе нет.
    assert answer.status_code == 200
    assert answer.json() == {
        "symbol": "BTCUSDT", "bids": [], "asks": [], "source": None, "stale": False,
    }


# ── Состояние источников ─────────────────────────────────────────────────────


def test_состояние_показывает_удачи_и_отказы(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v3/market/depth": DEPTH})
    client.get("/api/market/orderbook/BTCUSDT")

    _weex_отвечает(monkeypatch, {})
    client.get("/api/market/orderbook/BTCUSDT")

    state = client.get("/api/market/status").json()
    weex = next(s for s in state["sources"] if s["name"] == "weex")

    assert weex["ok"] >= 1
    assert weex["failed"] >= 1
    assert "502" in weex["last_error"]
    assert weex["last_success"] is not None
    assert weex["blocked_until"] is None
    assert state["cache"]["keys"] >= 1


def test_состояние_считает_отданное_устаревшее(client, monkeypatch):
    _weex_отвечает(monkeypatch, {"/capi/v2/market/tickers": TICKERS})
    client.get("/api/market/tickers")

    _weex_отвечает(monkeypatch, {})
    client.get("/api/market/tickers")

    state = client.get("/api/market/status").json()
    assert state["cache"]["stale_served_last_hour"] >= 1


def test_состояние_открыто_без_токена(client, monkeypatch):
    _weex_отвечает(monkeypatch, {})
    assert client.get("/api/market/status").status_code == 200
