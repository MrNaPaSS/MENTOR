"""Зависимости FastAPI: сессия БД, WEEX, настройки, текущий пользователь."""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status

from core import repo
from core.db import SessionLocal
from core.models import Student
from backend.config import BackendConfig
from backend.security import decode_token, TokenError


def get_config(request: Request) -> BackendConfig:
    return request.app.state.config


def get_weex(request: Request):
    return request.app.state.weex


def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def get_settings(session=Depends(get_session)):
    return repo.load_settings(session)


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется Bearer-токен")
    return authorization.split(" ", 1)[1]


def get_token_payload(
    authorization: Optional[str] = Header(default=None),
    config: BackendConfig = Depends(get_config),
) -> dict:
    token = _bearer(authorization)
    try:
        payload = decode_token(token, config.jwt_secret)
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен access-токен")
    return payload


def get_current_student(
    payload: dict = Depends(get_token_payload),
    session=Depends(get_session),
) -> Student:
    student = session.get(Student, int(payload["sub"]))
    if student is None or not student.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return student


def get_current_mentor(payload: dict = Depends(get_token_payload)) -> dict:
    if payload.get("role") != "mentor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для ментора")
    return payload
