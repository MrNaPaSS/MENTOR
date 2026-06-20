"""Миграция: добавить столбец symbol в таблицу broadcasts.

SQLite поддерживает ADD COLUMN, поэтому достаточно одной команды.
Запуск: python migrate_broadcast_symbol.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "nmnh_dev.sqlite3")

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cols = [r[1] for r in cur.execute("PRAGMA table_info(broadcasts)").fetchall()]
if "symbol" in cols:
    print("Столбец symbol уже существует — пропуск.")
else:
    cur.execute("ALTER TABLE broadcasts ADD COLUMN symbol VARCHAR(32)")
    conn.commit()
    print("Миграция выполнена: добавлен broadcasts.symbol")

conn.close()
