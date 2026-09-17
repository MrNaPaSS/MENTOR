"""Схема базы через миграции: сверка, пометка и обновление.

Схему боевой базы ведёт Alembic (`migrations/`), а не `create_all` при запуске:
тот умеет только создавать таблицы целиком и не меняет существующие, и новые
поля докатывались ручными `ALTER TABLE`. На Postgres с живыми сделками учеников
это была лотерея: забытая или повторённая команда - и сервер падает при запуске
или, хуже, запускается с базой, которая не совпадает с кодом.

Здесь всё, чем пользуются сценарий обновления стола (`migrate_db.py`), запуск
сервера (`core/db.py`) и тесты. SQLite (разработка и тесты) по-прежнему
создаёт таблицы сам: там нечего беречь, а скорость запуска тестов важна.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from sqlalchemy import inspect as sa_inspect, text

ROOT = Path(__file__).resolve().parent.parent

# Первая ревизия - снимок схемы на 17 сентября 2026. База, созданная раньше
# миграций, помечается не ею, а последней: сверка сравнивает такую базу с
# моделями, и раз схема совпала - применять к ней уже нечего (см. `migrate`).
BASELINE = "0001"

# Расхождения, при которых сервер работать не сможет: в модели есть, в базе
# нет. Первый же запрос к такой таблице или полю упадёт.
BLOCKING = ("add_table", "add_column")


def alembic_config(url: str):
    """Настройки Alembic с явным адресом базы - не из `.env`, а переданным."""
    from alembic.config import Config

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def head_revision() -> str:
    """Последняя ревизия в коде."""
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(ROOT / "migrations"))
    return str(script.get_current_head() or "")


def current_revision(engine) -> str | None:
    """Ревизия, до которой доведена база. `None` - миграции на ней не велись."""
    if "alembic_version" not in set(sa_inspect(engine).get_table_names()):
        return None
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM alembic_version")).first()
    return str(row[0]) if row else None


def schema_diffs(engine) -> list[Any]:
    """Чем база отличается от моделей, в словах Alembic."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from core import models  # noqa: F401 - регистрация таблиц
    from core.db import Base

    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True})
        diffs = compare_metadata(context, Base.metadata)
    # Изменения одной колонки Alembic отдаёт пачкой - раскладываем по одному.
    flat: list[Any] = []
    for diff in diffs:
        if isinstance(diff, list):
            flat.extend(diff)
        else:
            flat.append(diff)
    return flat


def _kind(diff: Any) -> str:
    return str(diff[0]) if isinstance(diff, tuple) and diff else "?"


def describe(diff: Any) -> str:
    """Расхождение по-русски: что именно и где."""
    kind = _kind(diff)
    if kind == "add_table":
        return f"в базе нет таблицы {diff[1].name}"
    if kind == "remove_table":
        return f"в базе лишняя таблица {diff[1].name} (в моделях её нет)"
    if kind == "add_column":
        return f"в базе нет поля {diff[2]}.{diff[3].name}"
    if kind == "remove_column":
        return f"в базе лишнее поле {diff[2]}.{diff[3].name}"
    if kind == "add_index":
        return f"в базе нет указателя {diff[1].name}"
    if kind == "remove_index":
        return f"в базе лишний указатель {diff[1].name}"
    if kind == "modify_nullable":
        was, now = diff[5], diff[6]
        return (
            f"поле {diff[2]}.{diff[3]}: в базе "
            f"{'может быть пустым' if was else 'не пустое'}, в модели "
            f"{'может быть пустым' if now else 'не пустое'}"
        )
    if kind == "modify_type":
        return f"поле {diff[2]}.{diff[3]}: в базе {diff[5]}, в модели {diff[6]}"
    return f"{kind}: {diff[1:]}"


def blocking(diffs: list[Any]) -> list[Any]:
    """Расхождения, с которыми сервер работать не сможет."""
    return [diff for diff in diffs if _kind(diff) in BLOCKING]


def take_backup(url: str) -> int:
    """Копия базы перед изменением схемы: `backup_db.py`, в `backups/`."""
    import backup_db

    return backup_db.run(ROOT / "backups", backup_db.KEEP_DAYS, url)


