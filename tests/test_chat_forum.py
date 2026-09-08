"""Мост чата с форумом: разметка наружу и приём обратно."""

from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient

from backend.api.chat import _has_picture, _shot_symbol
from backend.chat.format import link_ranges, message_html, text_html, trade_html
from backend.chat.forum import ForumBridge
from backend.config import BackendConfig
from backend.main import create_app
from core.db import SessionLocal
from core.models import ChartShot, ChatBridge, ChatMessage, ChatThread, Student
from core.weex import get_weex_client

SERVICE_KEY = "forum-secret-key"
HEADERS = {"X-Service-Key": SERVICE_KEY}
FORUM = -1003567202226


def _config(**over) -> BackendConfig:
    base = dict(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        service_api_key=SERVICE_KEY,
    )
    base.update(over)
    return BackendConfig(**base)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/forum.sqlite3")
    app = create_app(config=_config(), weex=get_weex_client(use_mock=True))
    return TestClient(app)


def _message(**over) -> dict:
    body = {
        "tg_chat_id": FORUM,
        "tg_message_id": 1001,
        # Тема «крипто трейд»: заводится сама при создании таблиц.
        "topic_id": 10,
        "author": {"tg_id": 555, "name": "Андрей", "username": "kaktotakxm"},
        "text": "беру отсюда",
        "links": [],
    }
    body.update(over)
    return body


# ── Разметка для Telegram ────────────────────────────────────────────────────


def test_hidden_link_keeps_the_words():
    """«BTC 1m» остаётся «BTC 1m», адрес прячется внутрь."""
    html = text_html("BTC 1m", [{"offset": 0, "length": 6, "url": "https://tv.com/x/A"}])
    assert html == '<a href="https://tv.com/x/A">BTC 1m</a>'


def test_link_covers_only_its_own_letters():
    html = text_html("смотри BTC тут", [{"offset": 7, "length": 3, "url": "https://a.io/1"}])
    assert html == 'смотри <a href="https://a.io/1">BTC</a> тут'


def test_foreign_text_is_escaped():
    """Чужой текст в разметку уходит только обезвреженным."""
    assert "<b>" not in text_html("<b>жирно</b>", [])
    # Имя автора приходит из Telegram и в разметку уходит так же обезвреженным.
    assert message_html("<script>", "", [], None) == "<b>&lt;script&gt;</b>"


def test_overlapping_links_are_dropped():
    """Ссылка внутри ссылки невозможна: второй отрезок пропускается."""
    html = text_html(
        "abcdef",
        [
            {"offset": 0, "length": 4, "url": "https://a.io/1"},
            {"offset": 2, "length": 2, "url": "https://a.io/2"},
        ],
    )
    assert html.count("<a href") == 1


def test_broken_links_json_reads_as_empty():
    assert link_ranges("") == []
    assert link_ranges("{не json") == []
    # Адрес не по протоколу http в разметку не попадает.
    assert link_ranges('[{"offset":0,"length":2,"url":"javascript:alert(1)"}]') == []


def test_waiting_order_has_no_result():
    """У ждущей заявки результата нет, и подставлять ноль нельзя."""
    card = trade_html(
        {"symbol": "ETHUSDT", "side": "long", "leverage": 20, "state": "planned",
         "entry": 3120.5, "stop": 3080.0, "targets": [3200.0]}
    )
    assert "ждёт входа" in card
    assert "$" not in card


def test_prices_stay_on_the_card_and_not_in_the_message():
    """Цены рисует карточка. Столбик тех же чисел под ней их не уточняет."""
    card = trade_html(
        {"symbol": "BTCUSDT", "side": "short", "leverage": 200, "state": "planned",
         "entry": 78794.5, "stop": 79188.47, "targets": [78400.53, 78006.55]},
        url="https://api.nmnh.trade/7N3UyD0CnU4y",
    )
    assert len(card.splitlines()) == 1
    # «Вход» на месте только как состояние заявки - «ждёт входа»; цифр нет.
    for gone in ("794", "188", "400", "стоп", "цель"):
        assert gone not in card
    assert "×200" in card


def test_open_trade_shows_result_and_link():
    card = trade_html(
        {"symbol": "BTCUSDT", "side": "short", "leverage": 100, "state": "open",
         "entry": 78647.3, "stop": 78820.3, "targets": [78474.28], "pnl": 16.59, "margin": 100.0},
        url="https://www.nmnh.trade/s/abc",
    )
    assert "+16.59 $" in card
    assert '<a href="https://www.nmnh.trade/s/abc">' in card


def test_author_is_signed_because_the_bot_writes():
    """Telegram не даёт писать от имени человека - подпись единственный способ."""
    assert message_html("Андрей", "привет", [], None).startswith("<b>Андрей</b>")


