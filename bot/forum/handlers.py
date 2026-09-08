"""Мост из торгового форума в общий чат сайта.

Бот сидит в форумной группе и видит её обновления - Telegram отдаёт их только
тем, кто там состоит. Поэтому пересылкой занимается он, а сайт принимает уже
разобранное.

Почему бот не пишет прямо в базу, хотя база у них общая. Сообщение в чате -
это не только строка в таблице, но и рассылка всем, кто сейчас в комнате;
сокеты живут в процессе бэкенда, и запись мимо него означала бы сообщение,
которое появится у людей только после перезагрузки страницы.

Обратное направление - «сайт -> форум» - живёт не здесь, а в
``backend/chat/forum.py``: там уже есть очередь под частоту, с которой группа
принимает сообщения, и знание о том, какое сообщение чата какому сообщению
форума соответствует.

Отдельно про анонимность. Бот стоит в группе анонимным админом и пишет от
имени самой группы; такие сообщения приходят с ``sender_chat`` вместо автора.
Разбирать их как чей-то разговор нельзя - и не нужно: наши же сообщения
возвращаются к нам именно так.
"""

from __future__ import annotations

import base64
import logging

import aiohttp
from aiogram import Bot, F, Router
from aiogram.types import Message

logger = logging.getLogger("nmnh.forum")

ENDPOINT = "/api/chat/forum"
TIMEOUT = 20

# Столько же принимает сам чат. Режем здесь, чтобы не гонять простыню по сети
# ради отказа на той стороне.
MAX_TEXT = 2000

# Фотографию берём не самую крупную из присланных: в теме их до пяти размеров,
# и крупнейшая бывает в несколько мегабайт, а ленте чата хватает средней.
MAX_PHOTO_BYTES = 4 * 1024 * 1024


def links_of(message: Message) -> list[dict]:
    """Спрятанные в тексте ссылки.

    Это то, ради чего мост читает разметку, а не ищет адреса регуляркой. Когда
    наставник пишет «BTC 1m» со вшитой ссылкой, в тексте приходит только
    «BTC 1m» - самого адреса там нет. Он лежит отдельным отрезком с типом
    ``text_link``, началом, длиной и адресом.

    Ссылки, набранные текстом, сюда не берём: они и так видны, и сайт подсветит
    их сам.
    """
    entities = message.entities or message.caption_entities or []
    out = []
    for item in entities:
        if item.type != "text_link" or not item.url:
            continue
        out.append({"offset": item.offset, "length": item.length, "url": item.url})
    # Больше десяти сайт не примет: сообщение, где ссылка на каждом слове, - не
    # сообщение.
    return out[:10]


async def photo_of(message: Message, bot: Bot) -> str:
    """Фотография сообщения в base64. Пусто - её нет или она не забралась."""
    if not message.photo:
        return ""

    sizes = sorted(message.photo, key=lambda p: p.file_size or 0)
    fits = [p for p in sizes if (p.file_size or 0) <= MAX_PHOTO_BYTES]
    chosen = fits[-1] if fits else sizes[0]

    try:
        handle = await bot.get_file(chosen.file_id)
        buffer = await bot.download_file(handle.file_path)
        data = buffer.read()
    except Exception as exc:  # noqa: BLE001 - чужой файл может не отдаться
        logger.warning("Фотография из форума не забралась: %s", exc)
        return ""
    return base64.b64encode(data).decode("ascii")


def reply_to_of(message: Message) -> int | None:
    """На какое сообщение это ответ.

    В темах форума Telegram проставляет ответ и первому сообщению темы - там
    он указывает на саму тему, а не на чью-то реплику. За ответ это не
    считаем: иначе каждое сообщение в ветке оказалось бы ответом на её
    заголовок.
    """
    origin = message.reply_to_message
    if origin is None:
        return None
    if message.message_thread_id and origin.message_id == message.message_thread_id:
        return None
    return origin.message_id


def payload_of(message: Message, text: str, photo: str, edited: bool) -> dict:
    author = message.from_user
    name = " ".join(p for p in (author.first_name, author.last_name) if p).strip()
    return {
        "tg_chat_id": message.chat.id,
        "tg_message_id": message.message_id,
        "topic_id": message.message_thread_id,
        "author": {
            "tg_id": author.id,
            "name": name or (author.username or ""),
            "username": author.username or "",
        },
        "text": text,
        "links": links_of(message),
        "photo": photo,
        "reply_to_tg_message_id": reply_to_of(message),
        "edited": edited,
    }


async def send_to_site(api_url: str, service_key: str, payload: dict) -> None:
    """Отдать сообщение сайту. Неудача не роняет бота и не повторяется.

    Повтор здесь был бы вреден: пока он идёт, разговор ушёл вперёд, и
    досланное сообщение встанет в ленту не на своё место. Потерянное сообщение
    честнее переставленного.
    """
    url = f"{api_url.rstrip('/')}{ENDPOINT}"
    try:
        timeout = aiohttp.ClientTimeout(total=TIMEOUT)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.post(
                url, json=payload, headers={"X-Service-Key": service_key}
            ) as res:
                if res.status >= 400:
                    body = (await res.text())[:200]
                    logger.warning("Сайт отказал (%s): %s", res.status, body)
                    return
    except Exception as exc:  # noqa: BLE001 - соседняя система может всё
        logger.warning("Сайт недоступен: %s", exc)
        return
    logger.info("Из форума: сообщение %s ушло на сайт", payload["tg_message_id"])


def build_forum_router(forum_chat_id: int, api_url: str, service_key: str) -> Router:
    """Роутер форума. Без адреса группы или ключа - пустой и молчащий.

    Молчащий по умолчанию намеренно: пока адрес не выверен, разослать чужой
    разговор в чат необратимо.
    """
    router = Router(name="forum")
    if not forum_chat_id or not api_url or not service_key:
        logger.info("Мост с форумом выключен: не хватает настроек")
        return router

    @router.message(F.chat.id == forum_chat_id)
    @router.edited_message(F.chat.id == forum_chat_id)
    async def on_forum_message(message: Message, bot: Bot) -> None:
        # От имени группы пишет анонимный админ - и это же наши собственные
        # сообщения, вернувшиеся обновлением. Автора у них нет, и разговором
        # они не являются.
        if message.from_user is None or message.from_user.is_bot:
            return

        text = (message.text or message.caption or "")[:MAX_TEXT]
        photo = await photo_of(message, bot)
        # Служебные записи о входе, закреплении и переименовании темы.
        if not text.strip() and not photo:
            return

        edited = message.edit_date is not None
        await send_to_site(api_url, service_key, payload_of(message, text, photo, edited))

    return router
