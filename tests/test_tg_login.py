"""Вход на сайт одноразовым паролем от бота академии.

Проверяем то, что ломается молча. Пароль здесь проверяется сам по себе, без
UID рядом: подходит любой живой пароль любого ученика, и цена ошибки в этом
файле - чужой кабинет, а не кривая вёрстка.
"""

from __future__ import annotations

import hashlib
import os

# Приложение собирается на импорте модуля и требует секрет из окружения.
# Задаём его до импорта: тесты входа не должны зависеть от того, лежит ли на
# машине разработчика настоящий .env.
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from backend.config import BackendConfig  # noqa: E402
from backend.main import create_app  # noqa: E402
from core.db import SessionLocal  # noqa: E402
from core.models import Student, TgAuthCode  # noqa: E402
from core.weex import get_weex_client  # noqa: E402

KEY = "service-secret"


def _config(tmp_path, **over) -> BackendConfig:
    base = dict(
        jwt_secret="s",
        access_ttl_seconds=900,
        refresh_ttl_seconds=86400,
        weex_use_mock=True,
        code_ttl_seconds=300,
        max_code_attempts=5,
        expose_codes=True,
        service_api_key=KEY,
        dev_login=False,
    )
    base.update(over)
    return BackendConfig(**base)


@pytest.fixture()
def app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/tg.sqlite3"
    return TestClient(
        create_app(config=_config(tmp_path), weex=get_weex_client(use_mock=True))
    )


def ask(client: TestClient, tg_id=111, uid="8812345", username="kaktotakxm", key=KEY):
    return client.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": key},
        json={"tg_id": tg_id, "weex_uid": uid, "username": username},
    )


def enter(client: TestClient, code: str):
    return client.post("/api/auth/tg/verify", json={"code": code})


# ── выдача ───────────────────────────────────────────────────────────────────

def test_bot_gets_a_password_and_the_student_appears(app):
    answer = ask(app)
    assert answer.status_code == 200
    body = answer.json()
    assert body["expires_in"] == 300
    # С чертой посередине: пароль набирают руками с экрана телефона.
    assert "-" in body["code"]
    assert len(body["code"].replace("-", "")) == 8

    with SessionLocal() as session:
        student = session.execute(select(Student)).scalars().one()
        assert student.tg_id == 111
        assert student.weex_uid == "8812345"
        assert student.username == "kaktotakxm"
        # Счёт подтвердил бот той же отметкой, по которой открывает курсы.
        assert student.is_approved is True


def test_password_is_not_stored_as_is(app):
    code = ask(app).json()["code"]
    plain = code.replace("-", "")
    with SessionLocal() as session:
        row = session.execute(select(TgAuthCode)).scalars().one()
        assert row.code_hash != plain
        assert row.code_hash == hashlib.sha256(plain.encode()).hexdigest()


def test_without_uid_it_is_a_bot_error(app):
    answer = app.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": KEY},
        json={"tg_id": 111, "weex_uid": "   ", "username": ""},
    )
    assert answer.status_code in (400, 422)


def test_a_stranger_key_gets_nothing(app):
    assert ask(app, key="wrong-key").status_code == 401


