"""Витрина бирж и вход биржей.

Проверяем то, чем витрина отличается от рекламы: она не обещает условий,
которых нет, и не предлагает вход там, где брокерского ID у нас ещё не
получено. И то, на чём держится безопасность входа: чужое состояние не
открывает счёт, а токен без ключей торговли не считается подключением.
"""

from __future__ import annotations
from datetime import datetime, timedelta, timezone

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import exchanges as exchanges_api
from backend.config import BackendConfig
from backend.deps import get_current_student, get_session
from backend.security import encode_token
from backend.trading import connect as connect_mod
from core import oauth
from core.models import AcademyUid, Base, ExchangeAccount, LiveTrade, Student

SECRET = "секрет-для-тестов"


def _config() -> BackendConfig:
    return BackendConfig(
        jwt_secret=SECRET,
        access_ttl_seconds=900,
        refresh_ttl_seconds=86400,
        weex_use_mock=True,
        code_ttl_seconds=300,
        max_code_attempts=3,
        expose_codes=False,
    )


class _Probe:
    """Биржа, которая отвечает на проверку ключей и называет номер счёта."""

    def __init__(self, uid: str = "551122"):
        self._uid = uid

    async def balance(self, margin_coin="USDT"):
        return [{"marginCoin": "USDT", "availableBalance": "100"}]

    async def account_uid(self):
        return self._uid


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("WEEX_KEYS_SECRET", "мастер-ключ-для-тестов")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    # Пришёл через академию на WEEX, счёт на OKX подтверждён отдельно: без
    # подтверждения биржа в настройках не открывается (may_connect).
    student = Student(tg_id=42, weex_uid="6067083524")
    session.add(student)
    session.flush()
    # Номер тот же, что назовёт пробник биржи: иначе подключение отклонится
    # как счёт, подтверждённый на другой UID.
    session.add(AcademyUid(student_id=student.id, exchange="okx", uid="551122"))
    session.commit()

    monkeypatch.setattr(
        connect_mod,
        "PROBES",
        {"weex": lambda *_a, **_k: _Probe(), "okx": lambda *_a, **_k: _Probe()},
    )

    app = FastAPI()
    app.include_router(exchanges_api.router)
    app.state.config = _config()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_student] = lambda: student
    with TestClient(app) as client:
        yield client, session, student, monkeypatch


# ── витрина ─────────────────────────────────────────────────────────────────


def test_showcase_lists_venues_and_their_state(api):
    client, *_ = api
    body = client.get("/api/exchanges").json()

    codes = [v["exchange"] for v in body["venues"]]
    assert codes[:2] == ["weex", "okx"]   # первыми те, где уже торгуем
    okx = next(v for v in body["venues"] if v["exchange"] == "okx")
    assert okx["trading"] is True
    assert okx["book"] is True            # своя книга, backend/scalping/okx_collector.py
    assert okx["connected"] is False


def test_showcase_opens_only_confirmed_exchanges(api):
    """Биржа открывается подтверждением академии, а не списком адаптеров.

    У этого ученика подтверждён OKX и есть WEEX по регистрации; BingX
    подтверждения не имеет - и подключать её нечем, хотя адаптер у неё есть.
    """
    client, *_ = api
    rows = {v["exchange"]: v for v in client.get("/api/exchanges").json()["venues"]}

    assert rows["weex"]["may_connect"] is True
    assert rows["okx"]["may_connect"] is True
    assert rows["bingx"]["keys_supported"] is True
    assert rows["bingx"]["may_connect"] is False
    # Биржи без адаптера на витрине кабинета нет вовсе: подключать нечем, и
    # строка, с которой ничего не сделать, читается как обещание срока.
    assert "bybit" not in rows


def test_showcase_shows_only_tradable_exchanges(api):
    """На витрине кабинета только биржи, где терминал торгует.

    Остальные - строка, с которой ничего нельзя сделать: ни счёт открыть, ни
    ключи подключить. Их число названо словами на главной, и там это уместно.
    """
    client, *_ = api
    codes = {v["exchange"] for v in client.get("/api/exchanges").json()["venues"]}
    assert codes == {"weex", "okx", "bingx", "mexc", "binance"}


def test_showcase_does_not_promise_a_rate_nobody_confirmed(api):
    """Сниженной ставки биржи не называли - на витрине её нет."""
    client, *_ = api
    body = client.get("/api/exchanges").json()
    for venue in body["venues"]:
        assert venue["academy_taker"] is None


