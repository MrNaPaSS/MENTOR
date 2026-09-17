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


# ── биржи в журнале ─────────────────────────────────────────────────────────
#
# Мультибиржа: ученик приходит со счётом на своей бирже, а у части учеников
# счетов два. Журнал показывает историю целиком - сделки принадлежат ученику, -
# но одна строка отчёта принадлежит одной бирже: суммы разных счетов в ней не
# складываются.


def _session(client):
    """Та же сессия, что видит приложение: записи заводим прямо в ней."""
    return client.app.dependency_overrides[get_session]()


def _from_exchange(client, client_id: str, exchange: str, pnl: float = 10.0) -> None:
    """Запись сопровождения: её делает сервер по исполнениям биржи."""
    from core.models import ScalpTrade, utcnow

    session = _session(client)
    session.add(ScalpTrade(
        student_id=1, client_id=client_id, symbol="BTCUSDT", side="long",
        entry=100, stop=99, exit_price=101, qty=1, margin=100, leverage=10,
        outcome="manual", pnl=pnl, closed_at=utcnow(),
        from_exchange=True, exchange=exchange,
    ))
    session.commit()


def test_trade_remembers_the_exchange_it_was_made_on(client):
    body = client.post("/api/journal/trades", json=trade(exchange="OKX")).json()
    assert body["exchange"] == "okx"


def test_unknown_exchange_of_a_trade_is_dropped_not_stored(client):
    """Чужой код в журнал не попадает: по нему потом считают деньги."""
    body = client.post("/api/journal/trades", json=trade(exchange="дом")).json()
    assert body["exchange"] == ""


def test_listing_keeps_one_exchange(client):
    client.post("/api/journal/trades", json=trade(client_id="a", exchange="okx", pnl=30.0))
    client.post("/api/journal/trades", json=trade(client_id="b", exchange="weex", pnl=-10.0))

    okx = client.get("/api/journal/trades", params={"exchange": "okx"}).json()
    assert [t["client_id"] for t in okx["trades"]] == ["a"]
    # Итог - про отобранное, а не про всё сразу: иначе он спорит со списком.
    assert okx["summary"]["pnl"] == 30.0


def test_old_records_of_the_first_exchange_are_found_by_its_name(client):
    """До мультибиржи биржу не писали: такие записи - WEEX, других не было."""
    _from_exchange(client, "old", exchange="", pnl=7.0)

    found = client.get("/api/journal/trades", params={"exchange": "weex"}).json()
    assert [t["client_id"] for t in found["trades"]] == ["old"]
    assert found["summary"]["pnl"] == 7.0


def test_trades_without_an_exchange_have_their_own_filter(client):
    """Торговля по стакану без счёта: биржи у сделки нет, и чужой она не станет."""
    client.post("/api/journal/trades", json=trade(client_id="paper", pnl=5.0))
    client.post("/api/journal/trades", json=trade(client_id="live", exchange="okx", pnl=50.0))

    paper = client.get("/api/journal/trades", params={"exchange": "none"}).json()
    assert [t["client_id"] for t in paper["trades"]] == ["paper"]
    assert client.get(
        "/api/journal/trades", params={"exchange": "okx"}
    ).json()["summary"]["pnl"] == 50.0


def test_exchanges_are_counted_apart_and_never_summed(client):
    client.post("/api/journal/trades", json=trade(client_id="a", exchange="okx", pnl=30.0))
    client.post("/api/journal/trades", json=trade(client_id="b", exchange="okx", pnl=-10.0))
    client.post("/api/journal/trades", json=trade(client_id="c", exchange="weex", pnl=100.0))

    rows = {row["exchange"]: row for row in client.get("/api/journal/trades").json()["by_exchange"]}
    assert rows["okx"]["pnl"] == 20.0 and rows["okx"]["count"] == 2
    assert rows["weex"]["pnl"] == 100.0 and rows["weex"]["count"] == 1
    assert (rows["okx"]["wins"], rows["okx"]["losses"]) == (1, 1)


def test_the_switch_keeps_every_exchange_while_one_is_chosen(client):
    """По разрезу рисуется переключатель: выбранная биржа не гасит остальные."""
    client.post("/api/journal/trades", json=trade(client_id="a", exchange="okx"))
    client.post("/api/journal/trades", json=trade(client_id="b", exchange="weex"))

    body = client.get("/api/journal/trades", params={"exchange": "okx"}).json()
    assert {row["exchange"] for row in body["by_exchange"]} == {"okx", "weex"}