def test_platform_without_a_service_key_says_so(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/nokey.sqlite3"
    client = TestClient(
        create_app(
            config=_config(tmp_path, service_api_key=""),
            weex=get_weex_client(use_mock=True),
        )
    )
    assert ask(client).status_code == 503


def test_asking_twice_returns_the_same_password(app):
    # Ученик нажал кнопку дважды - он ждёт один пароль. Выдать второй и погасить
    # первый нельзя: первый он мог уже скопировать, и тот умрёт у него в руках.
    first = ask(app).json()
    second = ask(app).json()
    assert first["code"] == second["code"]
    with SessionLocal() as session:
        assert len(session.execute(select(TgAuthCode)).scalars().all()) == 1
    assert enter(app, first["code"]).status_code == 200


def test_asking_twice_does_not_extend_the_deadline(app):
    # Срок считается от первой выдачи: иначе пароль можно продлевать вечно,
    # нажимая кнопку.
    first = ask(app).json()["expires_in"]
    second = ask(app).json()["expires_in"]
    assert first == 300
    assert second <= first


def test_a_used_password_is_replaced_by_a_new_one(app):
    # Погашенный пароль не «тот же»: живого больше нет, и второй запрос обязан
    # выдать новый, а не вернуть отработавший.
    first = ask(app).json()["code"]
    assert enter(app, first).status_code == 200
    second = ask(app).json()["code"]
    assert second != first
    assert enter(app, second).status_code == 200


# ── ввод ─────────────────────────────────────────────────────────────────────

def test_password_opens_the_cabinet(app):
    code = ask(app).json()["code"]
    answer = enter(app, code)
    assert answer.status_code == 200
    body = answer.json()
    assert body["access_token"] and body["refresh_token"]

    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert app.get("/api/profile", headers=headers).status_code == 200


def test_dash_and_case_do_not_matter(app):
    # Набирают руками, и человек не обязан помнить, где черта.
    code = ask(app).json()["code"]
    assert enter(app, code.replace("-", "").lower()).status_code == 200


def test_the_same_password_does_not_work_twice(app):
    code = ask(app).json()["code"]
    assert enter(app, code).status_code == 200
    assert enter(app, code).status_code == 400


def test_an_unknown_password_is_refused_the_same_way(app):
    # Причину не уточняем: «истёк» и «нет такого» - подсказка перебирающему.
    assert enter(app, "ABCD-2345").status_code == 400


def test_an_expired_password_does_not_work(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/short.sqlite3"
    client = TestClient(
        create_app(
            config=_config(tmp_path, tg_code_ttl_seconds=-1),
            weex=get_weex_client(use_mock=True),
        )
    )
    code = ask(client).json()["code"]
    assert enter(client, code).status_code == 400


def test_the_second_of_two_racing_requests_gets_nothing(app):
    """Гонка: токены получает ровно один.

    Гашение идёт условием внутри UPDATE, а не проверкой в коде - иначе оба
    запроса прошли бы проверку и оба получили бы токены.
    """
    from core import repo

    code = ask(app).json()["code"]
    digest = hashlib.sha256(code.replace("-", "").encode()).hexdigest()
    with SessionLocal() as session:
        assert repo.take_tg_code(session, digest) == 111
        assert repo.take_tg_code(session, digest) is None


# ── связка ключей ────────────────────────────────────────────────────────────

def test_a_student_found_by_uid_gets_the_telegram_key(app):
    with SessionLocal() as session:
        session.add(Student(weex_uid="8812345", created_via="web"))
        session.commit()

    ask(app)
    with SessionLocal() as session:
        student = session.execute(select(Student)).scalars().one()
        assert student.tg_id == 111


def test_a_student_found_by_telegram_gets_the_uid(app):
    with SessionLocal() as session:
        session.add(Student(tg_id=111, created_via="academy"))
        session.commit()

    ask(app)
    with SessionLocal() as session:
        student = session.execute(select(Student)).scalars().one()
        assert student.weex_uid == "8812345"


def test_the_nickname_follows_telegram(app):
    ask(app, username="старый")
    ask(app, username="новый")
    with SessionLocal() as session:
        assert session.execute(select(Student)).scalars().one().username == "новый"


def test_an_empty_nickname_erases_nothing(app):
    # В Telegram ник не обязателен, и у части учеников его нет вовсе.
    ask(app, username="kaktotakxm")
    ask(app, username="")
    with SessionLocal() as session:
        assert session.execute(select(Student)).scalars().one().username == "kaktotakxm"


# ── перебор и переход ────────────────────────────────────────────────────────

def test_guessing_runs_into_the_limit(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/brute.sqlite3"
    client = TestClient(
        create_app(
            config=_config(tmp_path, tg_verify_max=3, tg_verify_window=60),
            weex=get_weex_client(use_mock=True),
        )
    )
    codes = [enter(client, "ZZZZ-9999").status_code for _ in range(4)]
    assert codes[:3] == [400, 400, 400]
    assert codes[3] == 429


def test_uid_login_can_be_closed(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/closed.sqlite3"
    client = TestClient(
        create_app(
            config=_config(tmp_path, uid_login_enabled=False),
            weex=get_weex_client(use_mock=True),
        )
    )
    assert client.post("/api/auth/request-code", json={"weex_uid": "8812345"}).status_code == 403
    assert client.post("/api/auth/login-by-uid", json={"weex_uid": "8812345"}).status_code == 403
    assert (
        client.post("/api/auth/verify", json={"weex_uid": "8812345", "code": "123456"}).status_code
        == 403
    )


def test_closing_uid_login_does_not_lock_out_the_mentor(tmp_path):
    # Им чинят всё остальное - запирать его за тем же ключом, который чинят,
    # нельзя.
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/mentor.sqlite3"
    os.environ["MENTOR_PASSWORD"] = "mentor-pass"
    client = TestClient(
        create_app(
            config=_config(tmp_path, uid_login_enabled=False),
            weex=get_weex_client(use_mock=True),
        )
    )
    answer = client.post("/api/auth/mentor-login", json={"password": "mentor-pass"})
    assert answer.status_code == 200
    assert answer.json()["access_token"]


# ── аватарка ─────────────────────────────────────────────────────────────────

# Однопиксельный PNG: настоящая картинка, а не строка похожего вида.
PIXEL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_avatar_from_telegram_is_saved(app, tmp_path):
    app.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": KEY},
        json={"tg_id": 111, "weex_uid": "8812345", "username": "k", "avatar": PIXEL},
    )
    with SessionLocal() as session:
        student = session.execute(select(Student)).scalars().one()
        assert student.avatar_url
        assert student.avatar_url.startswith("/uploads/avatars/111.png")


def test_an_empty_avatar_erases_nothing(app):
    # В Telegram аватарки может не быть или она закрыта настройками.
    app.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": KEY},
        json={"tg_id": 111, "weex_uid": "8812345", "username": "k", "avatar": PIXEL},
    )
    ask(app)
    with SessionLocal() as session:
        assert session.execute(select(Student)).scalars().one().avatar_url


def test_a_bad_avatar_does_not_break_the_password(app):
    # Аватарка - украшение подписи. Ронять из-за неё выдачу пароля нельзя.
    answer = app.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": KEY},
        json={"tg_id": 111, "weex_uid": "8812345", "username": "k", "avatar": "мусор"},
    )
    assert answer.status_code == 200
    with SessionLocal() as session:
        assert session.execute(select(Student)).scalars().one().avatar_url is None


def test_the_avatar_reaches_the_profile(app):
    app.post(
        "/api/auth/tg/code",
        headers={"X-Service-Key": KEY},
        json={"tg_id": 111, "weex_uid": "8812345", "username": "k", "avatar": PIXEL},
    )
    code = ask(app).json()["code"]
    token = enter(app, code).json()["access_token"]
    body = app.get("/api/profile", headers={"Authorization": f"Bearer {token}"}).json()
    assert body["avatar_url"].startswith("/uploads/avatars/111.png")
