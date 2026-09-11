"""Просмотры, лайки и комментарии под разборами ментора.

Просмотр считается читателем, а не открытием; лайк ставится и снимается;
комментарий пишет ученик, убрать его может автор или наставник. Счётчики
приходят вместе со списком разборов.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from backend.security import create_access_token
from core.models import Broadcast, BroadcastComment, BroadcastReaction, Student
from core.weex import get_weex_client

SECRET = "test-secret"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/social.sqlite3")
    monkeypatch.delenv("ADMIN_TG_ID", raising=False)
    config = BackendConfig(
        jwt_secret=SECRET, access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        uid_login_enabled=True,
    )
    return TestClient(create_app(config=config, weex=get_weex_client(use_mock=True)))


def _login(client, uid: str) -> dict:
    token = client.post("/api/auth/login-by-uid", json={"weex_uid": uid}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _broadcast() -> int:
    from core.db import SessionLocal

    with SessionLocal() as s:
        row = Broadcast(text="ENA LONG от накопления", symbol="ENAUSDT")
        s.add(row)
        s.commit()
        return row.id


def _counts(client, auth: dict, broadcast_id: int) -> dict:
    rows = client.get("/api/broadcast", headers=auth).json()
    return next(r for r in rows if r["id"] == broadcast_id)


def test_просмотр_считается_читателем(client):
    bid = _broadcast()
    alex, maria = _login(client, "1001"), _login(client, "1002")

    assert client.post(f"/api/broadcast/{bid}/view", headers=alex).json() == {"views": 1}
    assert client.post(f"/api/broadcast/{bid}/view", headers=alex).json() == {"views": 1}
    assert client.post(f"/api/broadcast/{bid}/view", headers=maria).json() == {"views": 2}
    assert _counts(client, alex, bid)["views"] == 2


def test_лайк_ставится_и_снимается(client):
    bid = _broadcast()
    alex, maria = _login(client, "1001"), _login(client, "1002")

    assert client.post(f"/api/broadcast/{bid}/like", headers=alex).json() == {"liked": True, "likes": 1}
    assert client.post(f"/api/broadcast/{bid}/like", headers=maria).json() == {"liked": True, "likes": 2}
    assert client.post(f"/api/broadcast/{bid}/like", headers=alex).json() == {"liked": False, "likes": 1}

    # Своя отметка видна только своему: у Алекса лайк снят, у Марии стоит.
    assert _counts(client, alex, bid)["liked"] is False
    assert _counts(client, maria, bid)["liked"] is True
    assert _counts(client, maria, bid)["likes"] == 1


def test_комментарии_пишутся_и_считаются(client):
    bid = _broadcast()
    alex = _login(client, "1001")

    made = client.post(f"/api/broadcast/{bid}/comments", json={"text": "  беру от 0.42  "}, headers=alex)
    assert made.status_code == 200
    body = made.json()
    assert body["text"] == "беру от 0.42"
    assert body["mine"] is True
    assert body["author"]["name"]

    listed = client.get(f"/api/broadcast/{bid}/comments", headers=alex).json()
    assert [c["text"] for c in listed] == ["беру от 0.42"]
    assert _counts(client, alex, bid)["comments"] == 1


def test_пустой_длинный_и_частый_комментарий_отклоняются(client):
    bid = _broadcast()
    alex = _login(client, "1001")

    assert client.post(f"/api/broadcast/{bid}/comments", json={"text": "   "}, headers=alex).status_code == 400
    long = "x" * 801
    assert client.post(f"/api/broadcast/{bid}/comments", json={"text": long}, headers=alex).status_code == 400

    assert client.post(f"/api/broadcast/{bid}/comments", json={"text": "раз"}, headers=alex).status_code == 200
    again = client.post(f"/api/broadcast/{bid}/comments", json={"text": "два"}, headers=alex)
    assert again.status_code == 400
    assert "часто" in again.json()["detail"]


def test_чужой_комментарий_не_удалить(client):
    bid = _broadcast()
    alex, maria = _login(client, "1001"), _login(client, "1002")
    cid = client.post(f"/api/broadcast/{bid}/comments", json={"text": "моё"}, headers=alex).json()["id"]

    assert client.delete(f"/api/broadcast/{bid}/comments/{cid}", headers=maria).status_code == 403
    assert client.delete(f"/api/broadcast/{bid}/comments/{cid}", headers=alex).status_code == 200
    assert client.get(f"/api/broadcast/{bid}/comments", headers=alex).json() == []


def test_наставник_убирает_любой_комментарий(client, monkeypatch):
    from core.db import SessionLocal

    bid = _broadcast()
    alex, mentor = _login(client, "1001"), _login(client, "1003")
    with SessionLocal() as s:
        tg = s.query(Student).filter_by(weex_uid="1003").one()
        tg.tg_id = 777
        s.commit()
    monkeypatch.setenv("ADMIN_TG_ID", "777")

    cid = client.post(f"/api/broadcast/{bid}/comments", json={"text": "спам"}, headers=alex).json()["id"]
    assert client.delete(f"/api/broadcast/{bid}/comments/{cid}", headers=mentor).status_code == 200


def test_неизвестный_разбор_404(client):
    alex = _login(client, "1001")
    assert client.post("/api/broadcast/999/like", headers=alex).status_code == 404
    assert client.post("/api/broadcast/999/view", headers=alex).status_code == 404
    assert client.get("/api/broadcast/999/comments", headers=alex).status_code == 404


def test_удаление_разбора_убирает_реакции_и_комментарии(client):
    from core.db import SessionLocal

    bid = _broadcast()
    alex = _login(client, "1001")
    client.post(f"/api/broadcast/{bid}/view", headers=alex)
    client.post(f"/api/broadcast/{bid}/like", headers=alex)
    client.post(f"/api/broadcast/{bid}/comments", json={"text": "ок"}, headers=alex)

    mentor = {"Authorization": f"Bearer {create_access_token('mentor', 'mentor', SECRET, 900)}"}
    assert client.delete(f"/api/broadcast/{bid}", headers=mentor).status_code == 200

    with SessionLocal() as s:
        assert s.query(BroadcastReaction).count() == 0
        assert s.query(BroadcastComment).count() == 0


def test_список_читается_токеном_ментора(client):
    """У токена ментора нет номера ученика: список отдаётся, лайк просто не отмечен."""
    bid = _broadcast()
    mentor = {"Authorization": f"Bearer {create_access_token('mentor', 'mentor', SECRET, 900)}"}
    row = _counts(client, mentor, bid)
    assert row["liked"] is False and row["views"] == 0


def test_заход_в_раздел_отмечает_ленту_разом(client):
    first, second = _broadcast(), _broadcast()
    alex, maria = _login(client, "1001"), _login(client, "1002")

    body = client.post("/api/broadcast/viewed", json={"ids": [first, second, 999]}, headers=alex).json()
    assert body == {"views": {str(first): 1, str(second): 1}}

    # Повторный заход число не накручивает, другой читатель - добавляет.
    client.post("/api/broadcast/viewed", json={"ids": [first, second]}, headers=alex)
    again = client.post("/api/broadcast/viewed", json={"ids": [first]}, headers=maria).json()
    assert again == {"views": {str(first): 2}}
    assert _counts(client, alex, second)["views"] == 1


def test_слишком_много_разборов_за_раз(client):
    alex = _login(client, "1001")
    resp = client.post("/api/broadcast/viewed", json={"ids": list(range(1, 102))}, headers=alex)
    assert resp.status_code == 400