def test_unknown_exchange_in_the_query_is_refused(client):
    assert client.get("/api/journal/trades", params={"exchange": "мтс"}).status_code == 422
    assert client.get("/api/journal/calendar", params={
        "year": 2026, "month": 9, "exchange": "мтс"
    }).status_code == 422


def test_calendar_counts_one_exchange(client):
    when = datetime.now(timezone.utc).replace(day=15, hour=9, minute=0, second=0, microsecond=0)
    client.post("/api/journal/trades", json=trade(
        client_id="a", exchange="okx", pnl=30.0, closed_at=when))
    client.post("/api/journal/trades", json=trade(
        client_id="b", exchange="weex", pnl=-100.0, closed_at=when))

    body = client.get("/api/journal/calendar", params={
        "year": when.year, "month": when.month, "exchange": "okx"
    }).json()
    assert body["total"] == 30.0
    assert body["days"][0]["trades"] == 1
    assert {row["exchange"] for row in body["by_exchange"]} == {"okx", "weex"}


# ── сделка в работе ─────────────────────────────────────────────────────────


def _live_row(session, student, **over):
    """Запись, какую заводит сопровождение при открытии позиции."""
    from core.models import ScalpTrade

    row = ScalpTrade(
        student_id=student.id,
        client_id=over.pop("client_id", "live-1"),
        symbol=over.pop("symbol", "BTCUSDT"),
        side="long",
        entry=100.0,
        stop=99.0,
        qty=10.0,
        margin=100.0,
        leverage=10,
        takes_hit=over.pop("takes_hit", 2),
        targets_json="[101, 102, 103]",
        outcome="open",
        pnl=over.pop("pnl", 24.0),
        closed_qty=over.pop("closed_qty", 6.0),
        fee=0.5,
        opened_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        closed_at=None,
        note="в работе",
        from_exchange=True,
        exchange=over.pop("exchange", "weex"),
    )
    session.add(row)
    session.commit()
    return row


def test_a_live_trade_comes_apart_from_the_closed_ones(client):
    """Сделка в работе идёт своим списком и в итоги периода не входит.

    Трейдер взял две цели из трёх: деньги зафиксированы, но сделка ещё не
    кончилась. Считать её в проценте прибыльных нельзя - результат изменится.
    """
    session = client.app.dependency_overrides[get_session]()
    student = client.app.dependency_overrides[get_current_student]()
    _live_row(session, student)
    client.post("/api/journal/trades", json=trade(client_id="done-1", pnl=10.0))

    body = client.get("/api/journal/trades").json()

    assert [t["client_id"] for t in body["trades"]] == ["done-1"]
    assert [t["client_id"] for t in body["live"]] == ["live-1"]
    # Итоги - только по закрытой.
    assert body["summary"]["count"] == 1
    assert body["summary"]["pnl"] == 10.0
    # Зафиксированное по идущей стоит в её же строке, а не в итогах периода.
    assert body["live"][0]["pnl"] == 24.0


def test_a_live_trade_carries_its_targets_and_closed_part(client):
    """В строке видно, сколько целей взято и какая часть позиции закрыта."""
    session = client.app.dependency_overrides[get_session]()
    student = client.app.dependency_overrides[get_current_student]()
    _live_row(session, student)

    row = client.get("/api/journal/trades").json()["live"][0]

    assert row["live"] is True
    assert row["takes_hit"] == 2
    assert row["targets"] == [101, 102, 103]
    assert row["closed_qty"] == 6.0
    assert row["closed_at"] is None
    assert row["pnl"] == 24.0


def test_a_live_trade_is_filtered_by_exchange_too(client):
    """Переключатель бирж на странице касается и идущих сделок."""
    session = client.app.dependency_overrides[get_session]()
    student = client.app.dependency_overrides[get_current_student]()
    _live_row(session, student, client_id="live-okx", exchange="okx")
    _live_row(session, student, client_id="live-weex", exchange="weex")

    body = client.get("/api/journal/trades?exchange=okx").json()

    assert [t["client_id"] for t in body["live"]] == ["live-okx"]


def test_the_terminal_may_close_a_live_record(client):
    """Оценка с экрана закрывает запись, до которой сервер не дошёл.

    Счёт отключили или процесс не поднялся - иначе сделка осталась бы «в
    работе» навсегда. А вот уже закрытую биржей запись экран не переписывает.
    """
    session = client.app.dependency_overrides[get_session]()
    student = client.app.dependency_overrides[get_current_student]()
    _live_row(session, student, client_id="live-1")

    answer = client.post("/api/journal/trades", json=trade(client_id="live-1", pnl=31.0))
    assert answer.status_code == 201

    body = client.get("/api/journal/trades").json()
    assert body["live"] == []
    assert [t["pnl"] for t in body["trades"]] == [31.0]


