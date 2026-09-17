"""Роль процесса: что он поднимает при старте.

Разделение нужно затем, чтобы перезапуск сайта не останавливал сопровождение
сделок. Пока база SQLite, роль одна - `all`: замок счёта у процессов общий
только на Postgres (backend/trading/locks.py).
"""

from __future__ import annotations

from backend.main import ROLES, process_role


def test_by_default_everything_lives_in_one_process():
    assert process_role("") == "all"
    assert process_role(None if False else "  ") == "all"


def test_roles_are_read_as_written():
    assert process_role("api") == "api"
    assert process_role(" Watcher ") == "watcher"
    # `market` - рыночные данные своим процессом: потоки бирж и стакан
    # (docs/architecture/database.md §6.1).
    assert process_role("market") == "market"
    assert set(ROLES) == {"all", "api", "watcher", "market"}


def test_an_unknown_role_does_not_stop_the_server():
    """Опечатка в окружении не повод остаться без сервера: работаем как all."""
    assert process_role("апи") == "all"
