"""Перенос базы в Postgres: копия, сверка и отказ работать по живому.

Postgres в тестах нет, поэтому приёмником стоит вторая база SQLite: проверяется
то, что от СУБД не зависит - порядок таблиц, полнота копии и отказ переносить в
непустую базу. Поправка последовательностей нужна только Postgres и на SQLite
не выполняется.
"""

from __future__ import annotations

from sqlalchemy import func, select

import migrate_to_postgres as tool
from core.db import Base, make_engine
from core.models import LiveTrade, Student


def _source(path) -> str:
    url = f"sqlite:///{path}"
    engine = make_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            Student.__table__.insert(),
            [{"tg_id": 1, "weex_uid": "6067083524"}, {"tg_id": 2, "weex_uid": ""}],
        )
        conn.execute(
            LiveTrade.__table__.insert(),
            [
                {
                    "student_id": 1,
                    "client_id": "BTCUSDT-1",
                    "symbol": "BTCUSDT",
                    "side": "long",
                    "status": "open",
                    "entry": 80_000.0,
                    "initial_stop": 79_900.0,
                    "current_stop": 79_900.0,
                    "qty": 0.01,
                    "leverage": 10,
                }
            ],
        )
    engine.dispose()
    return url


def _rows(url: str, table) -> int:
    engine = make_engine(url)
    with engine.connect() as conn:
        return int(conn.execute(select(func.count()).select_from(table)).scalar_one())


def test_the_copy_carries_every_row(tmp_path):
    source = _source(tmp_path / "from.sqlite3")
    target = f"sqlite:///{tmp_path / 'to.sqlite3'}"

    assert tool.migrate(source, target, apply=True) == 0
    assert _rows(target, Student.__table__) == 2
    assert _rows(target, LiveTrade.__table__) == 1


def test_a_dry_run_writes_nothing(tmp_path):
    source = _source(tmp_path / "from.sqlite3")
    target = f"sqlite:///{tmp_path / 'to.sqlite3'}"
    engine = make_engine(target)
    Base.metadata.create_all(engine)
    engine.dispose()

    assert tool.migrate(source, target, apply=False) == 0
    assert _rows(target, Student.__table__) == 0


def test_a_busy_target_stops_the_migration(tmp_path):
    """Переносим в пустую базу. Иначе поверх чужих строк лягут наши же ключи."""
    source = _source(tmp_path / "from.sqlite3")
    target = f"sqlite:///{tmp_path / 'to.sqlite3'}"
    engine = make_engine(target)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(Student.__table__.insert(), [{"tg_id": 9, "weex_uid": ""}])
    engine.dispose()

    assert tool.migrate(source, target, apply=True) == 1


def test_one_table_can_be_moved_alone(tmp_path):
    source = _source(tmp_path / "from.sqlite3")
    target = f"sqlite:///{tmp_path / 'to.sqlite3'}"

    assert tool.migrate(source, target, apply=True, only="students") == 0
    assert _rows(target, Student.__table__) == 2
    assert _rows(target, LiveTrade.__table__) == 0


def test_a_dry_run_works_before_the_schema_exists(tmp_path):
    """Показ не создаёт схему на приёмнике - и не должен на ней спотыкаться.

    Живой запуск падал здесь: скрипт считал строки в таблице, которой на
    приёмнике ещё нет, и вместо таблицы с числами трейдер видел разбор ошибки.
    """
    source = _source(tmp_path / "from.sqlite3")
    target = f"sqlite:///{tmp_path / 'empty.sqlite3'}"

    assert tool.migrate(source, target, apply=False) == 0
