"""Серверный кэш ручек Smart Money и потоков ETF.

Раньше каждая загрузка ходила в CFTC, Yahoo и Nasdaq заново - на каждого
ученика, и страница открывалась секундами. Проверяем: второй запрос не трогает
источник, молчащий источник не превращает живые цифры в демо, а пустой ответ в
кэш не кладётся.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import institutional
from backend.config import BackendConfig
from backend.main import create_app
from backend.sources import cache
from core.weex import get_weex_client


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/inst.sqlite3")
    cache.reset()
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    yield TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))
    cache.reset()


ETF_LIVE = {
    "etfs": [{"name": "BlackRock IBIT", "ticker": "IBIT", "btc": 340000, "price": 61.2,
              "change": 0.8, "changePct": 1.3, "sharePct": 100.0}],
    "total_btc": 340000,
    "btc_price": 105000,
}


# ── Потоки ETF ───────────────────────────────────────────────────────────────


def test_второй_запрос_etf_не_трогает_источники(client, monkeypatch):
    calls: list[int] = []

    async def live():
        calls.append(1)
        return ETF_LIVE

    monkeypatch.setattr(institutional, "_etf_flows_live", live)

    first = client.get("/api/institutional/etf-flows").json()
    second = client.get("/api/institutional/etf-flows").json()

    assert first["etfs"][0]["ticker"] == "IBIT"
    assert second["etfs"][0]["ticker"] == "IBIT"
    assert len(calls) == 1


def test_молчащий_nasdaq_не_стирает_живые_цифры(client, monkeypatch):
    async def live():
        return ETF_LIVE

    monkeypatch.setattr(institutional, "_etf_flows_live", live)
    client.get("/api/institutional/etf-flows")

    async def silent():
        return None

    monkeypatch.setattr(institutional, "_etf_flows_live", silent)
    monkeypatch.setattr(institutional, "ETF_TTL", 0)

    body = client.get("/api/institutional/etf-flows").json()
    assert body["etfs"][0]["btc"] == 340000
    assert body["stale"] is True


def test_без_данных_вовсе_страница_получает_пустоту_для_демо(client, monkeypatch):
    async def silent():
        return None

    monkeypatch.setattr(institutional, "_etf_flows_live", silent)

    body = client.get("/api/institutional/etf-flows").json()
    assert body == {"etfs": [], "total_btc": 0, "btc_price": 0, "stale": False}


# ── Макро ────────────────────────────────────────────────────────────────────


def test_макро_кэшируется_и_молчание_даёт_демо_только_без_памяти(client, monkeypatch):
    calls: list[int] = []

    async def yahoo(url, params=None, headers=None):
        calls.append(1)
        return {"chart": {"result": [{"meta": {"regularMarketPrice": 100, "chartPreviousClose": 99}}]}}

    monkeypatch.setattr(institutional, "_get", yahoo)

    first = client.get("/api/institutional/macro").json()
    asked = len(calls)
    second = client.get("/api/institutional/macro").json()

    assert first["demo"] is False
    assert second["demo"] is False
    assert len(calls) == asked  # второй раз источник не спрашивали


def test_недостающая_строка_макро_помечена_а_не_выдана_за_живую(client, monkeypatch):
    """Yahoo ответил по части индикаторов: блок живой, а пропуски подписаны.

    Раньше молчащий индикатор подставлял демо-цифру, и она считалась живой -
    при полном молчании Yahoo весь блок уходил с `demo: false` на выдуманных
    числах.
    """
    answered = {"DX-Y.NYB", "^TNX", "^GSPC"}

    async def partly(url, params=None, headers=None):
        symbol = url.rsplit("/", 1)[-1]
        if symbol not in answered:
            return None
        return {"chart": {"result": [{"meta": {"regularMarketPrice": 100, "chartPreviousClose": 99}}]}}

    monkeypatch.setattr(institutional, "_get", partly)

    body = client.get("/api/institutional/macro").json()
    assert body["demo"] is False
    assert body["indicators"]["DXY"]["price"] == 100
    assert "demo" not in body["indicators"]["DXY"]
    assert body["indicators"]["VIX"]["demo"] is True


def test_макро_без_источника_и_без_памяти_это_демо(client, monkeypatch):
    async def silent(url, params=None, headers=None):
        return None

    monkeypatch.setattr(institutional, "_get", silent)

    assert client.get("/api/institutional/macro").json()["demo"] is True


# ── COT ──────────────────────────────────────────────────────────────────────


def test_cot_второй_запрос_не_идёт_в_cftc(client, monkeypatch):
    calls: list[int] = []
    row = {"report_date_as_yyyy_mm_dd": "2026-09-09T00:00:00", "open_interest_all": 1}

    async def cftc(asset, weeks):
        calls.append(1)
        return [row]

    monkeypatch.setattr(institutional, "_fetch_cftc", cftc)

    first = client.get("/api/institutional/cot/BTC").json()
    client.get("/api/institutional/cot/BTC")

    assert first["demo"] is False
    assert first["as_of"] == "2026-09-09"
    assert len(calls) == 1


def test_прогрев_выключен_в_конфиге_по_умолчанию():
    """Конфиг, собранный руками (как в тестах), не ходит в чужие источники сам."""
    config = BackendConfig(
        jwt_secret="x", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    assert config.institutional_warm is False
