"""Копия базы: разбор адреса, поиск pg_dump и срок хранения.

Самого Postgres в тестах нет: проверяется то, что решает скрипт до запуска
внешней программы, и правило, по которому старые копии удаляются.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

import backup_db as tool


def test_the_address_is_split_the_way_pg_dump_wants():
    parts = tool.parse_url("postgresql+psycopg://nmnh:секрет@localhost:5432/nmnh")
    assert parts == {
        "host": "localhost",
        "port": "5432",
        "user": "nmnh",
        "password": "секрет",
        "database": "nmnh",
    }


def test_sqlite_is_refused_with_words():
    """С файла SQLite копию так не снимают - и молчать об этом нельзя."""
    with pytest.raises(ValueError):
        tool.parse_url("sqlite:///nmnh_dev.sqlite3")


def test_the_newest_postgres_wins(tmp_path):
    older = tmp_path / "16" / "bin"
    newer = tmp_path / "18" / "bin"
    for folder in (older, newer):
        folder.mkdir(parents=True)
        (folder / "pg_dump.exe").write_text("")

    found = Path(tool.find_pg_dump((str(tmp_path / "*" / "bin" / "pg_dump.exe"),)))
    # Номер версии - предпоследняя папка пути; сравниваем по частям, а не по
    # написанию слэшей.
    assert found.parts[-3] == "18"


def _dump(folder: Path, name: str, age_days: float) -> Path:
    path = folder / name
    path.write_text("копия")
    when = time.time() - age_days * 86400
    import os

    os.utime(path, (when, when))
    return path


def test_old_copies_go_and_fresh_ones_stay(tmp_path):
    fresh = _dump(tmp_path, "nmnh-20260916-0300.dump", age_days=0.1)
    week = _dump(tmp_path, "nmnh-20260909-0300.dump", age_days=8)
    month = _dump(tmp_path, "nmnh-20260816-0300.dump", age_days=31)

    old = tool.stale([fresh, week, month], keep_days=7)
    assert set(old) == {week, month}


def test_the_last_copy_is_never_deleted(tmp_path):
    """Даже просроченная копия лучше, чем база совсем без копий."""
    only = _dump(tmp_path, "nmnh-20260101-0300.dump", age_days=300)
    assert tool.stale([only], keep_days=7) == []


def test_zero_days_means_keep_everything(tmp_path):
    old = _dump(tmp_path, "nmnh-20260101-0300.dump", age_days=300)
    newer = _dump(tmp_path, "nmnh-20260901-0300.dump", age_days=15)
    assert tool.stale([old, newer], keep_days=0) == []


def test_the_name_carries_the_date():
    from datetime import datetime, timezone

    name = tool.backup_name(datetime(2026, 9, 16, 3, 0, tzinfo=timezone.utc))
    assert name == "nmnh-20260916-0300.dump"


# ── Отправка копии в Telegram ──
#
# Копия, лежащая на том же сервере, что и база, копией не является: 24.09.2026
# мы потеряли и базу, и папку backups рядом с ней одной переустановкой. Здесь
# проверяется то, что решает скрипт до похода в сеть.


def test_bez_tokena_otpravka_propuskaetsya(tmp_path):
    """Не задан бот - говорим об этом, но копию снятой считаем."""
    dump = _dump(tmp_path, "nmnh-20260924-0300.dump", age_days=0)
    ok, why = tool.ship_to_telegram(dump, token="", chat_id="123", send=None)
    assert ok is False
    assert "BOT_TOKEN" in why


def test_bez_adresata_otpravka_propuskaetsya(tmp_path):
    dump = _dump(tmp_path, "nmnh-20260924-0300.dump", age_days=0)
    ok, why = tool.ship_to_telegram(dump, token="t", chat_id="", send=None)
    assert ok is False
    assert "ADMIN_TG_ID" in why


def test_slishkom_bolshoj_fajl_ne_otpravlyaetsya(tmp_path):
    """Bot API принимает до 50 МБ - молчать про отказ нельзя.

    Иначе задача в планировщике отчитается об успехе, а копии не будет: как
    раз тот случай, ради которого всё и затевалось.
    """
    dump = tmp_path / "nmnh-20260924-0300.dump"
    dump.write_bytes(b"x" * (tool.TELEGRAM_LIMIT + 1))
    ok, why = tool.ship_to_telegram(dump, token="t", chat_id="1", send=None)
    assert ok is False
    assert "50" in why


def test_fajl_uhodit_adresatu(tmp_path):
    dump = _dump(tmp_path, "nmnh-20260924-0300.dump", age_days=0)
    ushlo = {}

    def send(url, fields, file_name, file_bytes):
        ushlo.update(url=url, fields=fields, name=file_name, size=len(file_bytes))
        return True, ""

    ok, why = tool.ship_to_telegram(dump, token="TOK", chat_id="511", send=send)
    assert ok is True and why == ""
    assert "TOK" in ushlo["url"] and ushlo["url"].endswith("/sendDocument")
    assert ushlo["fields"]["chat_id"] == "511"
    assert ushlo["name"] == "nmnh-20260924-0300.dump"


def test_v_podpisi_vidno_chto_za_kopiya(tmp_path):
    """Подпись читает человек в телефоне - в ней дата и размер."""
    dump = _dump(tmp_path, "nmnh-20260924-0300.dump", age_days=0)
    fields = {}

    def send(url, f, file_name, file_bytes):
        fields.update(f)
        return True, ""

    tool.ship_to_telegram(dump, token="t", chat_id="1", send=send)
    assert "nmnh-20260924-0300.dump" in fields["caption"]
