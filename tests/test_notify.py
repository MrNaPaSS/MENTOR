"""Тесты доставки кода входа через notifier (контракт A-10)."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from backend.notify import Notifier, NullNotifier, get_notifier, TelegramNotifier
from core.weex import get_weex_client
from core.db import SessionLocal
from core import repo


class CollectingNotifier(Notifier):
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text):
        self.sent.append((chat_id, text))
        return True


def test_get_notifier_factory():
    assert isinstance(get_notifier(""), NullNotifier)
    assert isinstance(get_notifier("123:abc"), TelegramNotifier)


async def test_null_notifier_returns_false():
    assert await NullNotifier().send_message(1, "hi") is False


class _Resp:
    def __init__(self, status):
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Session:
    def __init__(self, status=200, boom=False):
        self.status = status
        self.boom = boom
        self.posts = []

    def post(self, url, json=None):
        self.posts.append((url, json))
        if self.boom:
            raise RuntimeError("network down")
        return _Resp(self.status)

    async def close(self):
        return None


async def test_telegram_notifier_success():
    sess = _Session(status=200)
    n = TelegramNotifier("123:abc", session=sess)
    assert await n.send_message(555, "code 1") is True
    assert sess.posts[0][1] == {"chat_id": 555, "text": "code 1"}


async def test_telegram_notifier_http_error():
    n = TelegramNotifier("123:abc", session=_Session(status=403))
    assert await n.send_message(555, "x") is False


async def test_telegram_notifier_network_error():
    n = TelegramNotifier("123:abc", session=_Session(boom=True))
    assert await n.send_message(555, "x") is False
    await n.close()  # не закрывает чужую сессию


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/notify.sqlite3")
    config = BackendConfig(
        jwt_secret="s", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=False,
    )
    notifier = CollectingNotifier()
    app = create_app(config=config, weex=get_weex_client(use_mock=True), notifier=notifier)
    return TestClient(app), notifier


def test_request_code_delivers_to_telegram(ctx):
    client, notifier = ctx
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=555, username="alex")
        st.weex_uid = "123456"
        st.is_approved = True
        st.balance_usdt = Decimal("1000")
        s.commit()

    r = client.post("/api/auth/request-code", json={"weex_uid": "123456"})
    assert r.status_code == 200
    # Код доставлен в Telegram чату ученика (tg_id=555), в ответе кода нет (expose_codes=False).
    assert r.json()["code"] is None
    assert len(notifier.sent) == 1
    chat_id, text = notifier.sent[0]
    assert chat_id == 555
    assert "Код входа" in text
