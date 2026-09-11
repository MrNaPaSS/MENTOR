"""Функции платформы за монеты: выдаются сразу и работают.

Покупка функции не ждёт ментора: доступ пишется той же операцией, что и
списание монет. Проверяем три вещи: сама выдача (навсегда, на срок, заряды),
покупка через магазин и то, что купленное действительно меняет начисления -
заморозка бережёт серию, удвоение удваивает бонус.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.models import CoinTransaction, Entitlement, ScalpTrade, ShopItem, Student, utcnow
from core.weex import get_weex_client


# ── Выдача ───────────────────────────────────────────────────────────────────


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/features.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    from backend import entitlements
    from backend.trading import rewards

    return db_module, entitlements, rewards


def _student(session) -> Student:
    student = Student(tg_id=1, username="alex", coins=0)
    session.add(student)
    session.flush()
    return student


def _item(feature: str, *, days: int = 0, charges: int = 0) -> ShopItem:
    return ShopItem(title=feature, price=100, feature=feature, duration_days=days, charges=charges)


def test_навсегда_срок_и_заряды(db):
    db_module, ent, _ = db
    with db_module.SessionLocal() as session:
        student = _student(session)

        ent.grant(session, student.id, _item("journal_export"))
        ent.grant(session, student.id, _item("streak_boost", days=7))
        ent.grant(session, student.id, _item("streak_freeze", charges=1))
        ent.grant(session, student.id, _item("streak_freeze", charges=1))
        session.commit()

        assert ent.has_feature(session, student.id, "journal_export")
        assert ent.has_feature(session, student.id, "streak_boost")
        freeze = session.query(Entitlement).filter_by(feature="streak_freeze").one()
        assert freeze.charges == 2


def test_продление_срока_складывает_дни(db):
    db_module, ent, _ = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_boost", days=7))
        ent.grant(session, student.id, _item("streak_boost", days=7))
        session.commit()

        row = session.query(Entitlement).filter_by(feature="streak_boost").one()
        left = ent._aware(row.expires_at) - utcnow()
        assert timedelta(days=13) < left <= timedelta(days=14)


def test_истёкший_срок_не_действует(db):
    db_module, ent, _ = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_boost", days=7))
        row = session.query(Entitlement).one()
        row.expires_at = utcnow() - timedelta(minutes=1)
        session.commit()

        assert not ent.has_feature(session, student.id, "streak_boost")


def test_заряд_тратится_один_раз(db):
    db_module, ent, _ = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_freeze", charges=1))
        session.commit()

        assert ent.use_charge(session, student.id, "streak_freeze") is True
        assert ent.use_charge(session, student.id, "streak_freeze") is False
        assert not ent.has_feature(session, student.id, "streak_freeze")


# ── Функции действительно работают ──────────────────────────────────────────


def _trade(session, student, *, pnl: float, client_id: str, minutes_ago: int) -> ScalpTrade:
    trade = ScalpTrade(
        student_id=student.id, client_id=client_id, symbol="BTCUSDT", side="long",
        entry=100.0, stop=99.0, exit_price=101.0, qty=1.0, margin=10.0, leverage=10,
        takes_hit=1, outcome="take" if pnl > 0 else "stop", pnl=pnl, fee=0.1,
        closed_at=utcnow() - timedelta(minutes=minutes_ago), from_exchange=True,
    )
    session.add(trade)
    session.flush()
    return trade


def _bonuses(session, student) -> list[int]:
    return [
        t.amount for t in session.query(CoinTransaction)
        .filter_by(student_id=student.id, reason="trade_streak").all()
    ]


def test_заморозка_бережёт_серию(db):
    db_module, ent, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_freeze", charges=1))

        # Плюс, плюс, убыток, плюс: без заморозки серия оборвалась бы на
        # убытке, с ней третий плюс даёт бонус за три подряд.
        plan = [(3.0, 40), (3.0, 30), (-3.0, 20), (3.0, 10)]
        for i, (pnl, ago) in enumerate(plan):
            rewards.award_trade_coins(session, _trade(session, student, pnl=pnl, client_id=f"t{i}", minutes_ago=ago))
        session.commit()

        assert _bonuses(session, student) == [rewards.STREAK_BONUS[3]]
        assert not ent.has_feature(session, student.id, "streak_freeze")
        # Монеты за убыток сняты всё равно: заморозка бережёт серию, не баланс.
        loss = session.query(CoinTransaction).filter_by(student_id=student.id, reason="trade_loss").all()
        assert sum(t.amount for t in loss) == -rewards.LOSS_COINS


def test_заморозка_не_тратится_на_пустом_месте(db):
    db_module, ent, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_freeze", charges=1))

        # Один плюс - беречь нечего, заряд остаётся.
        rewards.award_trade_coins(session, _trade(session, student, pnl=3.0, client_id="a", minutes_ago=20))
        rewards.award_trade_coins(session, _trade(session, student, pnl=-3.0, client_id="b", minutes_ago=10))
        session.commit()

        assert ent.has_feature(session, student.id, "streak_freeze")


def test_без_заморозки_убыток_обрывает_серию(db):
    db_module, _, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        plan = [(3.0, 40), (3.0, 30), (-3.0, 20), (3.0, 10)]
        for i, (pnl, ago) in enumerate(plan):
            rewards.award_trade_coins(session, _trade(session, student, pnl=pnl, client_id=f"t{i}", minutes_ago=ago))
        session.commit()

        assert _bonuses(session, student) == []


def test_удвоение_бонуса(db):
    db_module, ent, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        ent.grant(session, student.id, _item("streak_boost", days=7))

        for i in range(3):
            rewards.award_trade_coins(session, _trade(session, student, pnl=3.0, client_id=f"t{i}", minutes_ago=30 - i * 10))
        session.commit()

        assert _bonuses(session, student) == [rewards.STREAK_BONUS[3] * rewards.BOOST_FACTOR]


# ── Покупка через магазин ───────────────────────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/shop_api.sqlite3")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        uid_login_enabled=True,
    )
    return TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))


def _rich_student(client, uid: str, coins: int) -> dict:
    from core.db import SessionLocal

    token = client.post("/api/auth/login-by-uid", json={"weex_uid": uid}).json()["access_token"]
    with SessionLocal() as s:
        student = s.query(Student).filter_by(weex_uid=uid).one()
        student.coins = coins
        s.commit()
    return {"Authorization": f"Bearer {token}"}


def _feature_item(title: str) -> int:
    from core.db import SessionLocal

    with SessionLocal() as s:
        return s.query(ShopItem).filter_by(title=title).one().id


def test_функции_есть_в_каталоге(client):
    titles = {it["title"]: it for it in client.get("/api/shop/items").json()}
    assert titles["Выгрузка журнала: отчёт с диаграммами"]["feature"] == "journal_export"
    assert titles["Заморозка серии"]["charges"] == 1
    assert titles["Удвоение бонуса за серию - 7 дней"]["duration_days"] == 7


def test_функция_выдаётся_сразу(client):
    auth = _rich_student(client, "700001", 3000)
    item_id = _feature_item("Выгрузка журнала: отчёт с диаграммами")

    order = client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    assert order.status_code == 200
    assert order.json()["status"] == "fulfilled"

    owned = client.get("/api/shop/entitlements", headers=auth).json()
    assert [(e["feature"], e["permanent"]) for e in owned] == [("journal_export", True)]
    assert client.get("/api/coins", headers=auth).json()["balance"] == 500


def test_навсегда_купленное_второй_раз_не_продаётся(client):
    auth = _rich_student(client, "700002", 3000)
    item_id = _feature_item("Выгрузка журнала: отчёт с диаграммами")

    client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    again = client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    assert again.status_code == 400
    assert client.get("/api/coins", headers=auth).json()["balance"] == 500


def _frame_of(uid: str) -> str | None:
    from core.db import SessionLocal

    with SessionLocal() as s:
        return s.query(Student).filter_by(weex_uid=uid).one().avatar_frame


def test_рамки_есть_в_каталоге(client):
    features = {it["feature"] for it in client.get("/api/shop/items").json()}
    assert {"frame_neon", "frame_carbon", "frame_pulse", "frame_candles", "frame_crown"} <= features


def test_первая_купленная_рамка_надевается_сама(client):
    auth = _rich_student(client, "700010", 1000)
    order = client.post("/api/shop/orders", json={"item_id": _feature_item("Рамка «Неон»")}, headers=auth)
    assert order.json()["status"] == "fulfilled"
    assert _frame_of("700010") == "neon"

    # Вторая рамка уже надетую не подменяет - её надевают руками.
    client.post("/api/shop/orders", json={"item_id": _feature_item("Рамка «Карбон»")}, headers=auth)
    assert _frame_of("700010") == "neon"
    assert client.post("/api/shop/frame", json={"frame": "carbon"}, headers=auth).status_code == 200
    assert _frame_of("700010") == "carbon"


def test_некупленную_рамку_не_надеть(client):
    auth = _rich_student(client, "700011", 0)
    assert client.post("/api/shop/frame", json={"frame": "crown"}, headers=auth).status_code == 403
    # Золото лидерборда не продаётся и не надевается.
    assert client.post("/api/shop/frame", json={"frame": "gold"}, headers=auth).status_code == 400


def test_рамку_можно_снять(client):
    auth = _rich_student(client, "700012", 1000)
    client.post("/api/shop/orders", json={"item_id": _feature_item("Рамка «Неон»")}, headers=auth)
    assert client.post("/api/shop/frame", json={"frame": ""}, headers=auth).status_code == 200
    assert _frame_of("700012") is None


def test_мерч_в_каталоге_и_пульт_самый_дорогой(client):
    items = client.get("/api/shop/items").json()
    merch = [it for it in items if it["category"] == "merch"]
    assert len(merch) == 8
    assert all(it["image_url"].startswith("/merch/") for it in merch)
    top = max(items, key=lambda it: it["price"])
    assert top["title"] == "Торговый пульт NMNH"
    shirt = next(it for it in merch if it["title"] == "Футболка NMNH TRADE")
    import json
    assert json.loads(shirt["options"])["size"] == ["S", "M", "L", "XL", "XXL"]


def test_мерч_без_адреса_не_продаётся(client):
    auth = _rich_student(client, "700020", 10000)
    item_id = _feature_item("Брелок NMNH")
    assert client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth).status_code == 400
    assert client.get("/api/coins", headers=auth).json()["balance"] == 10000

    order = client.post(
        "/api/shop/orders",
        json={"item_id": item_id, "contact": "Цвет: Чёрный; @me; Москва, ул. Пример 1"},
        headers=auth,
    )
    assert order.json()["status"] == "pending"
    assert client.get("/api/coins", headers=auth).json()["balance"] == 7500


def test_ручной_товар_по_прежнему_ждёт_ментора(client):
    auth = _rich_student(client, "700003", 1000)
    item_id = _feature_item("Разбор сделки с ментором")

    order = client.post("/api/shop/orders", json={"item_id": item_id, "contact": "@me"}, headers=auth)
    assert order.json()["status"] == "pending"
    assert client.get("/api/shop/entitlements", headers=auth).json() == []


# ── Инструменты терминала ────────────────────────────────────────────────────


TOOLS = {
    "NMNH VISION": "tool_vision",
    "Кластерная свеча": "tool_footprint",
    "Объёмные свечи": "tool_volume_candles",
    "Стакан 60 и 100 строк": "tool_dom_depth",
    "Шаг стакана ×25": "tool_dom_step25",
    "Выгрузка журнала: отчёт с диаграммами": "journal_export",
}


def test_инструменты_отдельным_разделом(client):
    """Все шесть - в разделе «Инструменты», продаются навсегда."""
    items = {it["title"]: it for it in client.get("/api/shop/items").json()}
    for title, feature in TOOLS.items():
        assert items[title]["feature"] == feature
        assert items[title]["section"] == "tools"
        assert items[title]["duration_days"] == 0 and items[title]["charges"] == 0
    # Выгрузка подорожала вместе с тем, что она теперь даёт.
    assert items["Выгрузка журнала: отчёт с диаграммами"]["price"] > 200


def test_инструмент_открывается_сразу(client):
    auth = _rich_student(client, "700050", 5000)
    order = client.post(
        "/api/shop/orders", json={"item_id": _feature_item("NMNH VISION")}, headers=auth
    )
    assert order.json()["status"] == "fulfilled"
    owned = [e["feature"] for e in client.get("/api/shop/entitlements", headers=auth).json()]
    assert owned == ["tool_vision"]


# ── Выгрузка журнала: три в месяц ────────────────────────────────────────────


def test_без_покупки_выгрузки_нет(client):
    auth = _rich_student(client, "700060", 0)
    assert client.get("/api/journal/export", headers=auth).json()["owned"] is False
    assert client.post("/api/journal/export", headers=auth).status_code == 403


def test_три_выгрузки_в_месяц(client):
    auth = _rich_student(client, "700061", 3000)
    client.post("/api/shop/orders", json={"item_id": _feature_item("Выгрузка журнала: отчёт с диаграммами")}, headers=auth)

    quota = client.get("/api/journal/export", headers=auth).json()
    assert (quota["owned"], quota["limit"], quota["left"]) == (True, 3, 3)

    for left in (2, 1, 0):
        answer = client.post("/api/journal/export", headers=auth)
        assert answer.status_code == 200
        assert "trades" in answer.json()
        assert answer.json()["quota"]["left"] == left

    # Четвёртая - отказ, и счёт не уходит в минус.
    assert client.post("/api/journal/export", headers=auth).status_code == 429
    assert client.get("/api/journal/export", headers=auth).json()["left"] == 0


def test_выгрузки_прошлого_месяца_не_в_счёт(client):
    from core.db import SessionLocal
    from core.models import JournalExport

    auth = _rich_student(client, "700062", 3000)
    client.post("/api/shop/orders", json={"item_id": _feature_item("Выгрузка журнала: отчёт с диаграммами")}, headers=auth)
    with SessionLocal() as s:
        student = s.query(Student).filter_by(weex_uid="700062").one()
        for _ in range(3):
            s.add(JournalExport(student_id=student.id, created_at=utcnow() - timedelta(days=40)))
        s.commit()

    assert client.get("/api/journal/export", headers=auth).json()["left"] == 3


# ── VIP ──────────────────────────────────────────────────────────────────────


def _make_vip(uid: str, on: bool = True) -> None:
    from core.db import SessionLocal

    with SessionLocal() as s:
        s.query(Student).filter_by(weex_uid=uid).one().is_vip = on
        s.commit()


def test_vip_открывает_все_инструменты_без_покупки(client):
    auth = _rich_student(client, "700070", 0)
    _make_vip("700070")
    owned = {e["feature"] for e in client.get("/api/shop/entitlements", headers=auth).json()}
    assert set(TOOLS.values()) <= owned
    # И выгрузка журнала работает, хотя монет он не тратил.
    assert client.post("/api/journal/export", headers=auth).status_code == 200


def test_vip_не_платит_за_то_что_уже_открыто(client):
    auth = _rich_student(client, "700071", 5000)
    _make_vip("700071")
    order = client.post(
        "/api/shop/orders", json={"item_id": _feature_item("NMNH VISION")}, headers=auth
    )
    assert order.status_code == 400
    assert client.get("/api/coins", headers=auth).json()["balance"] == 5000


def test_снятый_vip_оставляет_только_купленное(client):
    auth = _rich_student(client, "700072", 5000)
    client.post("/api/shop/orders", json={"item_id": _feature_item("Объёмные свечи")}, headers=auth)
    _make_vip("700072")
    _make_vip("700072", on=False)
    owned = [e["feature"] for e in client.get("/api/shop/entitlements", headers=auth).json()]
    assert owned == ["tool_volume_candles"]


def test_стакан_и_кластер_урезаются_без_прав():
    from backend import tools

    free = frozenset()
    assert tools.limit_rows(100, free) == 30 and tools.limit_rows(30, free) == 30
    assert tools.limit_agg(25, free) == 10 and tools.limit_agg(5, free) == 5
    assert not tools.can_footprint(free)

    paid = frozenset({"tool_dom_depth", "tool_dom_step25", "tool_footprint"})
    assert tools.limit_rows(100, paid) == 100
    assert tools.limit_agg(25, paid) == 25
    assert tools.can_footprint(paid)


def test_права_по_токену_учитывают_vip(client):
    from backend import tools

    auth = _rich_student(client, "700073", 0)
    token = auth["Authorization"].split(" ", 1)[1]
    assert tools.rights_from_token(token, "test-secret") == frozenset()
    _make_vip("700073")
    assert tools.rights_from_token(token, "test-secret") >= {"tool_dom_depth", "tool_footprint"}
    assert tools.rights_from_token("мусор", "test-secret") == frozenset()


def test_ema_бесплатна_и_vision_её_не_обещает(client):
    """EMA открыта у всех: описание NMNH VISION её в покупку не включает."""
    items = {it["title"]: it for it in client.get("/api/shop/items").json()}
    desc = items["NMNH VISION"]["description"]
    assert "EMA остаются бесплатными" in desc


def test_у_товаров_каталога_есть_английский_текст(client):
    """Английский кабинет показывал русские карточки маркета.

    Каталог, заведённый платформой, получает английский текст при запуске;
    у каждого товара витрины он есть.
    """
    from core.shop_catalog_en import CATALOG_EN

    items = client.get("/api/shop/items").json()
    known = [it for it in items if it["title"] in CATALOG_EN]
    assert known, "каталог пуст"
    for it in known:
        assert it["title_en"] and it["description_en"], it["title"]
    vision = next(it for it in items if it["title"] == "NMNH VISION")
    assert "EMA stay free" in vision["description_en"]


def test_ментор_заводит_товар_сразу_с_английским(client):
    from backend.deps import get_current_mentor

    client.app.dependency_overrides[get_current_mentor] = lambda: {"role": "mentor"}
    try:
        made = client.post(
            "/api/shop/admin/items",
            json={"title": "Кружка NMNH", "title_en": "NMNH mug", "description_en": "A mug.", "price": 900},
        ).json()
        assert (made["title_en"], made["description_en"]) == ("NMNH mug", "A mug.")
        patched = client.patch(
            f"/api/shop/admin/items/{made['id']}", json={"title_en": "NMNH coffee mug"}
        ).json()
        assert patched["title_en"] == "NMNH coffee mug"
    finally:
        client.app.dependency_overrides.pop(get_current_mentor, None)
