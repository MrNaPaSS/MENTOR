"""Binance вторым источником: где подмена разрешена, а где запрещена (ТЗ этап 2).

Критерий приёмки: при подменённом WEEX цена, стакан, свечи и лента приходят от
Binance с `source: "binance"`; финансирование и открытый интерес в том же
положении приходят пустыми, а не числами Binance; пара вне карты фолбэка не
получает; множитель цены применён.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import market_data
from backend.config import BackendConfig
from backend.main import create_app
from backend.sources import binance, cache, registry
from core.weex import get_weex_client


# ── Поддельная биржа ─────────────────────────────────────────────────────────


class FakeBinance:
    """Клиент фьючерсов Binance ровно в том объёме, в каком им пользуется слой."""

    def __init__(self, *, blocked: bool = False, tickers: list[dict] | None = None):
        self.blocked = blocked
        self.blocked_for = 60.0 if blocked else 0.0
        self.calls: list[str] = []
        self._tickers = tickers if tickers is not None else [
            {"symbol": "BTCUSDT", "lastPrice": "100.5", "closeTime": 1789000000000},
            {"symbol": "ETHUSDT", "lastPrice": "4000", "closeTime": 1789000000000},
            {"symbol": "SOLUSDT", "lastPrice": "200", "closeTime": 1789000000000},
            {"symbol": "POLUSDT", "lastPrice": "0.5", "closeTime": 1789000000000},
            {"symbol": "1000PEPEUSDT", "lastPrice": "12.0", "closeTime": 1789000000000},
        ]

    async def tickers_24h(self) -> list[dict]:
        self.calls.append("tickers_24h")
        return self._tickers

    async def depth(self, symbol: str, limit: int = 100, background: bool = True) -> dict:
        self.calls.append(f"depth:{symbol}")
        return {"bids": [["12.0", "5"]], "asks": [["12.5", "7"]]}

    async def klines(self, symbol: str, interval: str = "1m", limit: int = 240) -> list[list]:
        self.calls.append(f"klines:{symbol}")
        # Раскладка колонок как у WEEX: время, открытие, максимум, минимум,
        # закрытие, объём, время закрытия, оборот.
        return [[1789000000000, "90", "110", "80", "100.5", "1000", 1789000086400, "99000"]]

    async def agg_trades(self, symbol: str, start_ms: int, end_ms: int,
                         limit: int = 1000, from_id: int | None = None) -> list[dict]:
        self.calls.append(f"agg_trades:{symbol}")
        return [{"p": "100.5", "q": "2", "T": 1789000000000, "m": True}]


@pytest.fixture
def fake() -> FakeBinance:
    return FakeBinance()


@pytest.fixture
def client(tmp_path, monkeypatch, fake) -> TestClient:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/fallback.sqlite3")
    cache.reset()
    registry.reset()
    binance.reset()
    monkeypatch.setattr(binance, "rest", lambda: fake)
    # Нулевой срок жизни: тест смотрит на подмену, а не на работу кэша.
    monkeypatch.setattr(market_data, "TTL_PRICE", 0)
    monkeypatch.setattr(market_data, "TTL_BOOK", 0)
    monkeypatch.setattr(market_data, "TTL_KLINES", 0)
    monkeypatch.setattr(market_data, "TTL_FUNDING", 0)

    async def weex_упал(path: str, params: dict | None = None):
        raise RuntimeError("WEEX HTTP 502")

    monkeypatch.setattr(market_data, "_weex_raw", weex_упал)

    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    with TestClient(create_app(config=config, weex=get_weex_client(use_mock=True))) as c:
        yield c
    cache.reset()
    registry.reset()
    binance.reset()


# ── Где подмена разрешена ────────────────────────────────────────────────────


def test_цена_приходит_от_binance_с_подписью(client):
    answer = client.get("/api/market/tickers").json()

    assert answer["source"] == "binance"
    assert answer["stale"] is False
    btc = next(r for r in answer["tickers"] if r["symbol"] == "BTCUSDT")
    assert btc["price"] == "100.5"


def test_стакан_приходит_от_binance(client):
    answer = client.get("/api/market/orderbook/BTCUSDT").json()

    assert answer["source"] == "binance"
    assert answer["bids"] == [["12.0", "5"]]
    assert answer["asks"] == [["12.5", "7"]]


def test_свечи_и_цена_суточной_статистики_от_binance(client):
    answer = client.get("/api/market/ticker/BTCUSDT")

    assert answer.status_code == 200
    body = answer.json()
    assert body["source"] == "binance"
    assert body["lastPrice"] == "100.5"
    assert body["openPrice"] == "90"


def test_лента_сделок_от_binance(client, fake):
    answer = client.get("/api/market/trades/BTCUSDT").json()

    assert answer["source"] == "binance"
    assert answer["trades"][0]["price"] == "100.5"
    # Сторона сделки переворачивается так же, как у WEEX: maker покупателя
    # означает, что рынок продавал.
    assert answer["trades"][0]["isBuy"] is False


# ── Где подмена запрещена ────────────────────────────────────────────────────


def test_финансирование_второго_источника_не_получает(client, fake):
    answer = client.get("/api/market/funding-rates").json()

    assert answer["source"] is None
    assert all(row["fundingRate"] == "0" for row in answer["rates"])
    assert all(row["nextFundingTime"] is None for row in answer["rates"])
    # До биржи дело не дошло вовсе: ставка принадлежит WEEX.
    assert not any(c.startswith("depth") or c.startswith("klines") for c in fake.calls)


def test_открытый_интерес_второго_источника_не_получает(client):
    answer = client.get("/api/market/open-interest/BTCUSDT").json()

    assert answer["source"] is None
    assert answer["open_interest"] is None


def test_производные_отдают_цену_но_молчат_о_фандинге(client):
    body = client.get("/api/market/derivatives/BTCUSDT").json()

    assert body["lastPrice"] == 100.5
    assert body["fundingRate"] is None
    assert body["openInterestUsd"] is None
    # Цена и свечи от Binance, ставка и интерес ниоткуда - это смесь.
    assert body["source"] == "binance"


# ── Карта пар ────────────────────────────────────────────────────────────────


def test_пара_вне_карты_фолбэка_не_получает(client, fake):
    answer = client.get("/api/market/orderbook/WEIRDUSDT").json()

    assert answer == {
        "symbol": "WEIRDUSDT", "bids": [], "asks": [], "source": None, "stale": False,
    }
    assert not any(c.startswith("depth") for c in fake.calls)


def test_переименованная_пара_подменяется_по_карте(client):
    answer = client.get("/api/market/tickers").json()

    matic = next(r for r in answer["tickers"] if r["symbol"] == "MATICUSDT")
    assert matic["price"] == "0.5"  # взято у POLUSDT


def test_множитель_цены_применён(client):
    """1000PEPEUSDT котируется за тысячу монет: без деления скачок в тысячу раз."""
    answer = client.get("/api/market/orderbook/PEPEUSDT").json()

    assert answer["source"] == "binance"
    assert answer["bids"] == [["0.012", "5"]]
    assert answer["asks"] == [["0.0125", "7"]]


# ── Самоблокировка и доступность ─────────────────────────────────────────────


def test_заблокированный_клиент_не_беспокоят(tmp_path, monkeypatch):
    cache.reset()
    registry.reset()
    binance.reset()
    blocked = FakeBinance(blocked=True)
    monkeypatch.setattr(binance, "rest", lambda: blocked)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/blocked.sqlite3")
    monkeypatch.setattr(market_data, "TTL_BOOK", 0)

    async def weex_упал(path: str, params: dict | None = None):
        raise RuntimeError("WEEX HTTP 502")

    monkeypatch.setattr(market_data, "_weex_raw", weex_упал)
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    with TestClient(create_app(config=config, weex=get_weex_client(use_mock=True))) as c:
        answer = c.get("/api/market/orderbook/BTCUSDT").json()

    assert answer["source"] is None
    # Стакан у заблокированного клиента не спрашивали (проверка доступности на
    # старте приложения - отдельное дело, она к книге не относится).
    assert not any(c.startswith("depth") for c in blocked.calls)
    assert next(s for s in registry.stats() if s.name == "binance").blocked_until is not None
    cache.reset()
    registry.reset()
    binance.reset()


async def test_молчащая_биржа_закрывается_на_час(monkeypatch):
    cache.reset()
    registry.reset()
    binance.reset()
    monkeypatch.setattr(binance, "rest", lambda: FakeBinance(tickers=[]))

    assert await binance.probe() is False

    row = next(s for s in registry.stats() if s.name == "binance")
    assert row.blocked_until is not None
    assert binance.UNAVAILABLE_BLOCK_SECONDS == 3600
    registry.reset()
    binance.reset()


async def test_отвечающая_биржа_остаётся_открытой(monkeypatch):
    cache.reset()
    registry.reset()
    binance.reset()
    monkeypatch.setattr(binance, "rest", lambda: FakeBinance())

    assert await binance.probe() is True
    assert registry.is_blocked("binance") is False
    registry.reset()
    binance.reset()
