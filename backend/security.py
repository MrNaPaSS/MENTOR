"""JWT (HS256) на стандартной библиотеке — без внешних зависимостей.

Реализует подпись HMAC-SHA256 для access/refresh токенов (ТЗ §4.2).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
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


def _segment(text: str) -> object:
    """Кусок токена как JSON. Мусор - это неверный токен, а не ошибка сервера."""
    try:
        return json.loads(_b64url_decode(text))
    except ValueError as exc:  # base64, UTF-8 и JSON бросают потомков ValueError
        raise TokenError("Неверный формат токена") from exc


def decode_token(token: str, secret: str) -> dict:
    """Проверить подпись и срок. Любой испорченный токен - ``TokenError``.

    Раньше битый base64 или не-JSON в токене проваливались мимо ``TokenError``,
    и сервер отвечал 500 вместо 401: клиент принимал это за падение сервера, а
    не за повод войти заново.
    """
    try:
        seg_header, seg_payload, seg_sig = token.split(".")
    except ValueError as exc:
        raise TokenError("Неверный формат токена") from exc

    header = _segment(seg_header)
    # Алгоритм у нас один. Токен, заявляющий другой, выдан не нами.
    if not isinstance(header, dict) or header.get("alg") != "HS256":
        raise TokenError("Неверный алгоритм токена")

    try:
        signature = _b64url_decode(seg_sig)
    except ValueError as exc:
        raise TokenError("Неверный формат токена") from exc
    signing_input = f"{seg_header}.{seg_payload}".encode()
    expected = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, signature):
        raise TokenError("Неверная подпись токена")

    payload = _segment(seg_payload)
    if not isinstance(payload, dict):
        raise TokenError("Неверный формат токена")
    exp = payload.get("exp")
    if exp is not None:
        try:
            expired = time.time() > float(exp)
        except (TypeError, ValueError) as exc:
            raise TokenError("Неверный срок токена") from exc
        if expired:
            raise TokenError("Токен истёк")
    return payload


def create_access_token(
    sub: str,
    role: str,
    secret: str,
    ttl_seconds: int,
    sid: Optional[str] = None,
    *,
    pv: Optional[str] = None,
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
    if pv:
        payload["pv"] = pv
    return encode_token(payload, secret)


def create_refresh_token(
    sub: str,
    secret: str,
    ttl_seconds: int,
    role: str = "student",
    sid: Optional[str] = None,
    *,
    pv: Optional[str] = None,
) -> str:
    """Refresh-токен несёт роль: без неё обновление сбрасывало ментора в ученика.

    И метку сессии: по ней вход на новом устройстве закрывает прежний. Токен
    подписан и не отзывается сам по себе - отозвать его можно только тем, что
    у ученика в записи лежит другая метка.

    У наставника вместо метки сессии - отпечаток пароля (``pv``): записи в базе
    у него нет, и отозвать его токены можно только сменой пароля.
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
    if pv:
        payload["pv"] = pv
    return encode_token(payload, secret)


def new_session_id() -> str:
    """Метка сессии. Новая на каждый вход - прежняя перестаёт подходить."""
    return secrets.token_urlsafe(12)


# ── Токены наставника ───────────────────────────────────────────────────────
#
# Токен наставника - это админка: сигналы всем ученикам, магазин, списки. Живёт
# его refresh месяц, а записи, где лежала бы метка сессии, у наставника нет.
# Раньше украденный токен работал до конца срока, и отозвать его можно было
# только сменой JWT_SECRET - то есть выбросив из кабинета всех учеников разом.
#
# Теперь в токене лежит отпечаток пароля: сменили MENTOR_PASSWORD - все прежние
# токены наставника перестали подходить. Для срочного случая есть и рубильник
# MENTOR_TOKENS_NOT_BEFORE: токены, выданные раньше этой секунды, не принимаются.
#
# Токены без отпечатка (выданные до этой правки) доживают свой срок: выбросить
# наставника из админки посреди работы ради этого незачем. Рубильник отзывает и их.

_MENTOR_SALT = b"nmnh-mentor-password"


def mentor_mark(password: str) -> str:
    """Отпечаток пароля наставника. Сам пароль из него не восстановить."""
    if not password:
        return ""
    return hmac.new(_MENTOR_SALT, password.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def mentor_token_alive(payload: dict, password: str, not_before: int = 0) -> bool:
    """Годится ли ещё токен наставника при нынешнем пароле и рубильнике."""
    try:
        issued = int(payload.get("iat") or 0)
    except (TypeError, ValueError):
        issued = 0
    if not_before and issued < not_before:
        return False
    mark = payload.get("pv")
    if mark is None:
        return True
    return bool(password) and hmac.compare_digest(str(mark), mentor_mark(password))


def mentor_alive(payload: dict) -> bool:
    """То же, с паролем и рубильником из окружения.

    Окружение читается на каждой проверке: сменили пароль и перезапустили
    сервер - прежние токены перестали работать без правки кода.
    """
    password = os.getenv("MENTOR_PASSWORD", "")
    try:
        not_before = int(os.getenv("MENTOR_TOKENS_NOT_BEFORE", "0") or 0)
    except ValueError:
        not_before = 0
    return mentor_token_alive(payload, password, not_before)
