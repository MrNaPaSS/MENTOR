"""JWT (HS256) на стандартной библиотеке — без внешних зависимостей.

Реализует подпись HMAC-SHA256 для access/refresh токенов (ТЗ §4.2).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


class TokenError(Exception):
    """Невалидный или просроченный токен."""


def encode_token(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    seg_header = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    seg_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{seg_header}.{seg_payload}".encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{seg_header}.{seg_payload}.{_b64url_encode(sig)}"


def decode_token(token: str, secret: str) -> dict:
    try:
        seg_header, seg_payload, seg_sig = token.split(".")
    except ValueError as exc:
        raise TokenError("Неверный формат токена") from exc

    signing_input = f"{seg_header}.{seg_payload}".encode()
    expected = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64url_decode(seg_sig)):
        raise TokenError("Неверная подпись токена")

    payload = json.loads(_b64url_decode(seg_payload))
    if "exp" in payload and time.time() > payload["exp"]:
        raise TokenError("Токен истёк")
    return payload


def create_access_token(
    sub: str, role: str, secret: str, ttl_seconds: int, sid: Optional[str] = None
) -> str:
    now = int(time.time())
    payload = {
        "sub": str(sub),
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + ttl_seconds,
    }
    if sid:
        payload["sid"] = sid
    return encode_token(payload, secret)


def create_refresh_token(
    sub: str,
    secret: str,
    ttl_seconds: int,
    role: str = "student",
    sid: Optional[str] = None,
) -> str:
    """Refresh-токен несёт роль: без неё обновление сбрасывало ментора в ученика.

    И метку сессии: по ней вход на новом устройстве закрывает прежний. Токен
    подписан и не отзывается сам по себе - отозвать его можно только тем, что
    у ученика в записи лежит другая метка.
    """
    now = int(time.time())
    payload = {
        "sub": str(sub),
        "role": role,
        "type": "refresh",
        "iat": now,
        "exp": now + ttl_seconds,
    }
    if sid:
        payload["sid"] = sid
    return encode_token(payload, secret)


def new_session_id() -> str:
    """Метка сессии. Новая на каждый вход - прежняя перестаёт подходить."""
    return secrets.token_urlsafe(12)
