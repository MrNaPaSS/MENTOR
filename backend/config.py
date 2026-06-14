"""Конфигурация бэкенда из окружения."""

from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


@dataclass(frozen=True)
class BackendConfig:
    jwt_secret: str
    access_ttl_seconds: int
    refresh_ttl_seconds: int
    weex_use_mock: bool
    code_ttl_seconds: int
    max_code_attempts: int
    expose_codes: bool  # dev: возвращать код в ответе request-code
    bot_token: str = ""  # для доставки кода в Telegram
    rate_limit_max: int = 10            # попыток на /api/auth/* за окно
    rate_limit_window: int = 900        # окно, сек (15 мин)
    allowed_origins: tuple = ("*",)     # CORS: домены фронта
    dev_login: bool = False             # dev: вход без кода/пароля (только не в проде)

    @classmethod
    def from_env(cls) -> "BackendConfig":
        origins = os.getenv("ALLOWED_ORIGINS", "*")
        use_mock = os.getenv("WEEX_USE_MOCK", "true").lower() != "false"
        dev_login_env = os.getenv("DEV_LOGIN", "").lower()
        return cls(
            jwt_secret=os.getenv("JWT_SECRET", "dev-insecure-secret-change-me"),
            access_ttl_seconds=int(os.getenv("ACCESS_TTL", str(15 * 60))),
            refresh_ttl_seconds=int(os.getenv("REFRESH_TTL", str(30 * 24 * 3600))),
            weex_use_mock=use_mock,
            code_ttl_seconds=int(os.getenv("AUTH_CODE_TTL", "300")),
            max_code_attempts=int(os.getenv("AUTH_MAX_ATTEMPTS", "5")),
            expose_codes=os.getenv("AUTH_EXPOSE_CODES", "false").lower() == "true",
            bot_token=os.getenv("BOT_TOKEN", ""),
            rate_limit_max=int(os.getenv("RATE_LIMIT_MAX", "10")),
            rate_limit_window=int(os.getenv("RATE_LIMIT_WINDOW", "900")),
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            # dev-вход включён, если явно DEV_LOGIN=true, либо мы на моках WEEX (=dev),
            # и НЕ отключён явно DEV_LOGIN=false.
            dev_login=(dev_login_env == "true") or (use_mock and dev_login_env != "false"),
        )