def test_cashback_matches_what_the_academy_promises(api):
    """Доля возврата - та же, что ученик прочитал в боте академии.

    Человек видит цифру сначала там, потом здесь: расхождение он заметит первым
    же делом, и дороже всего оно обойдётся именно на деньгах.
    """
    client, *_ = api
    rows = {v["exchange"]: v["cashback"] for v in client.get("/api/exchanges").json()["venues"]}
    assert rows["weex"] == 0.15
    assert rows["okx"] == 0.10
    assert rows["bingx"] == 0.10
    # Неподключённых бирж здесь нет - им и обещать нечего.
    assert "bybit" not in rows
    # MEXC: те же 10%, что на OKX и BingX - решение владельца от 14 сентября,
    # и бот академии обещает ученику ровно эту цифру.
    assert rows["mexc"] == 0.10
    # Binance: ноль - это ответ, а не молчание. Биржа запрещает партнёрам
    # возвращать комиссию пользователям, и витрина обязана сказать это прямо,
    # иначе ученик узнает правду после регистрации.
    assert rows["binance"] == 0.0


def test_oauth_is_not_offered_until_the_broker_id_arrives(api, monkeypatch):
    """Вход биржей включается настройками, а их без брокерского ID нет."""
    client, *_ = api
    monkeypatch.delenv("OKX_OAUTH_CLIENT_ID", raising=False)
    body = client.get("/api/exchanges").json()
    okx = next(v for v in body["venues"] if v["exchange"] == "okx")
    assert "oauth" in okx["connect"]      # путь описан
    assert okx["oauth_ready"] is False    # но сегодня не работает


def test_showcase_shows_connected_account(api):
    client, session, student, _ = api
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})

    body = client.get("/api/exchanges").json()
    okx = next(v for v in body["venues"] if v["exchange"] == "okx")
    assert okx["connected"] is True
    assert okx["auth_kind"] == "keys"
    assert body["active"] == "okx"        # первый счёт становится активным


def test_key_without_trading_right_is_not_connected(api, monkeypatch):
    """Ключ на чтение до счёта не допускается: отказ приходит сразу, не на заявке.

    OKX выдаёт торговое право, только когда на счёте есть сто долларов. Баланс
    читается и ключом без этого права, поэтому проверки балансом мало: счёт
    подключался успешно, а биржа отказывала потом - в момент, когда ученик уже
    нажал «войти».
    """

    class ReadOnly(_Probe):
        async def can_trade(self):
            return False

    client, session, _st, inner = api
    inner.setattr(
        connect_mod, "PROBES", {**connect_mod.PROBES, "okx": lambda *_a, **_k: ReadOnly()}
    )

    answer = client.post(
        "/api/exchanges/okx/keys",
        json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"},
    )
    assert answer.status_code == 400
    assert "100 USD" in answer.json()["detail"]
    assert session.execute(select(ExchangeAccount)).scalars().all() == []


def test_silence_about_rights_does_not_block_the_connection(api, monkeypatch):
    """Биржа не назвала права - подключаем. Молчание не повод отказывать."""

    class Silent(_Probe):
        async def can_trade(self):
            return None

    client, session, _st, inner = api
    inner.setattr(
        connect_mod, "PROBES", {**connect_mod.PROBES, "okx": lambda *_a, **_k: Silent()}
    )

    answer = client.post(
        "/api/exchanges/okx/keys",
        json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"},
    )
    assert answer.status_code == 200
    assert session.execute(select(ExchangeAccount)).scalars().one().exchange == "okx"


# ── активная биржа и отключение ─────────────────────────────────────────────


def test_active_needs_a_connected_account(api):
    client, *_ = api
    answer = client.post("/api/exchanges/active", json={"exchange": "okx"})
    assert answer.status_code == 409


def test_account_with_a_live_trade_is_not_disconnected(api):
    client, session, student, _ = api
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    session.add(
        LiveTrade(
            student_id=student.id,
            client_id="проверка",
            symbol="BTCUSDT",
            side="LONG",
            status="open",
            exchange="okx",
            entry=1,
            initial_stop=0.9,
            current_stop=0.9,
            qty=1,
            leverage=1,
        )
    )
    session.commit()

    answer = client.delete("/api/exchanges/okx")
    assert answer.status_code == 409
    assert session.execute(select(ExchangeAccount)).scalars().all()