def test_a_closed_exchange_record_still_wins_over_the_screen(client):
    """Закрытую запись с биржи оценка с экрана по-прежнему не трогает."""
    session = client.app.dependency_overrides[get_session]()
    student = client.app.dependency_overrides[get_current_student]()
    row = _live_row(session, student, client_id="done-2")
    row.closed_at = datetime.now(timezone.utc)
    row.outcome = "take"
    row.pnl = 50.0
    session.commit()

    client.post("/api/journal/trades", json=trade(client_id="done-2", pnl=11.0))

    body = client.get("/api/journal/trades").json()
    assert [t["pnl"] for t in body["trades"]] == [50.0]


# ── снимки разбора и план недели ────────────────────────────────────────────

# Однопиксельный PNG: короче настоящего снимка, но проверки проходит так же.
PNG_1PX = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQ"
    "AAAABJRU5ErkJggg=="
)


def test_a_shot_is_attached_to_a_trade(client, tmp_path, monkeypatch):
    """Снимок прикрепляется к своей сделке и приходит в её строке журнала."""
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-shot"))

    answer = client.post(
        "/api/journal/trades/t-shot/shots",
        json={"image": PNG_1PX, "note": "вход по плану"},
    )
    assert answer.status_code == 201
    assert answer.json()["note"] == "вход по плану"

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-shot"
    )
    assert len(row["shots"]) == 1
    assert row["shots"][0]["note"] == "вход по плану"
    # Картинка легла файлом: строка журнала ссылается на неё опознавателем.
    assert list((tmp_path / "shots").glob("*.png"))


def test_a_shot_needs_a_trade_of_your_own(client, tmp_path, monkeypatch):
    """К чужой или несуществующей сделке снимок не прикрепить."""
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")

    answer = client.post(
        "/api/journal/trades/нет-такой/shots", json={"image": PNG_1PX}
    )
    assert answer.status_code == 404


def test_shots_per_trade_are_capped(client, tmp_path, monkeypatch):
    """Снимков на сделку столько, сколько нужно разбору, а не сколько влезет."""
    from backend.api import shots as shots_api
    from backend.api.journal import MAX_SHOTS

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-many"))

    for _ in range(MAX_SHOTS):
        assert (
            client.post(
                "/api/journal/trades/t-many/shots", json={"image": PNG_1PX}
            ).status_code
            == 201
        )

    over = client.post("/api/journal/trades/t-many/shots", json={"image": PNG_1PX})
    assert over.status_code == 409


def test_a_shot_can_be_detached(client, tmp_path, monkeypatch):
    """Снимок можно убрать из разбора - сам файл при этом остаётся.

    На него могла уйти ссылка в чат, и обрывать её из-за того, что картинку
    убрали из разбора, незачем.
    """
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-drop"))
    made = client.post(
        "/api/journal/trades/t-drop/shots", json={"image": PNG_1PX}
    ).json()

    assert client.delete(f"/api/journal/shots/{made['id']}").status_code == 204

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-drop"
    )
    assert row["shots"] == []
    assert list((tmp_path / "shots").glob("*.png"))


def test_the_week_plan_is_written_and_read(client):
    """План недели: одна запись на неделю, её правят, а не плодят."""
    empty = client.get("/api/journal/plan").json()
    assert empty["text"] == ""
    assert empty["week"].count("-W") == 1

    written = client.put(
        "/api/journal/plan", json={"text": "Только BTC и ETH, три сделки в день"}
    ).json()
    assert written["text"] == "Только BTC и ETH, три сделки в день"

    again = client.put("/api/journal/plan", json={"text": "Плюс ETH на откате"}).json()
    assert again["text"] == "Плюс ETH на откате"
    assert again["week"] == written["week"]

    assert client.get("/api/journal/plan").json()["text"] == "Плюс ETH на откате"


def test_a_past_week_keeps_its_own_plan(client):
    """У каждой недели свой план: прошлую неделю новая не переписывает."""
    client.put("/api/journal/plan", json={"week": "2026-W37", "text": "прошлая"})
    client.put("/api/journal/plan", json={"week": "2026-W38", "text": "нынешняя"})

    assert client.get("/api/journal/plan?week=2026-W37").json()["text"] == "прошлая"
    assert client.get("/api/journal/plan?week=2026-W38").json()["text"] == "нынешняя"


