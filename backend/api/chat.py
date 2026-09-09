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
from datetime import timezone
from html import unescape

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.mentor import is_mentor
from backend.chat.format import caption_html, link_ranges, message_html
from backend.deps import get_current_student, get_session
from core.models import ChartShot, ChatMessage, ChatThread, Signal, Student, utcnow

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# Страница истории. Больше сотни за раз панель всё равно не покажет, а меньше
# двадцати - это лишний круг запросов при первом открытии.
PAGE = 50
MAX_PAGE = 100

# Длина сообщения. Ограничение не про экономию места, а про ленту: простыня на
# три экрана выдавливает из панели весь разговор.
MAX_TEXT = 2000

# Подпись кнопки под сообщением в форуме. Здесь, а не в словаре интерфейса:
# читает её тот, кто на сайт ещё не зашёл, и языка его мы не знаем.
TERMINAL_BUTTON = "Перейти к терминалу"


def _thread_topic(session, thread_id: int | None) -> int | None:
    """Номер темы форума для ветки. Пусто - ветке в форуме соответствия нет."""
    if not thread_id:
        return None
    return session.execute(
        select(ChatThread.tg_topic_id).where(ChatThread.id == thread_id)
    ).scalar_one_or_none()


def _shot_symbol(session, url: str) -> str:
    """Монета снимка - по его же записи.

    В приложении к сообщению её нет: снимок это ссылка и картинка, а что на
    картинке нарисовано, знает только запись о ней. Без монеты под сообщением
    в форуме не появлялась бы кнопка - и выложенный график оставался бы
    картинкой, из которой некуда идти.

    Идентификатор берём хвостом адреса: его собирает сам сервер снимков, и
    ничего, кроме имени файла, там не бывает.
    """
    tail = (url or "").rstrip("/").rsplit("/", 1)[-1]
    shot_id = tail.split(".", 1)[0].removesuffix("-raw")
    if not shot_id:
        return ""
    row = session.get(ChartShot, shot_id)
    return str(row.symbol) if row is not None else ""


def _picture(attach: dict | None) -> str:
    """Картинка за сообщением - та, которую в форуме показывают вместо текста.

    Пусто, если её нет: у разговора словами, у сделки без собравшейся карточки.
    Тогда сообщение уходит обычным текстом.
    """
    if not isinstance(attach, dict) or attach.get("kind") not in ("shot", "trade"):
        return ""
    if not str(attach.get("url", "")).lower().startswith(("http://", "https://")):
        return ""
    image = str(attach.get("image", "")) or f"{attach['url']}.png"
    return image if image.lower().startswith(("http://", "https://")) else ""


def _has_picture(attach: dict | None) -> bool:
    """Есть ли за сообщением картинка. Тонкая обёртка - её читают проверки."""
    return bool(_picture(attach))


def _shown(attach: dict | None) -> bool:
    """Показанное, а не сказанное: снимок графика, сделка, карточка итога."""
    return isinstance(attach, dict) and attach.get("kind") in ("shot", "trade")


