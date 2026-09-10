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
    assert titles["Выгрузка журнала в CSV"]["feature"] == "journal_export"
    assert titles["Заморозка серии"]["charges"] == 1
    assert titles["Удвоение бонуса за серию - 7 дней"]["duration_days"] == 7


def test_функция_выдаётся_сразу(client):
    auth = _rich_student(client, "700001", 1000)
    item_id = _feature_item("Выгрузка журнала в CSV")

    order = client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    assert order.status_code == 200
    assert order.json()["status"] == "fulfilled"

    owned = client.get("/api/shop/entitlements", headers=auth).json()
    assert [(e["feature"], e["permanent"]) for e in owned] == [("journal_export", True)]
    assert client.get("/api/coins", headers=auth).json()["balance"] == 800


def test_навсегда_купленное_второй_раз_не_продаётся(client):
    auth = _rich_student(client, "700002", 1000)
    item_id = _feature_item("Выгрузка журнала в CSV")

    client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    again = client.post("/api/shop/orders", json={"item_id": item_id}, headers=auth)
    assert again.status_code == 400
    assert client.get("/api/coins", headers=auth).json()["balance"] == 800


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


def test_ручной_товар_по_прежнему_ждёт_ментора(client):
    auth = _rich_student(client, "700003", 1000)
    item_id = _feature_item("Разбор сделки с ментором")

    order = client.post("/api/shop/orders", json={"item_id": item_id, "contact": "@me"}, headers=auth)
    assert order.json()["status"] == "pending"
    assert client.get("/api/shop/entitlements", headers=auth).json() == []
