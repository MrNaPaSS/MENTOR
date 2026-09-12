"""Календарь событий: разбор, фильтры и время (ТЗ этап 4, §7.1).

Оставляем только то, что двигает крипту: важность high и medium, валюты USD и
EUR. Время приводим к UTC - час ошибки в календаре означает другое событие.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from backend.sources import cache, econcalendar, registry
from core.weex import get_weex_client


SNAPSHOT = [
    {
        "title": "Core CPI m/m",
        "country": "USD",
        "date": "2026-09-15T08:30:00-04:00",
        "impact": "High",
        "forecast": "0.3%",
        "previous": "0.2%",
    },
    {
        "title": "ECB Main Refinancing Rate",
        "country": "EUR",
        "date": "2026-09-17T08:15:00-04:00",
        "impact": "Medium",
        "forecast": "2.15%",
        "previous": "2.15%",
        "actual": "2.00%",
    },
    {
        "title": "RBNZ Official Cash Rate",
        "country": "NZD",
        "date": "2026-09-16T22:00:00-04:00",
        "impact": "High",
    },
    {
        "title": "Flash Manufacturing PMI",
        "country": "USD",
        "date": "2026-09-18T09:45:00-04:00",
        "impact": "Low",
    },
    {
        "title": "Bank Holiday",
        "country": "EUR",
        "date": "2026-09-19T00:00:00-04:00",
        "impact": "Holiday",
    },
]


@pytest.fixture(autouse=True)
def чистый_слой():
    cache.reset()
    registry.reset()
    yield
    cache.reset()
    registry.reset()


# ── Разбор ───────────────────────────────────────────────────────────────────


def test_остаются_только_доллар_и_евро_и_только_важное():
    events = econcalendar.parse(SNAPSHOT)

    assert [e["title"] for e in events] == ["Core CPI m/m", "ECB Main Refinancing Rate"]
    assert {e["currency"] for e in events} == {"USD", "EUR"}
    assert {e["importance"] for e in events} == {"high", "medium"}


def test_время_приводится_к_utc():
    events = econcalendar.parse(SNAPSHOT)

    # 08:30 по нью-йоркскому летнему времени это 12:30 UTC.
    assert events[0]["time"] == "2026-09-15T12:30:00+00:00"


def test_события_идут_по_времени():
    events = econcalendar.parse(list(reversed(SNAPSHOT)))
    assert [e["time"] for e in events] == sorted(e["time"] for e in events)


def test_факт_и_прогноз_доезжают_как_есть():
    ecb = econcalendar.parse(SNAPSHOT)[1]

    assert ecb["forecast"] == "2.15%"
    assert ecb["previous"] == "2.15%"
    assert ecb["actual"] == "2.00%"


def test_событие_без_факта_отдаёт_пустую_строку():
    cpi = econcalendar.parse(SNAPSHOT)[0]
    assert cpi["actual"] == ""


def test_мусор_не_роняет_разбор():
    assert econcalendar.parse(None) == []
    assert econcalendar.parse("ответ не тот") == []
    assert econcalendar.parse([None, 42, {}]) == []


def test_время_без_пояса_не_берём():
    """Без зоны час считать нельзя, а угаданный час это другое событие."""
    rows = [{"title": "CPI", "country": "USD", "impact": "High", "date": "2026-09-15 08:30:00"}]
    assert econcalendar.parse(rows) == []


# ── Ручка ────────────────────────────────────────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/calendar.sqlite3")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    return TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))


def test_ручка_отдаёт_события_с_подписью_источника(client, monkeypatch):
    async def fake():
        return econcalendar.parse(SNAPSHOT)

    monkeypatch.setattr(econcalendar, "fetch", fake)

    body = client.get("/api/market/calendar").json()
    assert body["source"] == econcalendar.NAME
    assert body["stale"] is False
    assert len(body["events"]) == 2


def test_источник_упал_вкладка_остаётся_пустой_а_не_сломанной(client, monkeypatch):
    async def упал():
        raise RuntimeError("Календарь HTTP 404")

    monkeypatch.setattr(econcalendar, "fetch", упал)

    answer = client.get("/api/market/calendar")
    assert answer.status_code == 200
    assert answer.json() == {"events": [], "source": None, "stale": False}


def test_вчерашний_календарь_лучше_пустой_вкладки(client, monkeypatch):
    async def живой():
        return econcalendar.parse(SNAPSHOT)

    monkeypatch.setattr(econcalendar, "fetch", живой)
    client.get("/api/market/calendar")

    async def упал():
        raise RuntimeError("Календарь HTTP 404")

    monkeypatch.setattr(econcalendar, "fetch", упал)
    # Срок жизни прошёл, но сутки устаревания ещё нет.
    monkeypatch.setattr(econcalendar, "TTL", 0)

    body = client.get("/api/market/calendar").json()
    assert body["stale"] is True
    assert len(body["events"]) == 2
