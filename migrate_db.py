"""Довести схему базы до последней ревизии. Запускается перед сервером.

`start.bat` зовёт его сам, до того как поднять окна сервера. Руками - так же:

    python migrate_db.py

Базу, созданную до миграций, он сверяет со снимком схемы и помечает первой
ревизией, данных не трогая. Если сверка нашла то, с чем сервер не заработает,
- ничего не делает и говорит, что именно.

SQLite (разработка и тесты) пропускается: там таблицы создаёт сам сервер.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from core.db import get_database_url  # noqa: E402 - после .env
from core.migrations import migrate  # noqa: E402


def main() -> int:
    url = get_database_url()
    if url.startswith("sqlite"):
        print("SQLite: таблицы создаёт сам сервер при запуске, миграции не нужны.")
        return 0
    return migrate(url)


if __name__ == "__main__":
    sys.exit(main())
