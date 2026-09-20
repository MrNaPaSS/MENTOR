"""Путь подписчика целиком: счёт - перевод - дни - права - вход.

Отдельные куски проверены в своих тестах; здесь важно другое - что они
стыкуются. Человек без счёта на бирже платит, наблюдатель видит перевод в
сети, подписка начисляется, бот узнаёт об этом из очереди, спрашивает
состояние и получает ответ «пускать». Обрыв в любом стыке означает человека,
который заплатил и остался ни с чем.

Сеть здесь записанная: живой круг по настоящей BSC делается пробником
`check_subscription_flow.py`, и он в этих тестах не заменяется.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")
from fastapi.testclient import TestClient

from backend import notifications, subscriptions
from backend.access import effective_access
from backend.config import BackendConfig
from backend.main import create_app
from backend.payments import bsc, watcher as payments_watcher
from core.models import OrphanPayment, PaymentIntent, Student, Subscription
from core.weex import get_weex_client

KEY = "service-key-for-tests"
RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"
TG_ID = 4242


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/flow.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("SERVICE_API_KEY", KEY)
    monkeypatch.setenv("SERVICE_ALLOWED_IPS", "")
    monkeypatch.setenv("NMNH_BSC_RECEIVER", RECEIVER)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    app = create_app(BackendConfig.from_env(), weex=get_weex_client(True))
    with TestClient(app) as client:
        yield client


@pytest.fixture
def session():
    from core import db as db_module

    with db_module.SessionLocal() as session:
        yield session


def _head() -> dict:
    return {"X-Service-Key": KEY}


def _transfer(amount_raw: str, tx: str = "0xflow") -> bsc.Transfer:
    """Перевод в том виде, в каком его достаёт из сети наблюдатель."""
    return bsc.Transfer(
        tx_hash=tx, block=1000, from_address="0x" + "33" * 20, amount_raw=amount_raw
    )


def _run_watcher(monkeypatch, transfers: tuple[bsc.Transfer, ...], head: int = 2000) -> int:
    """Один проход наблюдателя по записанному куску сети."""

    async def safe_head():
        return head

    async def fetch(start, finish):
        return transfers

    monkeypatch.setattr(bsc, "safe_head", safe_head)
    monkeypatch.setattr(bsc, "fetch_transfers", fetch)
    watcher = payments_watcher.PaymentWatcher(subscriptions.on_payment)
    return asyncio.run(watcher.tick())


def test_the_whole_way_from_invoice_to_access(client, session, monkeypatch):
    """Сквозной путь: бот выставил счёт, человек заплатил, терминал открылся."""
    # 1. Бот показывает тарифы.
    plans = client.get("/api/service/subscription/plans", headers=_head()).json()
    assert [one["plan"] for one in plans["plans"]] == ["terminal", "pro"]

    # 2. Бот выставляет счёт. Человека в базе ещё нет - заводится здесь же.
    invoice = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal", "username": "ivan"},
        headers=_head(),
    ).json()
    assert invoice["receiver"] == RECEIVER
    # Сумма короткая: её набирают руками в поле вывода на бирже.
    assert re.fullmatch(r"49\.\d{2}", invoice["amount"])

    # До оплаты вход закрыт: счёта через академию у человека нет.
    before = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert before["active"] is False and before["terminal"] is False

    # 3. Перевод пришёл в сеть, наблюдатель его нашёл.
    assert _run_watcher(monkeypatch, (_transfer(invoice["amount_raw"]),)) == 1

    # 4. Дни начислены, тариф записан, счёт закрыт.
    student = session.query(Student).filter(Student.tg_id == TG_ID).one()
    session.expire_all()
    row = session.get(Subscription, student.id)
    assert row.plan == "terminal"
    assert row.gift_granted is True
    assert session.get(PaymentIntent, invoice["intent_id"]).status == "paid"

    # 5. Бот узнаёт об оплате из очереди, не спрашивая.
    events = client.get("/api/service/notifications", headers=_head()).json()["events"]
    assert [one["event"] for one in events] == ["payment_received"]
    assert events[0]["tg_id"] == TG_ID
    assert events[0]["payload"]["days_added"] == 37

    # 6. И на вопрос «пускать ли» получает «да».
    after = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert after["active"] is True
    assert after["terminal"] is True
    assert after["days_left"] == 37
    assert after["source"] == "subscription"

    # 7. Права в кабинете открылись: терминал и одна биржа.
    access = effective_access(session, student)
    assert access.terminal is True
    assert access.exchange_limit == 1
    assert access.history_months == 3


def test_the_second_pass_over_the_same_blocks_changes_nothing(client, session, monkeypatch):
    """Наблюдатель перечитал те же блоки - дни не удвоились, письмо одно."""
    invoice = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal"},
        headers=_head(),
    ).json()
    transfer = _transfer(invoice["amount_raw"])

    assert _run_watcher(monkeypatch, (transfer,), head=2000) == 1
    paid_until = client.get(
        f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()
    ).json()["paid_until"]

    # Курсор откатили руками - так выглядит перезапуск с потерянным курсором.
    session.expire_all()
    from core.models import ChainCursor

    cursor = session.get(ChainCursor, bsc.NETWORK)
    cursor.last_block = 0
    session.commit()
    _run_watcher(monkeypatch, (transfer,), head=2000)

    again = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert again["paid_until"] == paid_until
    events = client.get("/api/service/notifications", headers=_head()).json()["events"]
    assert len(events) == 1


def test_a_wrong_amount_waits_for_a_human(client, session, monkeypatch):
    """Человек ошибся суммой: деньги видны, подписка не начислена."""
    client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal"},
        headers=_head(),
    )

    assert _run_watcher(monkeypatch, (_transfer("7000000000000000000", tx="0xwrong"),)) == 0

    session.expire_all()
    orphan = session.get(OrphanPayment, "0xwrong")
    assert orphan is not None and orphan.resolved_student_id is None
    status = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert status["active"] is False


def test_money_that_came_late_still_counts(client, session, monkeypatch):
    """Вывод с биржи шёл полтора часа: счёт истёк, деньги всё равно его."""
    invoice = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "pro", "period": "year"},
        headers=_head(),
    ).json()

    # Час прошёл, бронь снята.
    session.expire_all()
    intent = session.get(PaymentIntent, invoice["intent_id"])
    intent.expires_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    session.commit()
    assert payments_watcher.expire_stale(session) == 1

    assert _run_watcher(monkeypatch, (_transfer(invoice["amount_raw"], tx="0xlate"),)) == 1

    status = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert status["active"] is True
    assert status["plan"] == "pro"
    # Год плюс тридцать подарочных дней при первой оплате.
    assert status["days_left"] == 395


def test_renewing_before_the_end_adds_to_what_is_left(client, session, monkeypatch):
    """Продление за день до конца: дни складываются, а не начинаются заново."""
    first = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal"},
        headers=_head(),
    ).json()
    _run_watcher(monkeypatch, (_transfer(first["amount_raw"], tx="0xone"),), head=2000)

    second = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal"},
        headers=_head(),
    ).json()
    assert second["intent_id"] != first["intent_id"]
    _run_watcher(monkeypatch, (_transfer(second["amount_raw"], tx="0xtwo"),), head=4000)

    status = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    # 30 + 7 подарочных за первую оплату и 30 за вторую.
    assert status["days_left"] == 67


def test_the_end_closes_trading_and_leaves_the_journal(client, session, monkeypatch):
    """Кончилась - торговля закрыта, журнал читается: это его данные."""
    invoice = client.post(
        "/api/service/subscription/invoice",
        json={"tg_id": TG_ID, "plan": "terminal"},
        headers=_head(),
    ).json()
    _run_watcher(monkeypatch, (_transfer(invoice["amount_raw"]),))

    session.expire_all()
    student = session.query(Student).filter(Student.tg_id == TG_ID).one()
    row = session.get(Subscription, student.id)
    row.paid_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    session.commit()

    access = effective_access(session, student)
    assert access.terminal is False, "торговля закрывается в тот же момент"

    status = client.get(f"/api/service/subscription/status?tg_id={TG_ID}", headers=_head()).json()
    assert status["active"] is False

    # И человеку об этом сказали, а не оставили гадать у запертой кнопки.
    assert notifications.sweep(session) == 1
    events = client.get("/api/service/notifications", headers=_head()).json()["events"]
    assert "expired" in [one["event"] for one in events]