def _live_trade(session, student, exchange: str, client_id: str = "проверка") -> None:
    session.add(
        LiveTrade(
            student_id=student.id,
            client_id=client_id,
            symbol="BTCUSDT",
            side="LONG",
            status="open",
            exchange=exchange,
            entry=1,
            initial_stop=0.9,
            current_stop=0.9,
            qty=1,
            leverage=1,
        )
    )
    session.commit()


def test_second_exchange_does_not_disconnect_the_first(api):
    """Подключение биржи не выбивает предыдущую: счета живут рядом."""
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})

    rows = {row.exchange: row for row in session.execute(select(ExchangeAccount)).scalars()}
    assert set(rows) == {"weex", "okx"}
    assert all(row.is_active for row in rows.values())
    # Активной остаётся первая: вторая биржа сама себя активной не назначает.
    session.refresh(student)
    assert student.active_exchange == "weex"


def test_exchange_switches_while_nothing_is_running(api):
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})

    answer = client.post("/api/exchanges/active", json={"exchange": "okx"})
    assert answer.status_code == 200
    session.refresh(student)
    assert student.active_exchange == "okx"


def test_exchange_does_not_switch_under_a_live_trade(api):
    """Сделка идёт - биржу не сменить, и неважно, на какой она бирже.

    Иначе позиция остаётся на одной бирже, а следующая заявка уходит на
    другую, и человек перестаёт понимать, где он торгует.
    """
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    _live_trade(session, student, "weex")

    answer = client.post("/api/exchanges/active", json={"exchange": "okx"})
    assert answer.status_code == 409
    assert "WEEX" in answer.json()["detail"]
    session.refresh(student)
    assert student.active_exchange == "weex"


def test_stale_trade_does_not_lock_the_switch(api):
    """Брошенная запись не запирает биржу навсегда.

    Сопровождение отмечает каждую сделку на обходе. Если до неё никто не
    доходит - счёт биржи отключили, ключи протухли, запись осталась от старой
    позиции, - метка стареет. Такая строка не должна держать человека: позиции
    за ней нет, а сменить биржу он не может.
    """
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    _live_trade(session, student, "weex")

    stale = session.execute(select(LiveTrade)).scalars().first()
    stale.updated_at = datetime.now(timezone.utc) - timedelta(hours=3)
    session.commit()

    answer = client.post("/api/exchanges/active", json={"exchange": "okx"})
    assert answer.status_code == 200
    session.refresh(student)
    assert student.active_exchange == "okx"


def test_stale_trade_still_holds_the_keys(api):
    """А вот отключить счёт она по-прежнему не даёт.

    Ключ может понадобиться, чтобы эту же запись закрыть: снять его значит
    оставить позицию, если она всё-таки есть, без сопровождения.
    """
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    _live_trade(session, student, "weex")

    stale = session.execute(select(LiveTrade)).scalars().first()
    stale.updated_at = datetime.now(timezone.utc) - timedelta(hours=3)
    session.commit()

    assert client.delete("/api/exchanges/weex").status_code == 409


