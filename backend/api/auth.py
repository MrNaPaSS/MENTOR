"""Авторизация ученика (UID → код в Telegram → JWT) и ментора (ТЗ §4, контракт A-10).

Доставку кода в Telegram выполняет бот; здесь код генерируется и хранится. В dev-режиме
(``AUTH_EXPOSE_CODES=true``) код возвращается в ответе для удобства тестирования.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from core import repo
from backend.config import BackendConfig
from backend.deps import get_config, get_session, get_weex
from backend.security import create_access_token, create_refresh_token, decode_token, TokenError
from backend.schemas import RequestCodeIn, RequestCodeOut, VerifyIn, TokenPair, RefreshIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/request-code", response_model=RequestCodeOut)
async def request_code(
    body: RequestCodeIn,
    config: BackendConfig = Depends(get_config),
    weex=Depends(get_weex),
    session=Depends(get_session),
):
    uid = body.weex_uid.strip()
    # UID должен существовать в WEEX и принадлежать одобренному ученику.
    balance = await weex.get_affiliate_balance(uid)
    if balance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UID не найден в системе WEEX")
    student = repo.get_student_by_weex_uid(session, uid)
    if student is None or not student.is_approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Обратитесь к ментору для получения доступа")

    code = f"{secrets.randbelow(10**6):06d}"
    repo.create_auth_code(session, uid, code, config.code_ttl_seconds)
    # TODO: доставка кода в Telegram через бота (контракт A-10).
    return RequestCodeOut(
        ok=True,
        detail="Код отправлен в Telegram бот",
        code=code if config.expose_codes else None,
    )


@router.post("/verify", response_model=TokenPair)
def verify(
    body: VerifyIn,
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
):
    uid = body.weex_uid.strip()
    row = repo.get_active_auth_code(session, uid)
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Код не запрашивался")

    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if _now() > expires:
        repo.delete_auth_code(session, uid)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Код истёк. Запросите новый.")

    if row.attempts >= config.max_code_attempts:
        repo.delete_auth_code(session, uid)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Превышено число попыток")

    if not secrets.compare_digest(row.code, body.code.strip()):
        row.attempts += 1
        session.commit()
        left = config.max_code_attempts - row.attempts
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Неверный код. Осталось попыток: {left}")

    student = repo.get_student_by_weex_uid(session, uid)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ученик не найден")

    repo.delete_auth_code(session, uid)
    return TokenPair(
        access_token=create_access_token(student.id, "student", config.jwt_secret, config.access_ttl_seconds),
        refresh_token=create_refresh_token(student.id, config.jwt_secret, config.refresh_ttl_seconds),
    )


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, config: BackendConfig = Depends(get_config)):
    try:
        payload = decode_token(body.refresh_token, config.jwt_secret)
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен refresh-токен")
    sub = payload["sub"]
    return TokenPair(
        access_token=create_access_token(sub, "student", config.jwt_secret, config.access_ttl_seconds),
        refresh_token=create_refresh_token(sub, config.jwt_secret, config.refresh_ttl_seconds),
    )


@router.post("/mentor-login", response_model=TokenPair)
def mentor_login(password: str, config: BackendConfig = Depends(get_config)):
    """Вход ментора по паролю (MVP). В проде — отдельные креды/2FA."""
    expected = os.getenv("MENTOR_PASSWORD", "")
    if not expected or not secrets.compare_digest(password, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный пароль")
    return TokenPair(
        access_token=create_access_token("mentor", "mentor", config.jwt_secret, config.access_ttl_seconds),
        refresh_token=create_refresh_token("mentor", config.jwt_secret, config.refresh_ttl_seconds),
    )
