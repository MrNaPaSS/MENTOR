"""Тесты партнёрской статистики WEEX в админке (только ментор)."""

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/aff.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    cfg = BackendConfig(
        jwt_secret="s", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
    )
    return TestClient(create_app(config=cfg, weex=get_weex_client(use_mock=True)))


def _mentor(client):
    tok = client.post("/api/auth/mentor-login", params={"password": "secret"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def test_affiliate_requires_mentor(client):
    assert client.get("/api/admin/affiliate/overview").status_code == 401


def test_overview(client):
    r = client.get("/api/admin/affiliate/overview", headers=_mentor(client))
    assert r.status_code == 200
    d = r.json()
    assert d["referrals"] >= 1
    assert float(d["total_deposit"]) > 0
    assert float(d["total_futures_volume"]) >= 0
    assert d["period_days"] == 30


def test_referrals_table(client):
    r = client.get("/api/admin/affiliate/referrals", headers=_mentor(client), params={"days": 60})
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    row = rows[0]
    assert "uid" in row and "deposit" in row and "futures_volume" in row
    # отсортировано по объёму убыв.
    vols = [float(x["spot_volume"]) + float(x["futures_volume"]) for x in rows]
    assert vols == sorted(vols, reverse=True)


def test_uid_balance(client):
    r = client.get("/api/admin/affiliate/uid/3066862172/balance", headers=_mentor(client))
    assert r.status_code == 200
    assert float(r.json()["available_balance"]) >= 0


def test_commission_series(client):
    r = client.get("/api/admin/affiliate/commission-series", headers=_mentor(client), params={"days": 14})
    assert r.status_code == 200
    points = r.json()
    assert len(points) >= 1
    p = points[0]
    assert "date" in p and "commission" in p and "spot" in p and "futures" in p
    # отсортировано по дате по возрастанию
    dates = [x["date"] for x in points]
    assert dates == sorted(dates)
