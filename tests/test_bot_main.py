"""Тесты точки входа бота (без реального polling)."""

import pytest

from core.db import SessionLocal
from core import repo


def test_setup_database_seeds(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/main.sqlite3")
    import bot.main as bm

    bm.setup_database()
    with SessionLocal() as s:
        assert repo.load_settings(s).turbo_margin_cap is not None


async def test_run_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/main2.sqlite3")
    monkeypatch.setenv("BOT_TOKEN", "")
    monkeypatch.setenv("ADMIN_TG_ID", "0")
    import bot.main as bm

    with pytest.raises(SystemExit):
        await bm.run()