# ── Очередь доставки ─────────────────────────────────────────────────────────


def test_bridge_without_settings_is_silent():
    bridge = ForumBridge("", 0, "")
    assert bridge.enabled is False
    # Задание молча не ставится: моста нет, а ошибки быть не должно.
    bridge.submit({"op": "send"})


def test_button_leads_to_the_coin():
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    keyboard = bridge._keyboard("BTCUSDT", "Перейти к терминалу")
    url = keyboard["inline_keyboard"][0][0]["url"]
    assert url == "https://www.nmnh.trade/app/scalping?symbol=BTCUSDT"


def test_button_needs_a_coin():
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    assert bridge._keyboard("", "Перейти") is None


# ── Приём из форума ──────────────────────────────────────────────────────────


def test_service_key_is_required(client):
    res = client.post("/api/chat/forum", json=_message())
    assert res.status_code == 401


def test_message_lands_in_the_branch(client):
    res = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    assert res.status_code == 201

    with SessionLocal() as session:
        row = session.get(ChatMessage, res.json()["id"])
        thread = session.get(ChatThread, row.thread_id)
        assert thread.tg_topic_id == 10
        # Автор заведён записью, а не строкой с ником: он придёт на сайт тем же
        # Telegram и получит свои же сообщения.
        author = session.get(Student, row.student_id)
        assert author.tg_id == 555
        assert author.created_via == "forum"


def test_the_same_message_is_not_taken_twice(client):
    """Наше же сообщение, вернувшееся обновлением, по кругу не идёт."""
    first = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    again = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    assert first.status_code == 201
    assert again.json() == {"skipped": "уже есть"}


def test_unknown_topic_is_skipped(client):
    res = client.post("/api/chat/forum", json=_message(topic_id=999999), headers=HEADERS)
    assert res.json() == {"skipped": "тема не заведена"}


def test_service_records_are_skipped(client):
    res = client.post("/api/chat/forum", json=_message(text="  "), headers=HEADERS)
    assert res.json() == {"skipped": "пусто"}


def test_hidden_links_survive_the_trip(client):
    links = [{"offset": 0, "length": 6, "url": "https://tradingview.com/x/AbC"}]
    res = client.post(
        "/api/chat/forum", json=_message(text="BTC 1m", links=links), headers=HEADERS
    )
    with SessionLocal() as session:
        row = session.get(ChatMessage, res.json()["id"])
        assert json.loads(row.links_json) == links


def test_edit_finds_its_message(client):
    first = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    client.post(
        "/api/chat/forum",
        json=_message(text="передумал", edited=True),
        headers=HEADERS,
    )
    with SessionLocal() as session:
        row = session.get(ChatMessage, first.json()["id"])
        assert row.text == "передумал"
        assert row.edited_at is not None


def test_reply_points_at_our_message(client):
    first = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    second = client.post(
        "/api/chat/forum",
        json=_message(tg_message_id=1002, reply_to_tg_message_id=1001),
        headers=HEADERS,
    )
    with SessionLocal() as session:
        row = session.get(ChatMessage, second.json()["id"])
        assert row.reply_to_id == first.json()["id"]


def test_bridge_row_is_written(client):
    res = client.post("/api/chat/forum", json=_message(), headers=HEADERS)
    with SessionLocal() as session:
        link = session.query(ChatBridge).filter_by(tg_message_id=1001).one()
        assert link.message_id == res.json()["id"]
        assert link.tg_chat_id == FORUM


def test_broken_photo_does_not_lose_the_message(client):
    """Картинка не сохранилась - текст всё равно доезжает."""
    res = client.post(
        "/api/chat/forum",
        json=_message(photo=base64.b64encode(b"not a picture").decode()),
        headers=HEADERS,
    )
    assert res.status_code == 201
    with SessionLocal() as session:
        row = session.get(ChatMessage, res.json()["id"])
        assert row.attach_json == ""
        assert row.text == "беру отсюда"


# ── Ветки на сайте ───────────────────────────────────────────────────────────


def test_branches_are_seeded():
    """Четыре ветки заводятся при создании таблиц - те же, что темы форума."""
    with SessionLocal() as session:
        topics = {t.tg_topic_id for t in session.query(ChatThread).all()}
    assert {10, 14, 8, 32281} <= topics


# ── Картинка под сообщением ──────────────────────────────────────────────────


