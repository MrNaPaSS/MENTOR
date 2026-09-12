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
from backend.config import BackendConfig
from backend.deps import get_config, get_current_student, get_session
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
    # По умолчанию наставник - кто-то другой: проверку прав проходит настоящий
    # код, а не подстановка, иначе тест на отказ ничего не проверяет.
    app.dependency_overrides[get_config] = lambda: _config(admin_tg_id=999)
    # Доступ к разделу проверяется отдельно — здесь он не предмет теста.

    with TestClient(app) as c:
        # Права наставника подставляет тот тест, которому они нужны.
        c.app = app  # type: ignore[attr-defined]
        yield c
    session.close()


def _config(admin_tg_id: int) -> BackendConfig:
    """Настройки с нужным наставником и всем остальным по умолчанию."""
    return BackendConfig(
        jwt_secret="x",
        access_ttl_seconds=900,
        refresh_ttl_seconds=3600,
        weex_use_mock=True,
        code_ttl_seconds=300,
        max_code_attempts=3,
        expose_codes=False,
        admin_tg_id=admin_tg_id,
    )


def as_mentor(client):
    """Этот ученик и есть наставник: его телеграм назван в настройках."""
    client.app.dependency_overrides[get_config] = lambda: _config(admin_tg_id=1)


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


def test_trade_can_be_deleted_by_mentor(client):
    """Наставнику право тоже выдаётся флажком, а не званием."""
    as_mentor(client)
    client.app.dependency_overrides[get_current_student]().journal_delete_allowed = True
    created = client.post("/api/journal/trades", json=trade()).json()
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 200
    assert client.get("/api/journal/trades").json()["summary"]["count"] == 0
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 404


def test_student_cannot_delete_a_trade(client):
    """Журнал - статистика, а не список удачных сделок.

    Право стереть из него неудачную запись обесценивает его целиком: остаётся
    красивый ряд, из которого ничего не следует.
    """
    created = client.post("/api/journal/trades", json=trade()).json()
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 403
    assert client.get("/api/journal/trades").json()["summary"]["count"] == 1


def test_allowed_student_deletes_his_own_record(client):
    """Право выдаётся поимённо - и тогда ученик разбирает свой журнал сам.

    Мусор в нём бывает не только от неудач: сделка записывается дважды после
    обрыва связи, ученик пробует терминал на копейку. Гонять за этим наставника
    на каждый чих - лишний круг.
    """
    student = client.app.dependency_overrides[get_current_student]()
    student.journal_delete_allowed = True

    created = client.post("/api/journal/trades", json=trade()).json()
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 200
    assert client.get("/api/journal/trades").json()["summary"]["count"] == 0


def test_mentor_without_the_flag_cannot_delete(client):
    """Снятый себе флажок выключает удаление и наставнику.

    Раньше право полагалось наставнику самим званием: панель показывала
    выключенный флажок, а кнопка оставалась и записи стирались. Выключить его
    себе было нельзя вовсе.
    """
    as_mentor(client)
    client.app.dependency_overrides[get_current_student]().journal_delete_allowed = False

    created = client.post("/api/journal/trades", json=trade()).json()
    assert client.delete(f"/api/journal/trades/{created['id']}").status_code == 403
    assert client.get("/api/journal/trades").json()["summary"]["count"] == 1


def test_allowed_student_does_not_reach_a_stranger_record(client):
    """Право на свой журнал - это право на свой, а не на любой по номеру.

    Проверки на владельца тут не было вовсе: дойти сюда мог один наставник, а
    ему чужие записи и положены. Дверь стала шире - проверка стала нужна.
    """
    from core.models import ScalpTrade

    session = client.app.dependency_overrides[get_session]()
    mine = client.app.dependency_overrides[get_current_student]()

    # Чужую запись заводим тем же путём, каким её заводит жизнь, - через ручку
    # от лица её хозяина. Собранная руками, она разошлась бы с настоящей на
    # первом же обязательном поле.
    stranger = Student(tg_id=2, username="stranger")
    session.add(stranger)
    session.commit()
    client.app.dependency_overrides[get_current_student] = lambda: stranger
    theirs = client.post("/api/journal/trades", json=trade(client_id="theirs")).json()
    client.app.dependency_overrides[get_current_student] = lambda: mine

    mine.journal_delete_allowed = True
    # Не 403: чужой номер сделки не должен отвечать «есть такая, но не ваша».
    assert client.delete(f"/api/journal/trades/{theirs['id']}").status_code == 404
    assert session.get(ScalpTrade, theirs["id"]) is not None