def migrate(
    url: str,
    say: Callable[[str], None] = print,
    backup: Callable[[str], int] | None = None,
) -> int:
    """Довести базу до последней ревизии. 0 - готово, 1 - нужен разбор.

    Три случая:

    * база пустая - создаём схему миграциями с нуля;
    * база создана до миграций (таблицы есть, отметки ревизии нет) - сверяем
      её со снимком и, если сервер на ней заработает, помечаем первой
      ревизией. Данные при этом не трогаются: добавляется одна служебная
      таблица с номером ревизии;
    * база уже под миграциями - применяем то, чего ей не хватает.
    """
    from alembic import command

    from core.db import make_engine

    engine = make_engine(url)
    config = alembic_config(url)
    head = head_revision()
    try:
        tables = set(sa_inspect(engine).get_table_names())
        current = current_revision(engine)

        if current is None and "students" in tables:
            say("База создана до миграций - сверяю её со снимком схемы.")
            diffs = schema_diffs(engine)
            stop = blocking(diffs)
            if stop:
                say("Не помечаю: с такими расхождениями сервер не заработает.")
                for diff in stop:
                    say(f"  - {describe(diff)}")
                say("Пришлите этот вывод - нужна ревизия, которая их устранит.")
                return 1
            # Помечаем последней ревизией, а не первой.
            #
            # Сверка выше сравнивает базу не со снимком первой ревизии, а с
            # моделями - то есть с тем, какой схема должна быть сейчас.
            # Совпала - значит база уже на уровне последней ревизии, и метка
            # первой заставила бы применять к ней всё, что вышло после:
            # «колонка уже есть» на первой же попытке. Так и случилось бы с
            # базой, созданной `create_all` до миграций.
            command.stamp(config, head)
            say(f"База помечена ревизией {head}. Данные не тронуты.")
            _report_minor(diffs, say)
        elif current is None:
            say("База пустая - создаю схему миграциями.")

        before = current_revision(engine)
        if before != head:
            # На базе с данными схему меняем только после свежей копии. Ревизия,
            # написанная с ошибкой, - это потерянные сделки учеников, и
            # откатывать её без копии нечем. Не снялась копия - не трогаем.
            #
            # Копия снимается `pg_dump`, то есть только с Postgres. На SQLite
            # (разработка и тесты) снимать нечем, и требовать её значило бы не
            # дать применить ни одной ревизии. Явно переданный `backup`
            # спрашиваем всегда: им подменяют копию в тестах.
            needs_backup = backup is not None or url.startswith("postgres")
            if before is not None and needs_backup:
                say("Перед изменением схемы снимаю копию базы.")
                if (backup or take_backup)(url) != 0:
                    say("Копия не снята - схему не меняю. Сервер не запускаю.")
                    return 1
            command.upgrade(config, "head")
            say(f"Схема обновлена: {before or 'пусто'} -> {head}.")
        else:
            say(f"Схема актуальна: ревизия {head}.")
        return 0
    finally:
        engine.dispose()


def _report_minor(diffs: list[Any], say: Callable[[str], None]) -> None:
    """Расхождения, с которыми сервер работает, - но о них надо знать."""
    rest = [diff for diff in diffs if _kind(diff) not in BLOCKING]
    if not rest:
        say("Схема базы совпадает со снимком полностью.")
        return
    say(f"Мелкие расхождения ({len(rest)}), сервер с ними работает:")
    for diff in rest:
        say(f"  - {describe(diff)}")
    say("Пришлите этот список: их стоит свести отдельной ревизией.")


def require_current(engine) -> None:
    """Не пускать сервер на базу, которую не довели до последней ревизии.

    Запуск на отставшей базе не падает сразу: он падает на первом запросе к
    новому полю, посреди торговли. Лучше не подняться вовсе и сказать почему.
    """
    head = head_revision()
    current = current_revision(engine)
    if current != head:
        raise RuntimeError(
            f"Схема базы не обновлена (в базе {current or 'нет отметки'}, в коде {head}). "
            "Выполните: python migrate_db.py"
        )
