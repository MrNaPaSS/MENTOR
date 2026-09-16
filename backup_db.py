"""Копия базы Postgres: снять, положить рядом с датой, старые убрать.

Копия снимается с работающей базы - в этом и была одна из причин переезда с
SQLite (`docs/architecture/database.md`, §2). Формат `custom`: он сжат и
разворачивается выборочно, таблица за таблицей.

Запуск из каталога проекта:

    python backup_db.py                 # копия в backups\\, хранить 7 дней
    python backup_db.py --keep-days 30
    python backup_db.py --out D:\\nmnh-backups

Адрес базы берётся из `DATABASE_URL` (файл `.env`). Путь к `pg_dump` ищется
сам среди установленных версий Postgres; если он лежит иначе, задайте
`PG_DUMP` в окружении.

Восстановление копии (база должна существовать и быть пустой):

    pg_restore --clean --if-exists -U nmnh -d nmnh backups\\nmnh-20260916-0300.dump
"""

from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

# Каталог проекта, а не текущий: задача из планировщика Windows запускается из
# системной папки, и `.env` рядом с ней искать бессмысленно.
ROOT = Path(__file__).resolve().parent

try:  # pragma: no cover - без python-dotenv читаем только окружение
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

# Где Windows держит Postgres. Версий может стоять несколько - берём старшую.
PG_ROOTS = (r"C:\Program Files\PostgreSQL\*\bin\pg_dump.exe",)
KEEP_DAYS = 7
PREFIX = "nmnh-"
SUFFIX = ".dump"


def parse_url(url: str) -> dict[str, str]:
    """Адрес базы в части, которые понимает `pg_dump`."""
    parsed = urlparse(url)
    if not parsed.scheme.startswith("postgres"):
        raise ValueError("Копия снимается только с Postgres: в DATABASE_URL другая база")
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": (parsed.path or "/").lstrip("/"),
    }


def find_pg_dump(patterns: tuple[str, ...] = PG_ROOTS) -> str:
    """Путь к `pg_dump`: из окружения, из PATH или из установленных версий."""
    own = (os.environ.get("PG_DUMP") or "").strip()
    if own:
        return own
    found: list[str] = []
    for pattern in patterns:
        found.extend(glob.glob(pattern))
    if found:
        # Старшая версия последней в отсортированном списке: путь содержит номер.
        return sorted(found)[-1]
    return "pg_dump"


def backup_name(at: datetime | None = None) -> str:
    stamp = (at or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M")
    return f"{PREFIX}{stamp}{SUFFIX}"


def stale(files: list[Path], keep_days: int, now: float | None = None) -> list[Path]:
    """Копии старше срока хранения. Свежую не трогаем никогда.

    Даже если срок вышел у всех: база без единой копии хуже, чем копия старше
    положенного.
    """
    if keep_days <= 0:
        return []
    fresh_first = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)
    edge = (now if now is not None else time.time()) - keep_days * 86400
    return [path for path in fresh_first[1:] if path.stat().st_mtime < edge]


def run(out_dir: Path, keep_days: int, url: str) -> int:
    parts = parse_url(url)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / backup_name()

    command = [
        find_pg_dump(),
        "--format=custom",
        "--host", parts["host"],
        "--port", parts["port"],
        "--username", parts["user"],
        "--file", str(target),
        parts["database"],
    ]
    env = {**os.environ}
    if parts["password"]:
        env["PGPASSWORD"] = parts["password"]

    started = time.monotonic()
    done = subprocess.run(command, env=env, capture_output=True, text=True)
    if done.returncode != 0:
        # Ошибку показываем словами биржи, а не кодом: чинить будет человек.
        print(f"Копия не снята: {done.stderr.strip() or done.returncode}")
        target.unlink(missing_ok=True)
        return 1

    size = target.stat().st_size / (1024 * 1024)
    print(f"Копия готова: {target} ({size:.1f} МБ, за {time.monotonic() - started:.0f} с)")

    old = stale(sorted(out_dir.glob(f"{PREFIX}*{SUFFIX}")), keep_days)
    for path in old:
        path.unlink(missing_ok=True)
    if old:
        print(f"Убрано старых копий: {len(old)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Копия базы Postgres")
    parser.add_argument("--out", default=str(ROOT / "backups"), help="куда складывать копии")
    parser.add_argument("--keep-days", type=int, default=KEEP_DAYS, help="сколько дней хранить")
    parser.add_argument("--url", default=os.getenv("DATABASE_URL", ""), help="адрес базы")
    args = parser.parse_args(argv)

    if not args.url:
        print("Адрес базы не задан: --url или DATABASE_URL")
        return 2
    try:
        return run(Path(args.out), args.keep_days, args.url)
    except ValueError as exc:
        print(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
