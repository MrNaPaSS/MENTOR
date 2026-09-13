"""Подтверждение счетов академией: кто пришёл через неё, а кто со своим счётом.

От подтверждения зависят деньги - сниженная комиссия, кешбэк и полный доступ, -
поэтому решает не слово ученика, а список от академии и номер счёта, который
называет сама биржа.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import exchange_uids as service_api
from backend.api import trading as trading_api
from backend.trading import connect as connect_mod
from backend.config import BackendConfig
from backend.deps import get_config, get_current_student, get_session, get_weex
from core.db import Base
from core.models import AcademyUid, ExchangeAccount, Student

SERVICE_KEY = "academy-secret-key"
HEADERS = {"X-Service-Key": SERVICE_KEY}
KEYS = {"api_key": "key-12345678", "secret_key": "secret-xx", "passphrase": "pass"}


def _config() -> BackendConfig:
    return BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        service_api_key=SERVICE_KEY,
    )


class _Probe:
    """Биржа при подключении ключей: отвечает балансом и номером счёта."""

    def __init__(self, uid: str = ""):
        self.uid = uid

    async def balance(self, margin_coin="USDT"):
        return [{"marginCoin": "USDT", "availableBalance": "100"}]

    async def account_uid(self):
        return self.uid


class _NoAffiliate:
    async def get_affiliate_balance(self, uid):
        return None


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("WEEX_KEYS_SECRET", "мастер-ключ-для-тестов")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=77, weex_uid="6067083524")
    session.add(student)
    session.commit()

    app = FastAPI()
    app.include_router(service_api.router)
    app.include_router(trading_api.router)
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student
    app.dependency_overrides[get_weex] = lambda: _NoAffiliate()
    app.dependency_overrides[get_config] = lambda: _config()
    with TestClient(app) as client:
        yield client, session, student, monkeypatch


def okx(monkeypatch, uid: str) -> None:
    # Клиент проверки берётся там же, где подключается счёт: общее место для
    # ключей и входа биржей (backend/trading/connect.py).
    monkeypatch.setattr(connect_mod, "PROBES", {**connect_mod.PROBES, "okx": lambda *_a, **_k: _Probe(uid)})


def confirm(client, items, **who):
    body = {"tg_id": 77, "items": items}
    body.update(who)
    return client.post("/api/service/exchange-uids", json=body, headers=HEADERS)


# ── служебная ручка ──────────────────────────────────────────────────────────


def test_only_the_academy_may_confirm(api):
    client, *_ = api
    assert client.post("/api/service/exchange-uids", json={"tg_id": 77, "items": []}).status_code == 401


def test_confirmed_accounts_are_remembered(api):
    client, session, student, _ = api
    res = confirm(client, [{"exchange": "okx", "uid": "551122"}, {"exchange": "weex", "uid": "PO 6067083524"}])
    assert res.status_code == 200, res.text
    rows = {(r.exchange, r.uid) for r in session.execute(select(AcademyUid)).scalars()}
    # UID приходит как его скопировал человек, а хранится цифрами.
    assert rows == {("okx", "551122"), ("weex", "6067083524")}


def test_a_revoked_account_disappears(api):
    client, session, _, _ = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}, {"exchange": "okx", "uid": "999"}])
    confirm(client, [{"exchange": "okx", "uid": "999"}])
    rows = {r.uid for r in session.execute(select(AcademyUid)).scalars()}
    assert rows == {"999"}


def test_exchanges_not_named_are_left_alone(api):
    client, session, _, _ = api
    confirm(client, [{"exchange": "weex", "uid": "6067083524"}])
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    rows = {(r.exchange, r.uid) for r in session.execute(select(AcademyUid)).scalars()}
    assert rows == {("weex", "6067083524"), ("okx", "551122")}


def test_unknown_exchange_is_refused(api):
    client, *_ = api
    assert confirm(client, [{"exchange": "mtgox", "uid": "1"}]).status_code == 422


def test_listing_answers_what_we_remember(api):
    client, *_ = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    body = client.get("/api/service/exchange-uids", params={"tg_id": 77}, headers=HEADERS).json()
    assert body["uids"] == {"okx": ["551122"]}


# ── подключение счёта ────────────────────────────────────────────────────────


def test_confirmed_account_connects_through_the_academy(api):
    client, session, _, monkeypatch = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    okx(monkeypatch, "551122")

    body = client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"}).json()
    assert body["access"] == "academy"
    row = session.execute(select(ExchangeAccount).where(ExchangeAccount.exchange == "okx")).scalar_one()
    assert (row.exchange_uid, row.access) == ("551122", "academy")


def test_another_account_of_the_same_exchange_is_refused(api):
    """Скидка и кешбэк считаются по подтверждённому номеру - чужой не подключаем."""
    client, session, _, monkeypatch = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    okx(monkeypatch, "777000")

    res = client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})
    assert res.status_code == 409
    assert session.query(ExchangeAccount).count() == 0


def test_without_confirmation_the_exchange_stays_closed(api):
    """Биржа без подтверждения академии не подключается вовсе.

    Раньше такой счёт подключался как свой, с ограничениями. Теперь правило
    другое: сниженная ставка и кешбэк считаются по паре «биржа и UID», и счёт,
    чьего номера академия не подтверждала, в эту пару не попадает - значит и
    подключать его некуда. Человек называет UID в боте академии, владелец
    подтверждает, и биржа появляется в настройках.
    """
    client, session, _, monkeypatch = api
    okx(monkeypatch, "777000")

    res = client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})
    assert res.status_code == 403
    assert "бот академии" in res.json()["detail"]

    status = client.get("/api/trading/status").json()
    okx_row = next(a for a in status["accounts"] if a["exchange"] == "okx")
    assert okx_row["may_connect"] is False
    assert okx_row["connected"] is False


def test_confirmation_opens_the_exchange(api):
    """Подтвердили счёт - биржа открылась, и подключение проходит."""
    client, session, _, monkeypatch = api
    okx(monkeypatch, "777000")
    confirm(client, [{"exchange": "okx", "uid": "777000"}])

    assert next(
        a for a in client.get("/api/trading/status").json()["accounts"]
        if a["exchange"] == "okx"
    )["may_connect"] is True

    body = client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"}).json()
    assert body["access"] == "academy"


def test_weex_account_is_matched_by_the_student_uid(api, monkeypatch):
    """У WEEX номер счёта - это UID ученика, он проверен ещё при входе."""
    client, session, _, inner = api
    confirm(client, [{"exchange": "weex", "uid": "6067083524"}])
    inner.setattr(
        connect_mod, "PROBES", {**connect_mod.PROBES, "weex": lambda *_a, **_k: _Probe()}
    )

    body = client.put("/api/trading/keys", json=KEYS).json()
    assert body["access"] == "academy"


def test_academy_revokes_the_last_account_of_an_exchange(api):
    """Отзыв последнего счёта: биржа названа, счетов по ней нет.

    Пустым списком сказать это нельзя - он ничего не называет, а молчание
    означает «академия прислала только часть». Поэтому биржа называется прямо.
    """
    client, session, _, monkeypatch = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    okx(monkeypatch, "551122")
    client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})

    body = client.post(
        "/api/service/exchange-uids",
        json={"tg_id": 77, "items": [], "exchanges": ["okx"]},
        headers=HEADERS,
    ).json()
    assert body["removed"] == 1

    # Счёт остаётся подключённым, но становится своим: условий академии нет.
    row = session.execute(
        select(ExchangeAccount).where(ExchangeAccount.exchange == "okx")
    ).scalar_one()
    assert row.access == "own"
    assert row.is_active is True


def test_unknown_exchange_in_the_revocation_is_refused(api):
    client, *_ = api
    answer = client.post(
        "/api/service/exchange-uids",
        json={"tg_id": 77, "items": [], "exchanges": ["гдетотам"]},
        headers=HEADERS,
    )
    assert answer.status_code == 422


def test_revoking_the_confirmation_moves_the_account_to_his_own(api):
    client, session, _, monkeypatch = api
    confirm(client, [{"exchange": "okx", "uid": "551122"}])
    okx(monkeypatch, "551122")
    client.put("/api/trading/keys", json={**KEYS, "exchange": "okx"})

    # Академия отозвала подтверждение: счёт остаётся подключённым, но уже своим.
    confirm(client, [])
    confirm(client, [{"exchange": "okx", "uid": "999"}])
    row = session.execute(select(ExchangeAccount).where(ExchangeAccount.exchange == "okx")).scalar_one()
    assert row.access == "own"
