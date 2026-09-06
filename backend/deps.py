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


def get_ws_manager(request: Request):
    return request.app.state.ws_manager


def get_notifier(request: Request):
    return request.app.state.notifier


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


def scalping_allowed(student: Student, config: BackendConfig) -> bool:
    """Открыт ли ученику скальпинг-терминал.

    Раздел работает с живыми деньгами, поэтому по умолчанию он закрыт для всех.
    Ментору открыт всегда: его UID платформа знает и так, и заставлять его
    прописывать себя же в список — верный способ закрыть раздел самому себе.
    Остальным доступ выдаётся списком в окружении.
    """
    uid = str(student.weex_uid or "")
    if config.mentor_uid and uid == config.mentor_uid:
        return True

    allowed = set(config.scalping_allowed)
    return bool(allowed) and (str(student.tg_id or "") in allowed or uid in allowed)


def require_scalping(
    payload: dict = Depends(get_token_payload),
    session=Depends(get_session),
    config: BackendConfig = Depends(get_config),
) -> Student | None:
    """Пустить в терминал ментора или ученика из списка допущенных.

    Проверка на сервере, а не только в интерфейсе: спрятанная кнопка не мешает
    открыть адрес руками, а за этим адресом — торговля.
    """
    if payload.get("role") == "mentor":
        return None

    student = session.get(Student, int(payload.get("sub") or 0))
    if student is None or not student.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    if not scalping_allowed(student, config):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Раздел пока закрыт")
    return student
