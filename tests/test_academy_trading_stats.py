"""Сводка по торговле ученика для мини-аппа академии.

Проверяется не «ручка отвечает 200», а сами числа: раздел академии и журнал
кабинета показывают одному человеку одни и те же цифры, и расхождение в
винрейте между двумя экранами читается как сломанные данные.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import academy_trading as academy_api
from backend.config import BackendConfig
from backend.deps import get_config, get_session
from core.db import Base
from core.models import ScalpTrade, Student

SERVICE_KEY = "academy-secret-key"
HEADERS = {"X-Service-Key": SERVICE_KEY}


def _config(service_api_key: str = SERVICE_KEY) -> BackendConfig:
    return BackendConfig(
        jwt_secret="x",
        access_ttl_seconds=900,
        refresh_ttl_seconds=3600,
        weex_use_mock=True,
        code_ttl_seconds=300,
        max_code_attempts=3,
        expose_codes=False,
        service_api_key=service_api_key,
    )


@pytest.fixture()
def session():
    # StaticPool обязателен: без него каждое соединение к ":memory:" получает
    # собственную пустую базу, и таблиц, созданных здесь, ручка не увидит.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    made = Session()
    yield made
    made.close()


def _client(session, *, service_api_key: str = SERVICE_KEY) -> TestClient:
    app = FastAPI()
    app.include_router(academy_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_config] = lambda: _config(service_api_key)
    return TestClient(app)


@pytest.fixture()
def client(session):
    return _client(session)


def student(session, **over) -> Student:
    row = Student(tg_id=over.pop("tg_id", 7001), username="tester", **over)
    session.add(row)
    session.commit()
    return row


def trade(session, student_id: int, **over) -> ScalpTrade:
    # Сделка по умолчанию свежая: окно сводки считается от сегодняшнего дня, и
    # на фиксированной дате тест начал бы врать через месяц после написания.
    closed = over.pop("closed_at", datetime.now(timezone.utc) - timedelta(hours=1))
    fields = dict(
        client_id=f"c{over.pop('n', session.query(ScalpTrade).count() + 1)}",
        symbol="BTCUSDT",
        side="long",
        entry=100.0,
        stop=90.0,
        exit_price=110.0,
        qty=1.0,
        margin=10.0,
        leverage=10,
        outcome="take",
        pnl=10.0,
        fee=0.5,
        exchange="weex",
        opened_at=closed - timedelta(minutes=30),
        closed_at=closed,
    )
    fields.update(over)
    row = ScalpTrade(student_id=student_id, **fields)
    session.add(row)
    session.commit()
    return row


def summary(client, **params) -> dict:
    query = {"tg_id": 7001}
    query.update(params)
    # Пустой параметр не отправляем вовсе: `None` уходит в запрос пустой
    # строкой, и разбор числа падает раньше, чем ручка что-то решит.
    query = {key: value for key, value in query.items() if value is not None}
    response = client.get("/api/academy/trading/summary", params=query, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


# ── Доступ ───────────────────────────────────────────────────────────────────

def test_requires_service_key(client):
    r = client.get("/api/academy/trading/summary", params={"tg_id": 1})
    assert r.status_code == 401


def test_rejects_wrong_key(client):
    r = client.get(
        "/api/academy/trading/summary",
        params={"tg_id": 1},
        headers={"X-Service-Key": "wrong-key"},
    )
    assert r.status_code == 401


def test_closed_when_key_not_configured(session):
    """Пустой SERVICE_API_KEY - интеграции нет, и торговлю ученика не выдаём."""
    r = _client(session, service_api_key="").get(
        "/api/academy/trading/summary", params={"tg_id": 1}, headers=HEADERS
    )
    assert r.status_code == 503


def test_needs_any_key(client):
    r = client.get("/api/academy/trading/summary", headers=HEADERS)
    assert r.status_code == 400


# ── Кого нашли ───────────────────────────────────────────────────────────────

def test_unknown_student_is_not_an_error(client):
    """Ученик, которого у нас нет, - обычное состояние новичка, а не сбой."""
    data = summary(client, tg_id=999999)
    assert data["exists"] is False
    assert data["has_trades"] is False
    assert data["summary"]["trades"] == 0


def test_found_by_weex_uid(client, session):
    student(session, tg_id=7002, weex_uid="9001")
    data = summary(client, tg_id=None, weex_uid="9001")
    assert data["exists"] is True
    assert data["weex_uid"] == "9001"


def test_student_without_trades(client, session):
    student(session)
    data = summary(client)
    assert data["exists"] is True
    assert data["has_trades"] is False
    assert data["summary"]["net"] == 0
    assert data["by_day"] == []
    assert data["top_symbols"] == []


# ── Числа ────────────────────────────────────────────────────────────────────

def test_counts_wins_losses_and_flat(client, session):
    row = student(session)
    trade(session, row.id, pnl=30.0, n=1)
    trade(session, row.id, pnl=10.0, n=2)
    trade(session, row.id, pnl=-20.0, n=3, outcome="stop")
    trade(session, row.id, pnl=0.0, n=4, outcome="manual")

    got = summary(client)["summary"]
    assert got["trades"] == 4
    assert got["wins"] == 2
    assert got["losses"] == 1
    assert got["flat"] == 1
    # Винрейт считается от решённых сделок: ноль не победа и не поражение.
    assert got["win_rate"] == pytest.approx(2 / 3)
    assert got["net"] == pytest.approx(20.0)
    assert got["gross"] == pytest.approx(40.0)
    assert got["drawn"] == pytest.approx(20.0)
    assert got["profit_factor"] == pytest.approx(2.0)
    assert got["avg_win"] == pytest.approx(20.0)
    assert got["avg_loss"] == pytest.approx(20.0)
    assert got["expectancy"] == pytest.approx(5.0)
    assert got["best"] == pytest.approx(30.0)
    assert got["worst"] == pytest.approx(-20.0)
    assert got["fees"] == pytest.approx(2.0)


def test_profit_factor_without_losses(client, session):
    """Убытков не было - делить не на что, и выдумывать число нельзя."""
    row = student(session)
    trade(session, row.id, pnl=10.0, n=1)
    assert summary(client)["summary"]["profit_factor"] is None


def test_volume_counts_both_legs(client, session):
    """Оборот - вход и выход вместе: комиссию биржа берёт с каждого."""
    row = student(session)
    trade(session, row.id, qty=2.0, entry=100.0, exit_price=110.0, n=1)
    assert summary(client)["summary"]["volume"] == pytest.approx(420.0)


def test_average_r_from_stop_distance(client, session):
    """Риск сделки - расстояние до стопа, взятое объёмом."""
    row = student(session)
    trade(session, row.id, entry=100.0, stop=90.0, qty=1.0, pnl=20.0, n=1)
    assert summary(client)["summary"]["avg_r"] == pytest.approx(2.0)


def test_drawdown_measured_from_peak(client, session):
    row = student(session)
    now = datetime.now(timezone.utc)
    trade(session, row.id, pnl=100.0, n=1, closed_at=now - timedelta(hours=3))
    trade(session, row.id, pnl=-40.0, n=2, closed_at=now - timedelta(hours=2))
    trade(session, row.id, pnl=10.0, n=3, closed_at=now - timedelta(hours=1))

    got = summary(client)["summary"]
    assert got["drawdown"] == pytest.approx(40.0)
    assert got["drawdown_pct"] == pytest.approx(0.4)


def test_hold_minutes(client, session):
    row = student(session)
    closed = datetime.now(timezone.utc) - timedelta(hours=1)
    trade(session, row.id, n=1, closed_at=closed, opened_at=closed - timedelta(minutes=20))
    assert summary(client)["summary"]["hold_minutes"] == pytest.approx(20.0)


# ── Разрезы ──────────────────────────────────────────────────────────────────

def test_by_day_groups_in_utc(client, session):
    row = student(session)
    now = datetime.now(timezone.utc)
    trade(session, row.id, pnl=10.0, n=1, closed_at=now - timedelta(hours=2))
    trade(session, row.id, pnl=-4.0, n=2, closed_at=now - timedelta(hours=1), outcome="stop")

    days = summary(client)["by_day"]
    assert len(days) == 1
    assert days[0]["date"] == now.strftime("%Y-%m-%d")
    assert days[0]["pnl"] == pytest.approx(6.0)
    assert days[0]["trades"] == 2
    assert days[0]["wins"] == 1
    assert days[0]["losses"] == 1


def test_by_exchange_keeps_accounts_apart(client, session):
    """Суммы разных бирж не складываются: одна строка отчёта - одна биржа."""
    row = student(session)
    trade(session, row.id, pnl=10.0, n=1, exchange="weex")
    trade(session, row.id, pnl=-3.0, n=2, exchange="okx", outcome="stop")
    trade(session, row.id, pnl=5.0, n=3, exchange="okx")

    by_exchange = {cell["exchange"]: cell for cell in summary(client)["by_exchange"]}
    assert by_exchange["okx"]["trades"] == 2
    assert by_exchange["okx"]["pnl"] == pytest.approx(2.0)
    assert by_exchange["weex"]["pnl"] == pytest.approx(10.0)


def test_old_records_belong_to_weex(client, session):
    """Запись сопровождения без кода биржи - WEEX: других счетов тогда не было."""
    row = student(session)
    trade(session, row.id, n=1, exchange=None, from_exchange=True)
    assert summary(client)["by_exchange"][0]["exchange"] == "weex"


def test_top_symbols_sorted_by_trades(client, session):
    row = student(session)
    trade(session, row.id, symbol="ETHUSDT", pnl=1.0, n=1)
    trade(session, row.id, symbol="ETHUSDT", pnl=2.0, n=2)
    trade(session, row.id, symbol="BTCUSDT", pnl=50.0, n=3)

    top = summary(client)["top_symbols"]
    assert [row["symbol"] for row in top] == ["ETHUSDT", "BTCUSDT"]
    assert top[0]["pnl"] == pytest.approx(3.0)


# ── Окно ─────────────────────────────────────────────────────────────────────

def test_window_cuts_old_trades(client, session):
    row = student(session)
    now = datetime.now(timezone.utc)
    trade(session, row.id, pnl=7.0, n=1, closed_at=now - timedelta(days=2))
    trade(session, row.id, pnl=100.0, n=2, closed_at=now - timedelta(days=40))

    assert summary(client, days=30)["summary"]["net"] == pytest.approx(7.0)
    assert summary(client, days=365)["summary"]["net"] == pytest.approx(107.0)


def test_window_bounds(client, session):
    student(session)
    assert client.get(
        "/api/academy/trading/summary",
        params={"tg_id": 7001, "days": 0},
        headers=HEADERS,
    ).status_code == 422
    assert client.get(
        "/api/academy/trading/summary",
        params={"tg_id": 7001, "days": 4000},
        headers=HEADERS,
    ).status_code == 422


def test_other_students_are_not_mixed_in(client, session):
    mine = student(session)
    alien = student(session, tg_id=7003)
    trade(session, mine.id, pnl=5.0, n=1)
    trade(session, alien.id, pnl=999.0, n=2)

    assert summary(client)["summary"]["net"] == pytest.approx(5.0)


# ── Что показать, когда торговли нет ─────────────────────────────────────────

def test_last_trades_are_capped(client, session):
    row = student(session)
    now = datetime.now(timezone.utc)
    for i in range(12):
        trade(session, row.id, n=i, closed_at=now - timedelta(hours=i + 1))

    last = summary(client, limit=5)["last_trades"]
    assert len(last) == 5
    # Сверху свежая: раздел академии показывает «что было только что».
    assert last[0]["closed_at"] > last[-1]["closed_at"]


def test_points_to_cabinet(client, session):
    """Ученику без торговли нужна дорога туда, где она начинается."""
    student(session)
    data = summary(client)
    assert data["cabinet_url"].endswith("/app/journal")