def test_picture_unfolds_only_where_it_is_the_message():
    """Превью разворачивается у снимка и карточки - и только у них.

    Ссылка на график это и есть сообщение: свёрнутая в строку, она требует
    нажатия, чтобы понять, о чём речь. А у слов ссылка остаётся ссылкой.
    """
    shot = {"kind": "shot", "url": "https://s.nmnh.trade/abc12345"}
    trade = {"kind": "trade", "url": "https://s.nmnh.trade/xyz98765", "trade": {"symbol": "BTC"}}
    assert _has_picture(shot) is True
    assert _has_picture(trade) is True
    assert _has_picture(None) is False
    # Карточка не собралась - разворачивать нечего.
    assert _has_picture({"kind": "trade", "url": "", "trade": {}}) is False
    # Чужая схема в адресе картинкой не станет.
    assert _has_picture({"kind": "shot", "url": "javascript:alert(1)"}) is False


def test_shot_button_takes_the_coin_from_the_record(client):
    """Монету под снимком берём из записи о нём: в приложении её нет."""
    with SessionLocal() as session:
        session.add(ChartShot(id="abc12345", symbol="ETHUSDT", interval="5m", note=""))
        session.commit()

        assert _shot_symbol(session, "https://s.nmnh.trade/abc12345") == "ETHUSDT"
        # Картинка карточки лежит под тем же именем с хвостом.
        assert _shot_symbol(session, "https://s.nmnh.trade/abc12345-raw.png") == "ETHUSDT"
        # Фотография из форума своей записи не имеет - и кнопки не получит.
        assert _shot_symbol(session, "https://s.nmnh.trade/zzz99999.jpg") == ""
        assert _shot_symbol(session, "") == ""


# ── Сколько нас в форуме ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_forum_size_is_asked_once(monkeypatch):
    """Размер группы спрашиваем раз и держим: его читают на каждый вход."""
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    calls = []

    async def fake(method, payload):
        calls.append(method)
        return 137

    monkeypatch.setattr(bridge, "_call", fake)
    assert await bridge.members() == 137
    assert await bridge.members() == 137
    assert calls == ["getChatMemberCount"]


@pytest.mark.asyncio
async def test_forum_size_without_bridge_is_zero():
    """Моста нет - числа нет. Выдумывать его нельзя: рядом стоит настоящее."""
    assert await ForumBridge("", 0, "").members() == 0


# ── Карточка уходит картинкой ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_card_goes_as_a_picture(monkeypatch):
    """Карточку отправляем картинкой, а не ссылкой на неё.

    Предпросмотр собирает обходчик Telegram и по своим правилам: не дотянулся
    или не уложился в вес - в теме висит серый прямоугольник. Отправленная
    картинка так не подводит.
    """
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    calls = []

    async def fake(method, payload):
        calls.append((method, payload))
        return {"message_id": 7}

    monkeypatch.setattr(bridge, "_call", fake)
    monkeypatch.setattr(bridge, "_remember", lambda *_: None)
    await bridge._send(
        {
            "op": "send",
            "message_id": 1,
            "html": "<b>Андрей</b>",
            "photo": "https://api.nmnh.trade/abc12345.png",
            "open": "https://api.nmnh.trade/abc12345",
            "preview": True,
        }
    )

    method, payload = calls[0]
    assert method == "sendPhoto"
    assert payload["photo"] == "https://api.nmnh.trade/abc12345.png"
    assert payload["caption"] == "<b>Андрей</b>"
    # Кнопка ведёт на страницу карточки: в терминал человек уйдёт уже с неё.
    button = payload["reply_markup"]["inline_keyboard"][0][0]
    assert button["url"] == "https://api.nmnh.trade/abc12345"


@pytest.mark.asyncio
async def test_words_go_as_words(monkeypatch):
    """У разговора картинки нет - и сообщение остаётся сообщением."""
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    calls = []

    async def fake(method, payload):
        calls.append(method)
        return {"message_id": 8}

    monkeypatch.setattr(bridge, "_call", fake)
    monkeypatch.setattr(bridge, "_remember", lambda *_: None)
    await bridge._send({"op": "send", "message_id": 2, "html": "<b>Андрей</b> привет"})
    assert calls == ["sendMessage"]


@pytest.mark.asyncio
async def test_picture_falls_back_to_words(monkeypatch):
    """Telegram отказал картинке - сообщение всё равно уходит: разговор важнее."""
    bridge = ForumBridge("token", FORUM, "https://www.nmnh.trade")
    calls = []

    async def fake(method, payload):
        calls.append(method)
        return None if method == "sendPhoto" else {"message_id": 9}

    monkeypatch.setattr(bridge, "_call", fake)
    monkeypatch.setattr(bridge, "_remember", lambda *_: None)
    await bridge._send(
        {"op": "send", "message_id": 3, "html": "<b>Андрей</b>", "photo": "https://x/y.png"}
    )
    assert calls == ["sendPhoto", "sendMessage"]
