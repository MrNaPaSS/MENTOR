"""Приём сообщений из форумной группы в общий чат.

Сюда стучится бот академии: он единственный, кто видит форум, - и он же
единственный, кому Telegram отдаёт обновления этой группы. Проверка та же, что
у начисления монет: общий секрет в заголовке, потому что ходит сервер, а не
браузер ученика.

Почему не бот пишет прямо в базу. Сообщение в чате - это не только строка в
таблице, но и рассылка всем, кто сейчас в комнате; сокеты живут в этом
процессе, и запись мимо него означала бы сообщение, которое появится у людей
только после перезагрузки страницы.

Что приходит отсюда, считается недоверенным целиком. Имя, текст и ссылки пишут
посторонние люди в чужой группе, и в разметку они уходят только через
экранирование.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.api.coins import find_or_create_student, require_service_key
from backend.api.shots import save_photo, shot_origin
from backend.deps import get_session
from core.models import ChatBridge, ChatMessage, ChatThread, Student, utcnow

router = APIRouter(prefix="/api/chat/forum", tags=["chat"])
logger = logging.getLogger("nmnh.forum")

# Столько же, сколько принимает сам чат: сообщение из форума ничем не
# отличается от написанного на сайте.
MAX_TEXT = 2000


class ForumLink(BaseModel):
    """Отрезок текста со спрятанной ссылкой - так их отдаёт Telegram."""

    offset: int = Field(ge=0)
    length: int = Field(gt=0)
    url: str = Field(min_length=8, max_length=512, pattern="^https?://")


class ForumAuthor(BaseModel):
    tg_id: int
    name: str = Field(default="", max_length=64)
    username: str = Field(default="", max_length=64)


class ForumMessage(BaseModel):
    """Сообщение из темы форума."""

    tg_chat_id: int
    tg_message_id: int
    # Номер темы. Без неё сообщение написано в общую ленту группы, а не в
    # ветку, и на сайте ему места нет.
    topic_id: int | None = None
    author: ForumAuthor
    text: str = Field(default="", max_length=MAX_TEXT)
    links: list[ForumLink] = Field(default_factory=list, max_length=10)
    # Фотография из сообщения, в base64. Кладём её у себя: ссылка Telegram
    # живёт часами и несёт в себе токен бота, а картинка в ленте должна
    # открываться и завтра, и у того, кто в Telegram не заходил.
    photo: str = Field(default="", max_length=12_000_000)
    # На какое сообщение форума это ответ.
    reply_to_tg_message_id: int | None = None
    # Сообщение не новое, а поправленное: Telegram присылает правки отдельным
    # видом обновления.
    edited: bool = False


def _author(session, body: ForumMessage) -> Student:
    """Ученик за автором сообщения. Незнакомого заводим.

    Записью, а не строкой с ником: человек может прийти на сайт завтра тем же
    Telegram, и тогда его сообщения обязаны остаться его собственными, а не
    достаться безымянному гостю.
    """
    student, created = find_or_create_student(
        session,
        tg_id=body.author.tg_id,
        weex_uid=None,
        username=body.author.username or body.author.name or None,
    )
    if created:
        student.created_via = "forum"
        # Имя на карточке берём то, под которым человек пишет в форуме: иначе
        # в ленте он появится как «id417» рядом с теми, у кого имя есть.
        student.card_name = (body.author.name or "")[:32] or None
        session.flush()
    return student


def _attach(body: ForumMessage, base: str) -> dict | None:
    """Что приложено к сообщению.

    Фотография - снимком: в ленте она открывается так же, как снимок с
    терминала. Спрятанная ссылка вложением не считается - она часть текста, и
    живёт отдельным полем.

    Не сохранилась - сообщение уходит без неё: текст важнее картинки к нему.
    """
    if not body.photo:
        return None
    try:
        raw = base64.b64decode(body.photo, validate=True)
        name = save_photo(raw)
    except (binascii.Error, ValueError, HTTPException) as exc:
        logger.warning("Фотография из форума не сохранилась: %s", exc)
        return None

    # Полным адресом: картинку показывает браузер ученика, а сайт и снимки
    # живут на разных доменах - относительный путь он искал бы у себя.
    url = f"{base}/{name}"
    return {"kind": "shot", "url": url, "image": url, "trade": None}


@router.post("", status_code=201, dependencies=[Depends(require_service_key)])
async def incoming(body: ForumMessage, request: Request, session=Depends(get_session)):
    """Положить сообщение форума в чат и разослать его комнате."""
    if not body.text.strip() and not body.photo:
        # Служебная запись о входе, закреплении темы и прочем. Разговором это
        # не является.
        return {"skipped": "пусто"}

    link = session.execute(
        select(ChatBridge).where(
            ChatBridge.tg_chat_id == body.tg_chat_id,
            ChatBridge.tg_message_id == body.tg_message_id,
        )
    ).scalar_one_or_none()

    # Это наше же сообщение, вернувшееся обновлением. Класть его второй раз
    # значит пустить разговор по кругу.
    if link is not None and not body.edited:
        return {"skipped": "уже есть"}

    thread_id = None
    if body.topic_id:
        thread_id = session.execute(
            select(ChatThread.id).where(ChatThread.tg_topic_id == body.topic_id)
        ).scalar_one_or_none()

    if thread_id is None:
        # Тема, которой у нас нет ветки. Молча пропускаем: заводить ветку по
        # чужому сообщению значит показывать на сайте разговоры, которых там
        # никто не ждал.
        return {"skipped": "тема не заведена"}

    links_json = (
        json.dumps([item.model_dump() for item in body.links], ensure_ascii=False)
        if body.links
        else ""
    )

    student = _author(session, body)
    text = body.text.strip()

    # Правка уже существующего сообщения.
    if body.edited and link is not None:
        row = session.get(ChatMessage, link.message_id)
        if row is None:
            return {"skipped": "сообщения уже нет"}
        row.text = text
        row.links_json = links_json
        row.edited_at = utcnow()
        session.commit()
        session.refresh(row)
        await _announce(request, session, row, student, "edited")
        return {"id": row.id, "edited": True}

    reply_to_id = None
    if body.reply_to_tg_message_id:
        reply_to_id = session.execute(
            select(ChatBridge.message_id).where(
                ChatBridge.tg_chat_id == body.tg_chat_id,
                ChatBridge.tg_message_id == body.reply_to_tg_message_id,
            )
        ).scalar_one_or_none()

    attach = _attach(body, shot_origin(request))
    row = ChatMessage(
        student_id=student.id,
        text=text,
        attach_json=json.dumps(attach, ensure_ascii=False) if attach else "",
        links_json=links_json,
        thread_id=thread_id,
        reply_to_id=reply_to_id,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    # Помним связку: по ней узнаются ответы, правки и повторные обновления.
    session.add(
        ChatBridge(
            message_id=row.id,
            tg_chat_id=body.tg_chat_id,
            tg_message_id=body.tg_message_id,
        )
    )
    session.commit()

    await _announce(request, session, row, student, "message")
    logger.info("Из форума: %s -> сообщение %s", body.tg_message_id, row.id)
    return {"id": row.id}


async def _announce(request: Request, session, row: ChatMessage, author: Student, event: str) -> None:
    """Разослать сообщение тем, кто сейчас в комнате.

    Сборка ответа берётся у самого чата, а не повторяется здесь: разошедшиеся
    формы одного и того же сообщения - это лента, в которой половина карточек
    выглядит иначе, чем другая.
    """
    from backend.api.chat import _out

    hub = getattr(request.app.state, "chat_hub", None)
    if hub is None:
        return
    await hub.broadcast(event, _out(row, author, session))