def _to_forum(request: Request, message: ChatMessage, author: Student, session) -> None:
    """Отправить сообщение в форум. Молча, если моста нет.

    Не ждём отправки: сообщение уже в базе и уже у всех, кто в комнате, а
    очередь Telegram живёт своей скоростью. Ошибка доставки не должна
    превращаться в ошибку отправки.
    """
    forum = getattr(request.app.state, "forum", None)
    if forum is None or not forum.enabled:
        return

    attach = None
    if message.attach_json:
        try:
            attach = json.loads(message.attach_json)
        except ValueError:
            attach = None

    # В форум уходит показанное, а не сказанное: снимки, сделки, карточки
    # итога, сигналы. Разговор словами остаётся на сайте.
    #
    # Дело не в объёме. Форум читают с телефона, и туда должно приходить то,
    # ради чего стоит его открыть; лента чужих реплик, вырванных из разговора и
    # подписанных именем бота, обесценивает и уведомления, и сам форум - его
    # перестают открывать вообще, вместе со сделками.
    #
    # Слова, сказанные вместе с картинкой, уходят с ней: это подпись к
    # показанному, а не отдельная реплика.
    if not _shown(attach) and not message.signal_id:
        return

    who = _who(author)
    symbol = ""
    if isinstance(attach, dict) and isinstance(attach.get("trade"), dict):
        symbol = str(attach["trade"].get("symbol", ""))
    elif isinstance(attach, dict) and attach.get("kind") == "shot":
        symbol = _shot_symbol(session, str(attach.get("url", "")))

    links = link_ranges(message.links_json)
    picture = _has_picture(attach)
    forum.submit(
        {
            "op": "send",
            "message_id": message.id,
            "topic_id": _thread_topic(session, message.thread_id),
            # Под картинкой - только слова человека: имя школы и слово-ссылка
            # вместо подписи занимали под фотографией две строки, ничего не
            # сообщая. Уходит текстом - подпись возвращается: там по ней и
            # видно, кто говорит.
            "html": (
                caption_html(message.text, links, attach)
                if picture
                else message_html(who["name"], message.text, links, attach)
            ),
            # Кнопка появляется там, где ей есть куда вести: у разговора о
            # монете. Под «привет» она была бы украшением.
            "symbol": symbol,
            "button": TERMINAL_BUTTON if symbol else "",
            # Картинка уходит картинкой, а не ссылкой на неё.
            #
            # Ссылка на карточку - это и есть само сообщение: свёрнутая в
            # строку, она требует нажатия, чтобы понять, о чём речь. Разворачивать
            # её должен был предпросмотр Telegram, но он собирается его же
            # обходчиком и по его же правилам: не дотянулся до картинки, не
            # уложился в её вес, решил показать один заголовок - и в теме висит
            # серый прямоугольник. Отправленная картинка так не подводит.
            #
            # Ссылка при этом остаётся - кнопкой под снимком: она ведёт на
            # страницу карточки, а уже оттуда - в терминал на эту монету.
            "photo": _picture(attach),
            "preview": picture,
            "open": str(attach.get("url", "")) if picture else "",
        }
    )


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


class Link(BaseModel):
    """Отрезок текста, за которым спрятана ссылка.

    Форма повторяет то, как такие отрезки приходят из Telegram: там ссылка не
    лежит в тексте, а описывается началом, длиной и адресом. Совпадение формы
    избавляет от перевода в обе стороны.
    """

    offset: int = Field(ge=0)
    length: int = Field(gt=0)
    url: str = Field(min_length=8, max_length=512, pattern="^https?://")


class MessageIn(BaseModel):
    text: str = Field(default="", max_length=MAX_TEXT)
    attach: Attach | None = None
    # В какую ветку пишем. Пусто - в ту, что заведена веткой по умолчанию.
    thread_id: int | None = None
    # Ссылки, вшитые в текст. Не больше десяти: сообщение, где ссылка на
    # каждом слове, - это не сообщение.
    links: list[Link] = Field(default_factory=list, max_length=10)
    # На какое сообщение это ответ. Проверка одна - что оно существует.
    reply_to: int | None = None
    # Показать заявку во вкладке «Сигналы». Только наставнику - у остальных
    # поле молча игнорируется: право проверяется на сервере, а кнопки у них нет.
    as_signal: bool = False
    audience: str = Field(default="all", pattern="^(all|moderate|turbo)$")


class MessageEdit(BaseModel):
    """Правка своего сообщения. Вложение не трогаем: правят слова."""

    text: str = Field(min_length=1, max_length=MAX_TEXT)


# Как подписан наставник, пока он не задал себе имя карточки.
#
# Ник в телеграме - это личный аккаунт, а сигналы идут от школы: подписывать их
# им значит светить личный контакт в каждом сообщении, в каждой цитате и в
# копии, которая уходит в форум.
MENTOR_NAME = "NMNH"


