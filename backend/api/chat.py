"""Общий чат: история, отправка и предпросмотр ссылок.

Живая часть чата идёт через WebSocket (``/ws/chat``): там присутствие и новые
сообщения. Здесь всё остальное - то, что нужно спросить один раз при открытии
панели или сделать по нажатию.

Разделение не случайное. Историю листают вверх страницами, и гнать её через
сокет значит держать в нём состояние листания; сокет же обязан оставаться
простым - его рвёт любой уход вкладки в сон.

Картинок этот роутер не хранит: снимок графика уже умеет храниться сам
(``backend/api/shots.py``) и открывается страницей на сайте с превью в
мессенджерах. Чат кладёт в сообщение ссылку на этот снимок - тогда нажатие на
фотографию в ленте открывает её у нас, а не тянет файл в никуда.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from html import unescape

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.deps import get_current_student, get_session
from core.models import ChatMessage, Student

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# Страница истории. Больше сотни за раз панель всё равно не покажет, а меньше
# двадцати - это лишний круг запросов при первом открытии.
PAGE = 50
MAX_PAGE = 100

# Длина сообщения. Ограничение не про экономию места, а про ленту: простыня на
# три экрана выдавливает из панели весь разговор.
MAX_TEXT = 2000


class Attach(BaseModel):
    """Что приложено к сообщению.

    Форма нарочно свободная: у снимка это ссылка и картинка, у сделки - цифры.
    Проверяем то, что уходит в разметку чужого браузера, остальное храним как
    прислали.
    """

    kind: str = Field(pattern="^(shot|trade)$")
    # Снимок: куда ведёт нажатие и что показать в ленте.
    url: str = Field(default="", max_length=512)
    image: str = Field(default="", max_length=512)
    # Сделка или заявка: снимок цифр на момент отправки.
    trade: dict | None = None


class MessageIn(BaseModel):
    text: str = Field(default="", max_length=MAX_TEXT)
    attach: Attach | None = None


def _who(student: Student) -> dict:
    """Подпись автора: как он выглядит в ленте прямо сейчас."""
    return {
        "id": student.id,
        "name": student.card_name or student.username or f"id{student.id}",
        "avatar": student.avatar_url or "",
        "mentor": bool(getattr(student, "is_admin", False)),
    }


def _out(message: ChatMessage, author: Student | None) -> dict:
    attach = None
    if message.attach_json:
        try:
            attach = json.loads(message.attach_json)
        except ValueError:
            # Строку писали мы сами; если она сломалась, сообщение важнее
            # вложения - отдаём без него.
            attach = None
    return {
        "id": message.id,
        "text": message.text,
        "at": message.created_at.isoformat(),
        "author": _who(author) if author is not None else {"id": 0, "name": "?", "avatar": "", "mentor": False},
        "attach": attach,
    }


@router.get("/messages")
def history(
    before: int | None = Query(default=None, description="Читать то, что старше этого id"),
    limit: int = Query(default=PAGE, ge=1, le=MAX_PAGE),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Страница истории, от старых к новым.

    Читаем с конца - свежие нужны первыми, - а отдаём в обратном порядке: лента
    рисуется сверху вниз, и переворачивать её в браузере значит делать это на
    каждой странице заново.
    """
    query = select(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit)
    if before:
        query = query.where(ChatMessage.id < before)

    rows = list(session.execute(query).scalars())
    if not rows:
        return {"messages": [], "more": False}

    authors = {
        s.id: s
        for s in session.execute(
            select(Student).where(Student.id.in_({r.student_id for r in rows}))
        ).scalars()
    }
    rows.reverse()
    return {
        "messages": [_out(r, authors.get(r.student_id)) for r in rows],
        # Столько же, сколько просили - значит впереди, скорее всего, ещё есть.
        "more": len(rows) == limit,
    }


@router.post("/messages", status_code=201)
async def send(
    body: MessageIn,
    request: Request,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Написать в чат. Сообщение уходит в базу и тут же всем, кто в комнате."""
    text = body.text.strip()
    if not text and body.attach is None:
        raise HTTPException(400, "Пустое сообщение")

    row = ChatMessage(
        student_id=student.id,
        text=text,
        attach_json=body.attach.model_dump_json() if body.attach else "",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    payload = _out(row, student)
    hub = getattr(request.app.state, "chat_hub", None)
    if hub is not None:
        await hub.broadcast("message", payload)
    return payload


# ── Предпросмотр ссылки ──
#
# Заголовок и обложку чужой страницы из браузера не достать: их не отдают на
# другой домен. Сходить может только сервер - и сходит он осторожно.

_META = re.compile(
    r"<meta[^>]+(?:property|name)=[\"']og:(title|description|image)[\"'][^>]+content=[\"']([^\"']*)[\"']",
    re.IGNORECASE,
)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)

# Читаем только начало страницы: og-теги живут в head, а качать мегабайты
# чужой разметки ради трёх строк незачем.
PREVIEW_BYTES = 96 * 1024
PREVIEW_TIMEOUT = 6


@router.get("/link")
async def preview(
    url: str = Query(min_length=8, max_length=512),
    student: Student = Depends(get_current_student),
):
    """Заголовок, описание и обложка чужой страницы.

    Ошибки не поднимаем: не открылось - панель покажет домен, как и раньше.
    Сломанный предпросмотр не повод ломать сообщение.
    """
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(400, "Ожидается http-ссылка")

    empty = {"title": "", "description": "", "image": ""}
    try:
        timeout = aiohttp.ClientTimeout(total=PREVIEW_TIMEOUT)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.get(url, allow_redirects=True) as res:
                if res.status >= 400:
                    return empty
                kind = res.headers.get("Content-Type", "")
                if "html" not in kind.lower():
                    return empty
                head = await res.content.read(PREVIEW_BYTES)
    except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError):
        return empty
    except Exception as exc:  # noqa: BLE001 - чужая страница может всё
        logger.info("Предпросмотр %s не собрался: %s", url, exc)
        return empty

    page = head.decode("utf-8", errors="ignore")
    found = {name.lower(): unescape(value) for name, value in _META.findall(page)}
    if not found.get("title"):
        title = _TITLE.search(page)
        if title:
            found["title"] = unescape(title.group(1).strip())

    return {
        "title": found.get("title", "")[:140],
        "description": found.get("description", "")[:200],
        "image": found.get("image", "")[:512],
    }
