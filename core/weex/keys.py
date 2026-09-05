"""Хранение торговых ключей учеников.

Ключ на торговлю — это доступ к деньгам ученика. В базе он лежит зашифрованным,
мастер-ключ приходит из окружения (`WEEX_KEYS_SECRET`) и в репозитории не
хранится нигде. Нет мастер-ключа — торговый модуль не поднимается вовсе, а не
работает «пока без шифрования»: незаметно ослабленная защита хуже отсутствующей.

Наружу ключ не отдаётся никогда, даже своему владельцу: в интерфейс уходят
последние четыре символа, чтобы ученик узнал свой ключ и не более того.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

ENV_VAR = "WEEX_KEYS_SECRET"


class KeysNotConfigured(RuntimeError):
    """Мастер-ключ не задан — шифровать нечем."""


def _fernet() -> Fernet:
    secret = os.getenv(ENV_VAR, "").strip()
    if not secret:
        raise KeysNotConfigured(
            f"{ENV_VAR} не задан: торговля по ключам учеников выключена"
        )
    # Мастер-ключ задаётся человеком и не обязан быть 32 байтами в base64.
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def enabled() -> bool:
    """Настроено ли хранилище ключей."""
    return bool(os.getenv(ENV_VAR, "").strip())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        # Сменился мастер-ключ — старые записи не расшифровать. Молча вернуть
        # пустоту нельзя: это выглядело бы как «ключей нет», и ученик завёл бы
        # вторые поверх нерасшифруемых первых.
        raise KeysNotConfigured("Ключ не расшифровывается: сменился WEEX_KEYS_SECRET") from exc


def mask(value: str) -> str:
    """Как ключ показывается владельцу: только хвост."""
    tail = value[-4:] if len(value) >= 4 else value
    return f"…{tail}"
