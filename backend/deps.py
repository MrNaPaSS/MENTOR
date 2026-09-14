"""Зависимости FastAPI: сессия БД, WEEX, настройки, текущий пользователь."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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


def get_ai_quota(request: Request):
    """Счёт ИИ-разборов на ученика. Живёт у приложения: у каждого свой."""
    return request.app.state.ai_quota


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

    # Один вход на ученика.
    #
    # Метка сессии в токене должна совпадать с той, что лежит у ученика:
    # каждый вход заводит новую, и токены прежнего устройства перестают
    # подходить. Кабинет - это терминал с чужими деньгами, и забытая открытая
    # вкладка на общем компьютере не должна оставаться рабочей навсегда.
    #
    # Пустая метка в записи означает вход, сделанный до появления этой
    # проверки: такие токены доживают свой срок и не выбрасывают человека
    # посреди работы. Первый же новый вход заводит метку, и дальше правило
    # действует.
    if student.session_key and payload.get("sid") != student.session_key:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Вход выполнен на другом устройстве"
        )

    touch_seen(session, student)
    return student


# Как часто обновляем отметку присутствия.
#
# Кабинет шлёт запросы каждые несколько секунд - цены, позиции, журнал, - и
# писать в базу на каждый значило бы менять строку ученика десятки раз в
# минуту ради поля, которое смотрят раз в час. Минуты хватает: онлайн считается
# по окну в несколько минут, и точность до секунды там не нужна.
SEEN_EVERY = timedelta(minutes=1)


def touch_seen(session, student: Student) -> None:
    """Отметить, что ученик сейчас в кабинете.

    Коммитим сразу: сессия читающей ручки закрывается без записи, и метка
    просто пропала бы. Одна короткая запись раз в минуту на ученика дешевле,
    чем неверный ответ на вопрос «кто сейчас в терминале».

    Ошибку записи глотаем: присутствие - не тот повод, из-за которого стоит
    ронять запрос ученика.
    """
    now = datetime.now(timezone.utc)
    seen = student.last_seen_at
    if seen is not None and seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    if seen is not None and now - seen < SEEN_EVERY:
        return
    student.last_seen_at = now
    try:
        session.commit()
    except Exception:  # noqa: BLE001 - метка присутствия не стоит отказа ручки
        session.rollback()


def get_current_mentor(payload: dict = Depends(get_token_payload)) -> dict:
    if payload.get("role") != "mentor":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для ментора")
    return payload