def test_exchange_record_is_not_overwritten_by_the_terminal(client, ):
    """Оценка с экрана не переписывает числа, пришедшие с биржи.

    Терминал пишет сделку сразу, чтобы она не потерялась, но его результат -
    оценка по цене стакана. Сопровождение следом кладёт настоящий, с биржи. Кто
    напишет последним, того и цифры, и последним оказывался терминал.
    """
    from core.models import ScalpTrade

    created = client.post("/api/journal/trades", json=trade(pnl=487.0)).json()

    # Сопровождение поправило запись настоящими числами.
    session = client.app.dependency_overrides[get_session]()
    row = session.get(ScalpTrade, created["id"])
    row.pnl = 519.0
    row.from_exchange = True
    session.commit()

    # Терминал повторяет свою отправку - и она ничего не меняет.
    again = client.post("/api/journal/trades", json=trade(pnl=487.0)).json()
    assert again["pnl"] == 519.0


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


def test_trades_of_one_day(client):
    """Нажали на клетку календаря - получили сделки того дня, и только его.

    День берётся целиком по UTC: календарь раскладывал их в том же поясе, и
    сделка у границы суток иначе попала бы в соседнюю клетку. Крайние часы
    поэтому и проверяются - полночь и без часа полночь.
    """
    day = datetime(2026, 9, 8, tzinfo=timezone.utc)
    client.post("/api/journal/trades", json=trade(client_id="утро", pnl=10.0, closed_at=day))
    client.post(
        "/api/journal/trades",
        json=trade(client_id="ночь", pnl=-4.0, outcome="stop", closed_at=day.replace(hour=23, minute=59)),
    )
    # Соседний день в выборку попасть не должен.
    client.post(
        "/api/journal/trades",
        json=trade(client_id="завтра", pnl=99.0, closed_at=day + timedelta(days=1)),
    )

    body = client.get("/api/journal/trades?date=2026-09-08").json()

    assert sorted(t["client_id"] for t in body["trades"]) == ["ночь", "утро"]
    assert body["summary"]["count"] == 2
    assert body["summary"]["pnl"] == pytest.approx(6.0)


def test_day_ignores_the_window(client):
    """День отменяет «последние N дней»: в календаре нажимают на клетку."""
    old = datetime(2020, 1, 5, 12, tzinfo=timezone.utc)
    client.post("/api/journal/trades", json=trade(client_id="давняя", closed_at=old))

    body = client.get("/api/journal/trades?date=2020-01-05&days=30").json()

    assert [t["client_id"] for t in body["trades"]] == ["давняя"]


def test_bad_date_is_refused_not_guessed(client):
    """Дата приходит из адреса: чужую строку не подставляем в запрос."""
    assert client.get("/api/journal/trades?date=вчера").status_code == 422


def test_exchange_of_a_trade_comes_with_the_journal():
    """Запись с биржи несёт её код: им подписывается карточка итога.

    У записей, сделанных сопровождением до появления поля, биржа - та, чьи
    ключи тогда подключали: других не было.
    """
    from backend.api.journal import _row
    from core.models import ScalpTrade, utcnow

    def trade(**over) -> ScalpTrade:
        base = dict(
            id=1, client_id="c", symbol="ETHUSDT", side="long", entry=1, stop=1,
            exit_price=1, qty=1, margin=1, leverage=1, takes_hit=0, targets_json="[]",
            outcome="take", pnl=1, fee=0, closed_at=utcnow(), note="",
        )
        base.update(over)
        return ScalpTrade(**base)

    assert _row(trade(exchange="okx"))["exchange"] == "okx"
    assert _row(trade(exchange="", from_exchange=True))["exchange"] == "weex"
    assert _row(trade(exchange="", from_exchange=False))["exchange"] == ""


def test_card_page_signs_the_exchange_safely():
    from backend.api.shots import _venue

    assert _venue("WEEX Futures") == "WEEX Futures"
    assert _venue('<script>alert(1)</script>') == ""
    assert _venue(None) == ""
