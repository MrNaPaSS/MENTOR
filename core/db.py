"""Подключение к БД (единый PostgreSQL; для локальной разработки — SQLite).

URL берётся из ``DATABASE_URL`` (см. .env.example). SQLAlchemy абстрагирует СУБД, поэтому код
одинаков для Postgres и SQLite.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", "sqlite:///nmnh_dev.sqlite3")


def make_engine(url: str | None = None):
    url = url or get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, connect_args=connect_args)


# Глобальные engine/Session (ленивая инициализация при первом обращении).
_engine = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


def init_engine(url: str | None = None):
    """Инициализировать engine и привязать к нему фабрику сессий."""
    global _engine
    _engine = make_engine(url)
    SessionLocal.configure(bind=_engine)
    return _engine


def get_engine():
    if _engine is None:
        init_engine()
    return _engine


def create_all() -> None:
    """Создать таблицы (для dev/тестов; в проде — миграции)."""
    from core import models  # noqa: F401 — регистрация моделей

    Base.metadata.create_all(get_engine())
