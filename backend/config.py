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

    @classmethod
    def from_env(cls) -> "BackendConfig":
        return cls(
            jwt_secret=os.getenv("JWT_SECRET", "dev-insecure-secret-change-me"),
            access_ttl_seconds=int(os.getenv("ACCESS_TTL", str(15 * 60))),
            refresh_ttl_seconds=int(os.getenv("REFRESH_TTL", str(30 * 24 * 3600))),
            weex_use_mock=os.getenv("WEEX_USE_MOCK", "true").lower() != "false",
            code_ttl_seconds=int(os.getenv("AUTH_CODE_TTL", "300")),
            max_code_attempts=int(os.getenv("AUTH_MAX_ATTEMPTS", "5")),
            expose_codes=os.getenv("AUTH_EXPOSE_CODES", "false").lower() == "true",
        )