def test_same_exchange_is_not_a_switch(api):
    """Повторный выбор той же биржи проходит и под сделкой: менять нечего."""
    client, session, student, _ = api
    client.post("/api/exchanges/weex/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    _live_trade(session, student, "weex")

    answer = client.post("/api/exchanges/active", json={"exchange": "weex"})
    assert answer.status_code == 200


def test_showcase_counts_live_trades(api):
    """Витрина отдаёт, где идут сделки: по ней фронт запирает кнопку."""
    client, session, student, _ = api
    client.post("/api/exchanges/okx/keys", json={"api_key": "k" * 12, "secret_key": "s", "passphrase": "p"})
    _live_trade(session, student, "okx")

    body = client.get("/api/exchanges").json()
    assert body["live_total"] == 1
    rows = {one["exchange"]: one for one in body["venues"]}
    assert rows["okx"]["live"] == 1
    assert rows["weex"]["live"] == 0


# ── вход биржей ─────────────────────────────────────────────────────────────


def _enable_oauth(monkeypatch) -> None:
    monkeypatch.setenv("OKX_OAUTH_CLIENT_ID", "nmnh")
    monkeypatch.setenv("OKX_OAUTH_CLIENT_SECRET", "секрет")
    monkeypatch.setenv("OKX_OAUTH_AUTHORIZE_URL", "https://okx.example/oauth/authorize")
    monkeypatch.setenv("OKX_OAUTH_TOKEN_URL", "https://okx.example/oauth/token")
    monkeypatch.setenv("OKX_OAUTH_REDIRECT", "https://nmnh.trade/app/exchanges")


def test_start_refuses_while_the_login_is_off(api):
    client, _s, _st, monkeypatch = api
    monkeypatch.delenv("OKX_OAUTH_CLIENT_ID", raising=False)
    answer = client.post("/api/exchanges/okx/oauth/start", json={})
    assert answer.status_code == 503
    assert "ключами" in answer.json()["detail"]


def test_start_gives_the_address_with_a_challenge(api):
    client, _s, _st, monkeypatch = api
    _enable_oauth(monkeypatch)
    body = client.post("/api/exchanges/okx/oauth/start", json={}).json()
    assert body["url"].startswith("https://okx.example/oauth/authorize?")
    # Секрет проверки в адрес не уходит - только его отпечаток.
    assert "code_challenge=" in body["url"]
    assert "code_verifier" not in body["url"]
    assert body["state"]


def test_finish_refuses_a_state_of_another_student(api):
    client, _s, _st, monkeypatch = api
    _enable_oauth(monkeypatch)
    now = int(time.time())
    alien = encode_token(
        {"sub": "999", "type": "oauth", "exchange": "okx", "verifier": "x", "iat": now, "exp": now + 300},
        SECRET,
    )
    answer = client.post("/api/exchanges/okx/oauth/finish", json={"code": "c", "state": alien})
    assert answer.status_code == 403


def test_finish_refuses_an_expired_state(api):
    client, _s, _st, monkeypatch = api
    _enable_oauth(monkeypatch)
    old = int(time.time()) - 10_000
    state = encode_token(
        {"sub": "1", "type": "oauth", "exchange": "okx", "verifier": "x", "iat": old, "exp": old + 300},
        SECRET,
    )
    answer = client.post("/api/exchanges/okx/oauth/finish", json={"code": "c", "state": state})
    assert answer.status_code == 400


def test_token_without_trading_keys_is_not_a_connection(api, monkeypatch):
    """Биржа вернула вход, но не ключи - счёт не подключён, и мы говорим прямо."""
    client, session, _st, inner = api
    _enable_oauth(inner)

    async def only_token(*_args, **_kwargs):
        return {"access_token": "t", "expires_in": 3600}

    inner.setattr(oauth, "exchange", only_token)
    state = client.post("/api/exchanges/okx/oauth/start", json={}).json()["state"]
    answer = client.post("/api/exchanges/okx/oauth/finish", json={"code": "c", "state": state})
    assert answer.status_code == 501
    assert session.execute(select(ExchangeAccount)).scalars().all() == []


def test_login_with_keys_connects_the_account(api, monkeypatch):
    client, session, _st, inner = api
    _enable_oauth(inner)

    async def with_keys(*_args, **_kwargs):
        return {
            "access_token": "t",
            "refresh_token": "r",
            "expires_in": 3600,
            "apiKey": "ключ-биржи",
            "secretKey": "секрет-биржи",
            "passphrase": "фраза",
        }

    inner.setattr(oauth, "exchange", with_keys)
    state = client.post("/api/exchanges/okx/oauth/start", json={}).json()["state"]
    body = client.post("/api/exchanges/okx/oauth/finish", json={"code": "c", "state": state}).json()

    assert body["auth_kind"] == "oauth"
    row = session.execute(select(ExchangeAccount)).scalar_one()
    assert row.exchange == "okx"
    assert row.auth_kind == "oauth"
    assert row.oauth_token_enc            # токен сохранён и зашифрован
    assert row.oauth_token_enc != "t"
    assert row.is_active is True


# ── сам слой входа ──────────────────────────────────────────────────────────


def test_challenge_is_not_the_verifier():
    verifier = oauth.new_verifier()
    assert oauth.challenge_of(verifier) != verifier
    # Отпечаток один и тот же при каждом счёте - иначе биржа его не сверит.
    assert oauth.challenge_of(verifier) == oauth.challenge_of(verifier)


def test_grant_reads_nested_answers():
    """Часть бирж кладёт ответ в `data` - это тот же ответ."""
    grant = oauth.read_grant({"data": {"accessKey": "k", "secretKey": "s", "uid": "77"}})
    assert (grant.api_key, grant.secret_key, grant.uid) == ("k", "s", "77")
    assert grant.tradable is True


def test_grant_without_keys_is_not_tradable():
    assert oauth.read_grant({"access_token": "t"}).tradable is False
