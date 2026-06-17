"""Миграция: сделать tg_id nullable в таблице students.

SQLite не поддерживает ALTER COLUMN, поэтому пересоздаём таблицу.
Запуск: python migrate_tg_id_nullable.py
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), "nmnh_dev.sqlite3")

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.executescript("""
PRAGMA foreign_keys = OFF;

CREATE TABLE students_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id BIGINT UNIQUE,
    username VARCHAR(64),
    weex_uid VARCHAR(64),
    mode VARCHAR(16) DEFAULT 'moderate',
    risk_percent NUMERIC(6,2),
    turbo_leverage INTEGER,
    language VARCHAR(2) DEFAULT 'ru',
    balance_usdt NUMERIC(20,8),
    balance_source VARCHAR(16) DEFAULT 'affiliate_api',
    balance_updated_at DATETIME,
    is_active BOOLEAN DEFAULT 1,
    is_approved BOOLEAN DEFAULT 0,
    created_at DATETIME
);

INSERT INTO students_new SELECT * FROM students;

DROP TABLE students;
ALTER TABLE students_new RENAME TO students;

CREATE INDEX IF NOT EXISTS ix_students_tg_id ON students(tg_id);

PRAGMA foreign_keys = ON;
""")

conn.commit()
conn.close()
print("Миграция выполнена успешно.")