def _who(student: Student) -> dict:
    """Подпись автора: как он выглядит в ленте прямо сейчас.

    Имён два, и это не дублирование. `name` - подпись в ленте: у наставника
    там школа, потому что сигналы идут от NMNH, а не от его личного телеграма.
    `card` - имя на карточке сделки: карточка это результат человека, и
    подписывать её школой нельзя - в чате нажали на сделку наставника и увидели
    вместо его ника «NMNH».
    """
    mentor = is_mentor(student)
    nick = student.username or f"id{student.id}"
    fallback = MENTOR_NAME if mentor else nick
    return {
        "id": student.id,
        "name": student.card_name or fallback,
        "avatar": student.avatar_url or "",
        "mentor": mentor,
        "card": student.card_name or nick,
    }


# Сколько текста оригинала уносит цитата. Две строки в узкой панели - это
# примерно столько; дальше цитата начинает спорить с самим ответом.
QUOTE_TEXT = 120


def _quote(session, reply_to_id: int | None) -> dict | None:
    """Снимок цитируемого сообщения: ник, начало текста и вид вложения.

    Снимком, а не ссылкой на сообщение целиком: тянуть за собой ещё одно
    вложение и ещё одного автора ради двух строк незачем. Собирается при выдаче,
    а не хранится - автор мог сменить ник, и цитата обязана показывать нынешний.
    """
    if not reply_to_id:
        return None

    row = session.get(ChatMessage, reply_to_id)
    if row is None:
        # Оригинал удалили. Ответ остаётся, цитата говорит об этом прямо.
        return {"id": reply_to_id, "deleted": True}

    author = session.get(Student, row.student_id)
    kind = ""
    if row.attach_json:
        try:
            kind = str(json.loads(row.attach_json).get("kind", ""))
        except ValueError:
            kind = ""

    return {
        "id": row.id,
        "author": _who(author)["name"] if author is not None else "?",
        "text": row.text[:QUOTE_TEXT],
        "attach": kind or None,
        "deleted": False,
    }


def _out(message: ChatMessage, author: Student | None, session=None) -> dict:
    attach = None
    if message.attach_json:
        try:
            attach = json.loads(message.attach_json)
        except ValueError:
            # Строку писали мы сами; если она сломалась, сообщение важнее
            # вложения - отдаём без него.
            attach = None
    # Время отдаём с меткой пояса. В базу оно пишется в UTC, но SQLite про
    # пояса не знает и возвращает время голым - без метки браузер читает его
    # как своё местное и показывает сообщение на пару часов раньше, чем оно
    # было. С PostgreSQL метка приходит сама, и эта строка ничего не меняет.
    at = message.created_at
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)

    edited = message.edited_at
    if edited is not None and edited.tzinfo is None:
        edited = edited.replace(tzinfo=timezone.utc)

    return {
        "id": message.id,
        "text": message.text,
        "at": at.isoformat(),
        "edited": edited.isoformat() if edited else None,
        "author": _who(author) if author is not None else {"id": 0, "name": "?", "avatar": "", "mentor": False},
        "attach": attach,
        # Отрезки со ссылками. Пустой список, а не отсутствие поля: панель
        # рисует текст по нему, и «поля нет» ей пришлось бы разбирать отдельно.
        "links": link_ranges(message.links_json),
        "thread_id": message.thread_id,
        "reply": _quote(session, message.reply_to_id) if session is not None else None,
        # Заявка ушла дальше чата: карточка отметит это значком вещания.
        "signal_id": message.signal_id,
    }