def test_shots_keep_the_order_the_trader_set(client, tmp_path, monkeypatch):
    """Снимки идут в том порядке, в каком их положил трейдер.

    Складывают их не в том порядке, в каком снимали: сперва прикрепили выход,
    потом нашли снимок входа - и он должен встать первым.
    """
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-order"))

    made = [
        client.post(
            "/api/journal/trades/t-order/shots",
            json={"image": PNG_1PX, "note": note},
        ).json()
        for note in ("выход", "вход", "в позиции")
    ]
    # По умолчанию - в порядке добавления.
    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-order"
    )
    assert [s["note"] for s in row["shots"]] == ["выход", "вход", "в позиции"]

    # Переставляем: вход, в позиции, выход.
    order = [made[1]["id"], made[2]["id"], made[0]["id"]]
    assert (
        client.put("/api/journal/trades/t-order/shots/order", json={"ids": order}).status_code
        == 200
    )

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-order"
    )
    assert [s["note"] for s in row["shots"]] == ["вход", "в позиции", "выход"]


def test_an_unnamed_shot_goes_last_and_strangers_are_ignored(client, tmp_path, monkeypatch):
    """Не названный в порядке снимок уходит в конец, чужой номер пропускаем."""
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-tail"))
    made = [
        client.post(
            "/api/journal/trades/t-tail/shots", json={"image": PNG_1PX, "note": note}
        ).json()
        for note in ("первый", "второй", "третий")
    ]

    # Называем только третий, да ещё и с чужим номером в списке.
    client.put(
        "/api/journal/trades/t-tail/shots/order",
        json={"ids": [made[2]["id"], 999999]},
    )

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-tail"
    )
    assert [s["note"] for s in row["shots"]] == ["третий", "первый", "второй"]


def test_a_shot_keeps_its_stage(client, tmp_path, monkeypatch):
    """Снимок помнит, к какому этапу сделки относится.

    Ради этого всё и затевалось: картинка с этапом перестаёт быть картинкой и
    становится точкой в истории - до входа, вход, ведение, выход, разбор.
    """
    from backend.api import shots as shots_api

    monkeypatch.setattr(shots_api, "_DIR", tmp_path / "shots")
    client.post("/api/journal/trades", json=trade(client_id="t-stage"))

    made = client.post(
        "/api/journal/trades/t-stage/shots",
        json={"image": PNG_1PX, "stage": "entry", "note": "вход"},
    ).json()
    assert made["stage"] == "entry"

    # Незнакомый этап отбрасываем, а не отказываем: снимок важнее подписи.
    other = client.post(
        "/api/journal/trades/t-stage/shots",
        json={"image": PNG_1PX, "stage": "выдумка"},
    ).json()
    assert other["stage"] == ""

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-stage"
    )
    assert [s["stage"] for s in row["shots"]] == ["entry", ""]


def test_the_trade_review_is_written_in_parts(client):
    """Разбор пишут в несколько заходов, и записанное раньше не теряется."""
    client.post("/api/journal/trades", json=trade(client_id="t-review"))

    first = client.put(
        "/api/journal/trades/t-review/review",
        json={"plan_ok": False, "mistakes": ["risk", "late"]},
    ).json()
    assert first["plan_ok"] is False
    assert first["mistakes"] == ["risk", "late"]

    # Через час дописали словами - отметка и нарушения остались.
    second = client.put(
        "/api/journal/trades/t-review/review",
        json={"review": "Вошёл в середине движения"},
    ).json()
    assert second["review"] == "Вошёл в середине движения"
    assert second["plan_ok"] is False
    assert second["mistakes"] == ["risk", "late"]

    row = next(
        t for t in client.get("/api/journal/trades").json()["trades"] if t["client_id"] == "t-review"
    )
    assert row["review"] == "Вошёл в середине движения"
    assert row["plan_ok"] is False
    assert row["mistakes"] == ["risk", "late"]


def test_unknown_mistakes_are_dropped(client):
    """Список нарушений закрытый: по выдуманным кодам считать нечего."""
    client.post("/api/journal/trades", json=trade(client_id="t-codes"))

    body = client.put(
        "/api/journal/trades/t-codes/review",
        json={"mistakes": ["risk", "чужое", "risk"]},
    ).json()

    # Своё осталось, чужое отброшено, повтор не удвоился.
    assert body["mistakes"] == ["risk"]


def test_a_review_needs_a_trade_of_your_own(client):
    answer = client.put("/api/journal/trades/нет-такой/review", json={"review": "x"})
    assert answer.status_code == 404
