"""Журнал сделок: запись, идемпотентность, календарь и шаблон рабочего места.

Журнал кормит статистику трейдера и календарь прибыли, поэтому проверяется не
«ручка отвечает 200», а то, что цифры в ней складываются правильно и что
повторная отправка не удваивает результат.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import journal as journal_api
from backend.deps import get_current_student, get_session
from core.db import Base
from core.models import Student

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def client():
    # StaticPool обязателен: без него каждое соединение к ":memory:" получает
    # собственную пустую базу, и таблицы, созданные здесь, сессия не увидит.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    session = Session()

    student = Student(tg_id=1, username="tester")
    session.add(student)
    session.commit()

    app = FastAPI()
    app.include_router(journal_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student
    # Доступ к разделу проверяется отдельно — здесь он не предмет теста.

    with TestClient(app) as c:
        yield c
    session.close()


def trade(**over):
    # По умолчанию сделка свежая: окно журнала считается от сегодняшнего дня, и
    # на фиксированной дате тест начал бы врать через три месяца после написания.
    closed = over.pop("closed_at", datetime.now(timezone.utc) - timedelta(minutes=5))
    body = {
        "client_id": "t1",
        "symbol": "btcusdt",
        "side": "long",
        "entry": 100.0,
        "stop": 99.0,
        "exit_price": 103.0,
        "qty": 10.0,
        "margin": 100.0,
        "leverage": 10,
        "takes_hit": 3,
        "outcome": "take",
        "pnl": 30.0,
        "opened_at": closed.isoformat(),
        "closed_at": closed.isoformat(),
        "note": "",
    }
    body.update(over)
    return body


def test_trade_is_stored_with_normalised_symbol(client):
    body = client.post("/api/journal/trades", json=trade()).json()
    assert body["symbol"] == "BTCUSDT"
    assert body["pnl"] == 30.0


def test_repeated_send_updates_instead_of_duplicating(client):
    """Обрыв связи не должен удваивать сделку в статистике."""
    client.post("/api/journal/trades", json=trade())
    client.post("/api/journal/trades", json=trade(pnl=25.0))

    listing = client.get("/api/journal/trades").json()
    assert listing["summary"]["count"] == 1
    assert listing["summary"]["pnl"] == 25.0


def test_summary_counts_wins_and_losses(client):
    client.post("/api/journal/trades", json=trade(client_id="a", pnl=30.0))
    client.post("/api/journal/trades", json=trade(client_id="b", pnl=-10.0, outcome="stop"))
    # Безубыток: не победа и не поражение.
    client.post("/api/journal/trades", json=trade(client_id="c", pnl=0.0, outcome="stop"))

    summary = client.get("/api/journal/trades").json()["summary"]
    assert summary["count"] == 3
    assert summary["pnl"] == 20.0
    assert (summary["wins"], summary["losses"]) == (1, 1)
    assert summary["win_rate"] == 50.0
    assert summary["best"] == 30.0 and summary["worst"] == -10.0


def test_old_trades_fall_out_of_the_window(client):
    old = datetime.now(timezone.utc) - timedelta(days=120)
    client.post("/api/journal/trades", json=trade(client_id="old", closed_at=old))
    assert client.get("/api/journal/trades", params={"days": 30}).json()["summary"]["count"] == 0
    assert client.get("/api/journal/trades", params={"days": 365}).json()["summary"]["count"] == 1


def test_filter_by_symbol(client):
    client.post("/api/journal/trades", json=trade(client_id="a", symbol="BTCUSDT"))
    client.post("/api/journal/trades", json=trade(client_id="b", symbol="ETHUSDT"))
    rows = client.get("/api/journal/trades", params={"symbol": "ethusdt"}).json()["trades"]
    assert [r["symbol"] for r in rows] == ["ETHUSDT"]


def test_broken_side_and_outcome_are_rejected(client):
    assert client.post("/api/journal/trades", json=trade(side="вверх")).status_code == 422
    assert client.post("/api/journal/trades", json=trade(outcome="почти")).status_code == 422
    assert client.post("/api/journal/trades", json=trade(qty=0)).status_code == 422


def test_closed_at_comes_back_with_timezone(client):
    """Без зоны браузер прочитает время как местное и уедет в соседний день."""
    body = client.post("/api/journal/trades", json=trade()).json()
    assert body["closed_at"].endswith("+00:00")


def test_calendar_groups_by_day(client):
    day = datetime(2026, 3, 5, 12, 0, tzinfo=timezone.utc)
    client.post("/api/journal/trades", json=trade(client_id="a", closed_at=day, pnl=30.0))
    client.post(
        "/api/journal/trades",
        json=trade(client_id="b", closed_at=day.replace(hour=20), pnl=-10.0, outcome="stop"),
    )
    client.post(
        "/api/journal/trades",
        json=trade(client_id="c", closed_at=day.replace(day=6), pnl=5.0),
    )

    body = client.get("/api/journal/calendar", params={"year": 2026, "month": 3}).json()
    days = {d["date"]: d for d in body["days"]}
    assert days["2026-03-05"]["pnl"] == 20.0
    assert days["2026-03-05"]["trades"] == 2
    assert days["2026-03-06"]["pnl"] == 5.0
    assert body["total"] == 25.0


def test_calendar_ignores_other_months(client):
    client.post(
        "/api/journal/trades",
        json=trade(client_id="a", closed_at=datetime(2026, 2, 28, tzinfo=timezone.utc)),
    )
    body = client.get("/api/journal/calendar", params={"year": 2026, "month": 3}).json()
    assert body["days"] == [] and body["total"] == 0


def test_december_calendar_does_not_break_on_year_edge(client):
    client.post(
        "/api/journal/trades",
        json=trade(client_id="a", closed_at=datetime(2026, 12, 31, 23, 0, tzinfo=timezone.utc)),
    )
    body = client.get("/api/journal/calendar", params={"year": 2026, "month": 12}).json()
    assert body["total"] == 30.0


def test_trade_can_be_deleted(client):
    created = client.post("/api/journal/trades", json=trade()).json()
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 200
    assert client.get("/api/journal/trades").json()["summary"]["count"] == 0
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 404


def test_workspace_round_trip(client):
    assert client.get("/api/journal/workspace").json()["payload"] is None

    client.put("/api/journal/workspace", json={"theme": "light", "agg": 10})
    body = client.get("/api/journal/workspace").json()
    assert body["payload"] == {"theme": "light", "agg": 10}
    assert body["updated_at"]

    client.put("/api/journal/workspace", json={"theme": "dark"})
    assert client.get("/api/journal/workspace").json()["payload"] == {"theme": "dark"}


def test_oversized_workspace_is_rejected(client):
    huge = {"junk": "я" * 20_000}
    assert client.put("/api/journal/workspace", json=huge).status_code == 413


def test_new_field_is_added_to_an_existing_table(tmp_path):
    """Поле, появившееся в модели позже, должно доехать до старой базы.

    create_all умеет только создавать таблицы целиком. Без дополнения схемы
    первый же запрос падает с «нет такой колонки», и журнал перестаёт
    открываться — ровно это и случилось на боевой базе.
    """
    import sqlite3

    import core.db as db

    path = tmp_path / "old.sqlite3"
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE scalp_workspaces (id INTEGER PRIMARY KEY, student_id INTEGER)"
    )
    con.commit()
    con.close()

    db.init_engine(f"sqlite:///{path}")
    db.create_all()

    con = sqlite3.connect(path)
    columns = {row[1] for row in con.execute("PRAGMA table_info(scalp_workspaces)")}
    con.close()
    assert {"payload", "updated_at"} <= columns


# ── снимки графика ───────────────────────────────────────────────────────────

def test_shot_is_saved_and_served(tmp_path, monkeypatch):
    """Снимок сохраняется файлом, а ссылка отдаёт страницу с картинкой.

    Владельца не храним: имя рисуется в самой картинке браузером, а базе о нём
    знать незачем - ссылку открывают посторонние.
    """
    import base64

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.api import shots as shots_api
    from backend.deps import get_current_student, get_session
    from core.models import Base, Student

    monkeypatch.setattr(shots_api, "_DIR", tmp_path)

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=1, username="scalper")
    session.add(student)
    session.commit()

    app = FastAPI()
    app.include_router(shots_api.api_router)
    app.include_router(shots_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student

    # Однопиксельный PNG - достаточно, чтобы проверить путь целиком.
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    with TestClient(app) as client:
        created = client.post(
            "/api/shots",
            json={
                "image": "data:image/png;base64," + base64.b64encode(png).decode(),
                "symbol": "btcusdt",
                "interval": "1m",
            },
        )
        assert created.status_code == 201
        shot_id = created.json()["id"]

        page = client.get(f"/{shot_id}")
        assert page.status_code == 200
        assert "BTCUSDT" in page.text
        # Превью в мессенджерах собирается по og-тегам ещё до открытия.
        assert 'property="og:image"' in page.text
        # Имени владельца на странице нет.
        assert "scalper" not in page.text

        image = client.get(f"/{shot_id}.png")
        assert image.status_code == 200
        assert image.content == png


def test_shot_refuses_what_is_not_a_picture(tmp_path, monkeypatch):
    import base64

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.api import shots as shots_api
    from backend.deps import get_current_student, get_session
    from core.models import Base, Student

    monkeypatch.setattr(shots_api, "_DIR", tmp_path)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()

    app = FastAPI()
    app.include_router(shots_api.api_router)
    app.include_router(shots_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student

    with TestClient(app) as client:
        # Не PNG: подписи, исполняемые файлы и прочее сюда попадать не должно.
        answer = client.post(
            "/api/shots",
            json={
                "image": base64.b64encode(b"MZ" + b"0" * 200).decode(),
                "symbol": "BTCUSDT",
            },
        )
        assert answer.status_code == 400
        assert list(tmp_path.iterdir()) == []