@router.get("/threads")
def threads(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Ветки разговора: те же, что темы в форуме.

    Отдаём все сразу и без страниц: веток десяток, а переключатель обязан
    показать их целиком - выбирать ветку из половины списка нельзя.
    """
    rows = list(
        session.execute(
            select(ChatThread).order_by(ChatThread.position, ChatThread.id)
        ).scalars()
    )
    return {
        "threads": [
            {
                "id": row.id,
                "title": row.title,
                "closed": row.closed,
                "default": row.is_default,
                # Есть ли у ветки тема в форуме. Само число наружу не отдаём:
                # оно ничего не говорит браузеру и лишь показывает устройство
                # чужой группы.
                "forum": bool(row.tg_topic_id),
            }
            for row in rows
        ]
    }


def _default_thread(session) -> int | None:
    """Ветка, в которую попадает сообщение, если ветку не выбрали."""
    return session.execute(
        select(ChatThread.id)
        .where(ChatThread.is_default.is_(True))
        .order_by(ChatThread.position, ChatThread.id)
    ).scalars().first()


@router.get("/messages")
def history(
    before: int | None = Query(default=None, description="Читать то, что старше этого id"),
    limit: int = Query(default=PAGE, ge=1, le=MAX_PAGE),
    thread: int | None = Query(default=None, description="Ветка. Без неё - вся лента"),
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
    if thread:
        query = query.where(ChatMessage.thread_id == thread)

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
        "messages": [_out(r, authors.get(r.student_id), session) for r in rows],
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

    # Отвечают на существующее. Номер несуществующего - не повод отказывать в
    # сообщении: оно ценно само по себе, а цитаты просто не будет.
    reply_to = body.reply_to
    if reply_to is not None and session.get(ChatMessage, reply_to) is None:
        reply_to = None

    # Ветка: выбранная, а в противном случае - та, что заведена основной.
    # Проверяем, что она есть и открыта: писать в закрытую нельзя, а ссылка на
    # несуществующую превратила бы сообщение в невидимое.
    thread_id = body.thread_id or _default_thread(session)
    if thread_id:
        thread = session.get(ChatThread, thread_id)
        if thread is None:
            thread_id = _default_thread(session)
        elif thread.closed:
            raise HTTPException(403, "Ветка закрыта")

    row = ChatMessage(
        student_id=student.id,
        text=text,
        attach_json=body.attach.model_dump_json() if body.attach else "",
        reply_to_id=reply_to,
        thread_id=thread_id,
        links_json=json.dumps([link.model_dump() for link in body.links], ensure_ascii=False)
        if body.links
        else "",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    # Сигнал из заявки. Только наставнику и только по его просьбе.
    #
    # Сорвавшийся сигнал не роняет отправку: сообщение уже ушло людям, и
    # объявлять его неудачей нельзя. О причине говорим отдельным полем - панель
    # покажет её строкой.
    signal_error = None
    if body.as_signal and is_mentor(student):
        try:
            signal = _signal_from_attach(body.attach, body.audience, row.id)
            session.add(signal)
            session.commit()
            session.refresh(signal)
            row.signal_id = signal.id
            session.commit()
            session.refresh(row)
        except ValueError as exc:
            signal_error = str(exc)

    payload = _out(row, student, session)
    hub = getattr(request.app.state, "chat_hub", None)
    if hub is not None:
        await hub.broadcast("message", payload)
    _to_forum(request, row, student, session)
    if signal_error:
        payload = {**payload, "signal_error": signal_error}
    return payload


def _signal_from_attach(attach: Attach | None, audience: str, message_id: int) -> Signal:
    """Сигнал из ждущей заявки, показанной в чате.

    Объём в сигнал не переносится - он посчитан под депозит наставника, а лента
    считает свой под депозит смотрящего; в этом и смысл вкладки.

    Тип входа всегда лимитный: заявка по определению ждёт свою цену. Маржа
    изолированная - терминал торгует только такой.
    """
    if attach is None or attach.kind != "trade" or not attach.trade:
        raise ValueError("Сигнал делается только из заявки")

    trade = attach.trade
    state = str(trade.get("state", ""))
    if state != "planned":
        raise ValueError("Сигналом становится только ждущая входа заявка")

    def number(name: str) -> float | None:
        try:
            value = float(trade.get(name))
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    entry = number("entry")
    if entry is None:
        raise ValueError("У заявки нет цены входа")

    targets = [t for t in (trade.get("targets") or []) if isinstance(t, (int, float)) and t > 0]
    side = str(trade.get("side", "")).lower()

    try:
        leverage = max(1, int(trade.get("leverage") or 1))
    except (TypeError, ValueError):
        leverage = 1

    return Signal(
        symbol=str(trade.get("symbol", "")).upper(),
        direction="LONG" if side == "long" else "SHORT",
        leverage=leverage,
        entry_price=entry,
        entry_type="limit",
        stop_loss=number("stop"),
        tp1=targets[0] if len(targets) > 0 else None,
        tp2=targets[1] if len(targets) > 1 else None,
        tp3=targets[2] if len(targets) > 2 else None,
        margin_type="isolated",
        target_audience=audience,
        status="active",
        chat_message_id=message_id,
    )


def _mine(message: ChatMessage, student: Student) -> bool:
    return message.student_id == student.id


@router.patch("/messages/{message_id}")
async def edit(
    message_id: int,
    body: MessageEdit,
    request: Request,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Поправить своё сообщение.

    Только своё, и наставнику тоже только своё: удалить чужое - это про порядок
    в комнате, а переписать чужое - это вложить человеку в рот слова, которых он
    не говорил.
    """
    row = session.get(ChatMessage, message_id)
    if row is None:
        raise HTTPException(404, "Сообщения нет")
    if not _mine(row, student):
        raise HTTPException(403, "Править можно только своё")

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Пустое сообщение")
    if text == row.text:
        return _out(row, student, session)

    row.text = text
    row.edited_at = utcnow()
    session.commit()
    session.refresh(row)

    payload = _out(row, student, session)
    hub = getattr(request.app.state, "chat_hub", None)
    if hub is not None:
        await hub.broadcast("edited", payload)

    # Правка догоняет копию в форуме. Иначе исправленное слово осталось бы
    # исправленным только у половины читателей - ровно то, от чего защищает
    # отметка «изменено».
    forum = getattr(request.app.state, "forum", None)
    if forum is not None and forum.enabled:
        attach = None
        if row.attach_json:
            try:
                attach = json.loads(row.attach_json)
            except ValueError:
                attach = None
        links = link_ranges(row.links_json)
        picture = _has_picture(attach)
        forum.submit(
            {
                "op": "edit",
                "message_id": row.id,
                "html": (
                    caption_html(row.text, links, attach)
                    if picture
                    else message_html(_who(student)["name"], row.text, links, attach)
                ),
                "preview": picture,
            }
        )
    return payload


@router.delete("/messages/{message_id}", status_code=204)
async def remove(
    message_id: int,
    request: Request,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Убрать сообщение: своё - всегда, чужое - только наставнику.

    Удаляем совсем, а не прячем флагом. Прятать имеет смысл там, где переписку
    потом читает суд; здесь её читают люди, и «сообщение удалено» посреди ленты
    занимает место, не сообщая ничего.
    """
    row = session.get(ChatMessage, message_id)
    if row is None:
        # Уже нет - значит уже убрано. Ошибкой это не назовёшь.
        return None
    if not _mine(row, student) and not is_mentor(student):
        raise HTTPException(403, "Чужое сообщение может убрать только наставник")

    # Удалённое сообщение означает «я передумал»: живого обещания после него
    # оставаться не должно.
    if row.signal_id:
        signal = session.get(Signal, row.signal_id)
        if signal is not None and signal.status == "active":
            signal.status = "closed"
            signal.closed_at = utcnow()

    session.delete(row)
    session.commit()

    hub = getattr(request.app.state, "chat_hub", None)
    if hub is not None:
        await hub.broadcast("removed", {"id": message_id})

    forum = getattr(request.app.state, "forum", None)
    if forum is not None and forum.enabled:
        forum.submit({"op": "delete", "message_id": message_id})
    return None


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
