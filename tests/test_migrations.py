"""Миграции схемы: снимок совпадает с моделями, старая база помечается верно.

Главный из этих тестов - сторож на будущее. Поле добавили в модель, а ревизию
не написали - на столе `migrate_db.py` ничего не применит, и сервер упадёт на
первом запросе к новому полю. Здесь это видно раньше: схема, собранная
миграциями с нуля, перестанет совпадать с моделями.
"""

from __future__ import annotations

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect as sa_inspect, text

from core import migrations
from core import models  # noqa: F401 - регистрация таблиц
from core.db import Base


@pytest.fixture()
def db_url(tmp_path):
    return f"sqlite:///{(tmp_path / 'schema.sqlite3').as_posix()}"


def test_migrations_build_exactly_the_models(db_url):
    """Написали поле в модели - напишите ревизию. Иначе этот тест красный."""
    command.upgrade(migrations.alembic_config(db_url), "head")

    engine = create_engine(db_url)
    try:
        diffs = migrations.schema_diffs(engine)
    finally:
        engine.dispose()
    assert diffs == [], "\n".join(migrations.describe(one) for one in diffs)


def test_a_database_made_before_migrations_is_stamped_not_rebuilt(db_url):
    """Боевая база уже есть: её помечают, а не создают таблицы поверх."""
    from sqlalchemy.orm import Session

    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(models.Student(tg_id=1))
        session.commit()
    engine.dispose()

    said: list[str] = []
    assert migrations.migrate(db_url, say=said.append) == 0

    engine = create_engine(db_url)
    try:
        assert migrations.current_revision(engine) == migrations.head_revision()
        with engine.connect() as conn:
            # Данные на месте: пометка их не трогает.
            assert conn.execute(text("SELECT COUNT(*) FROM students")).scalar() == 1
    finally:
        engine.dispose()
    assert any("помечена" in line for line in said)


def test_a_database_missing_a_table_is_not_stamped(db_url):
    """С дырой в схеме сервер не заработает - помечать такую базу нельзя."""
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE chart_shots"))
    engine.dispose()

    said: list[str] = []
    assert migrations.migrate(db_url, say=said.append) == 1

    engine = create_engine(db_url)
    try:
        assert "alembic_version" not in sa_inspect(engine).get_table_names()
    finally:
        engine.dispose()
    assert any("chart_shots" in line for line in said)


def test_an_empty_database_is_built_by_migrations(db_url):
    said: list[str] = []
    assert migrations.migrate(db_url, say=said.append) == 0

    engine = create_engine(db_url)
    try:
        assert "students" in sa_inspect(engine).get_table_names()
        assert migrations.current_revision(engine) == migrations.head_revision()
    finally:
        engine.dispose()


def test_the_server_refuses_a_database_left_behind(db_url):
    """Отставшая база: лучше не подняться, чем упасть посреди торговли."""
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)
    try:
        with pytest.raises(RuntimeError, match="migrate_db.py"):
            migrations.require_current(engine)
    finally:
        engine.dispose()


def test_no_schema_change_without_a_fresh_backup(db_url, monkeypatch):
    """Ревизия с ошибкой без копии - это потерянные сделки. Копии нет - стоп."""
    command.upgrade(migrations.alembic_config(db_url), "head")
    # Код ушёл вперёд на ревизию: базе есть что применять.
    monkeypatch.setattr(migrations, "head_revision", lambda: "9999")
    applied: list[str] = []
    monkeypatch.setattr(command, "upgrade", lambda *a, **k: applied.append("upgrade"))

    said: list[str] = []
    assert migrations.migrate(db_url, say=said.append, backup=lambda url: 1) == 1
    assert applied == []

    # Копия снялась - схема обновляется.
    assert migrations.migrate(db_url, say=said.append, backup=lambda url: 0) == 0
    assert applied == ["upgrade"]


# ── блокировки на живой базе ────────────────────────────────────────────────
#
# 21 сентября ревизия 0009 меняла две таблицы разом и на боевой базе получила
# взаимную блокировку: она держала `scalp_trades` и ждала `live_trades`, а
# сопровождение в тот же миг держало `live_trades` и ждало `scalp_trades`.
# Postgres разорвал кольцо отказом, миграция не прошла.
#
# Два правила ниже - память об этом. Оба про то, чтобы миграция не держала две
# исключительные блокировки одновременно.


def test_each_revision_locks_one_table_at_a_time():
    """Одна изменяемая таблица на ревизию.

    Две в одной транзакции - это две блокировки разом, то есть половина
    кольца, в котором сервер ждёт нас, а мы его. Новую таблицу это правило не
    трогает: `create_table` никому дорогу не переходит.
    """
    import re
    from pathlib import Path

    here = Path(__file__).resolve().parent.parent / "migrations" / "versions"
    names = re.compile(r"batch_alter_table\(\s*['\"]([a-z_]+)['\"]")
    born = re.compile(r"create_table\(\s*['\"]([a-z_]+)['\"]")
    first = re.compile(r"down_revision:[^=]*=\s*None")

    for one in sorted(here.glob("*.py")):
        text = one.read_text(encoding="utf-8")
        # Базовая ревизия собирает схему с нуля: она идёт по пустой базе, где
        # сервера ещё нет и спорить за таблицы не с кем.
        if first.search(text):
            continue
        # Таблицу, которую ревизия сама же и завела, считать не за что: её
        # ещё никто не читает, и блокировать в ней нечего.
        tables = set(names.findall(text)) - set(born.findall(text))
        assert len(tables) <= 1, (
            f"{one.name} меняет сразу {sorted(tables)} - разделите на ревизии: "
            "две блокировки в одной транзакции дают взаимную блокировку с сервером"
        )


def test_migrations_run_one_transaction_each():
    """Каждая ревизия - своей транзакцией.

    Иначе разделение на ревизии ничего не даёт: alembic обернул бы их все в
    одну транзакцию, и блокировки копились бы точно так же.
    """
    from pathlib import Path

    env = (Path(__file__).resolve().parent.parent / "migrations" / "env.py").read_text(
        encoding="utf-8"
    )
    assert '"transaction_per_migration": True' in env
