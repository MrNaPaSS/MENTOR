"""Окружение миграций: наша база и наши модели.

Адрес базы берётся тем же путём, что у сервера (`core.db.get_database_url`), из
`.env` в корне проекта. Модели - все, что зарегистрированы в `core.models`:
по ним миграции сверяют схему, и модель, не попавшая сюда, выглядела бы для
сверки лишней таблицей в базе.
"""

from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

from core.db import Base, get_database_url  # noqa: E402 - после .env
from core import models  # noqa: E402,F401 - регистрация таблиц

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Адрес, переданный явно (тестами или сценарием переноса), важнее .env.
url = config.get_main_option("sqlalchemy.url") or get_database_url()
config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))

target_metadata = Base.metadata


def _options(connection=None) -> dict:
    return {
        "target_metadata": target_metadata,
        # Размеры строк и числа сверяем: VARCHAR(32) против VARCHAR(64) - это
        # данные, которые не влезут.
        "compare_type": True,
        # SQLite меняет таблицы только пересозданием: пакетный режим делает это
        # сам, а на Postgres ничего не меняет.
        "render_as_batch": connection is not None and connection.dialect.name == "sqlite",
        # Каждая ревизия - своей транзакцией.
        #
        # Одна транзакция на всё копит блокировки: ревизия взяла исключительную
        # на одну таблицу, следующая просит другую - и держатся обе сразу. На
        # боевой базе это кончилось взаимной блокировкой с сопровождением,
        # которое в тот же миг читало эти же таблицы в обратном порядке
        # (21 сентября, ревизии 0009-0010).
        #
        # Плата за это - остановка на полпути: упавшая ревизия не откатывает
        # прошедшие. Но прошедшие и не надо откатывать, они уже верны, а
        # повторный запуск доводит остальные.
        "transaction_per_migration": True,
    }


def run_migrations_offline() -> None:
    """Выписать SQL, не подключаясь: чтобы показать изменения до применения."""
    context.configure(url=url, literal_binds=True, **_options())
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = config.attributes.get("connection")
    if connectable is not None:
        context.configure(connection=connectable, **_options(connectable))
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with engine.connect() as connection:
        context.configure(connection=connection, **_options(connection))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
