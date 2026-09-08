"""Конфигурация бота из окружения (.env)."""

from __future__ import annotations

import os
from dataclasses import dataclass

try:  # подхватить .env, если установлен python-dotenv
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


@dataclass(frozen=True)
class Config:
    bot_token: str
    admin_tg_id: int
    database_url: str
    weex_use_mock: bool
    delivery_delay_seconds: float
    log_level: str
    weex_referral_link: str
    # Мост форума с чатом сайта. Ноль означает «моста нет»: пока адрес группы
    # не выверен, разослать чужой разговор в чат необратимо.
    forum_chat_id: int
    # Токен бота, который сидит в форумной группе.
    #
    # Отдельно от BOT_TOKEN, потому что это разные боты: ученикам сигналы
    # рассылает наш, а в группе стоит тот, кого туда пустили админом. Слушать
    # форум может только второй - первому Telegram обновлений группы не
    # отдаёт вовсе, он в ней не состоит.
    #
    # Пусто - берётся BOT_TOKEN: если это однажды окажется один бот, настройку
    # не придётся менять.
    forum_bot_token: str
    # Куда бот отдаёт сообщения форума. Своим процессом до сокетов чата не
    # дотянуться - их держит бэкенд.
    api_url: str
    # Тот же общий секрет, которым представляется сервер академии.
    service_api_key: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            bot_token=os.getenv("BOT_TOKEN", ""),
            admin_tg_id=int(os.getenv("ADMIN_TG_ID", "0") or "0"),
            database_url=os.getenv("DATABASE_URL", "sqlite:///nmnh_dev.sqlite3"),
            weex_use_mock=os.getenv("WEEX_USE_MOCK", "true").lower() != "false",
            delivery_delay_seconds=float(os.getenv("DELIVERY_DELAY_SECONDS", "3")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            weex_referral_link=os.getenv("WEEX_REFERRAL_LINK", "https://www.weex.com/ru/register?vipCode=kaktotakxme"),
            forum_chat_id=int(os.getenv("FORUM_CHAT_ID", "0") or "0"),
            forum_bot_token=os.getenv("FORUM_BOT_TOKEN", "") or os.getenv("BOT_TOKEN", ""),
            api_url=os.getenv("NMNH_API_URL", "http://127.0.0.1:8000"),
            service_api_key=os.getenv("SERVICE_API_KEY", ""),
        )
