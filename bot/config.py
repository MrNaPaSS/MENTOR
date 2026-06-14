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

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            bot_token=os.getenv("BOT_TOKEN", ""),
            admin_tg_id=int(os.getenv("ADMIN_TG_ID", "0") or "0"),
            database_url=os.getenv("DATABASE_URL", "sqlite:///nmnh_dev.sqlite3"),
            weex_use_mock=os.getenv("WEEX_USE_MOCK", "true").lower() != "false",
            delivery_delay_seconds=float(os.getenv("DELIVERY_DELAY_SECONDS", "3")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )
