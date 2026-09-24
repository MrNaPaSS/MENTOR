"""Копия базы Postgres: снять, положить рядом с датой, старые убрать.

Копия снимается с работающей базы - в этом и была одна из причин переезда с
SQLite (`docs/architecture/database.md`, §2). Формат `custom`: он сжат и
разворачивается выборочно, таблица за таблицей.

Запуск из каталога проекта:

    python backup_db.py                 # копия в backups\\, хранить 7 дней
    python backup_db.py --keep-days 30
    python backup_db.py --out D:\\nmnh-backups
    python backup_db.py --telegram      # и отправить её наставнику в личку

Ключ ``--telegram`` отправляет снятую копию ботом наставнику (``BOT_TOKEN`` и
``ADMIN_TG_ID`` из ``.env``). Копия на диске сервера копией не является:
24.09.2026 мы потеряли базу вместе с папкой ``backups`` рядом с ней, одной
переустановкой системы. Telegram здесь не архив, а второй носитель - он не
зависит ни от машины, ни от провайдера, и файл виден с телефона. Bot API
принимает до 50 МБ; перерастём - скрипт скажет об этом словами и вернёт код
3, а копия на диске всё равно останется.

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


# Сколько Bot API принимает одним документом. Перерастём - переедем в
# облачное хранилище, а молча ронять отправку нельзя: задача в планировщике
# отчитается об успехе, и копии не станет ровно тогда, когда она нужна.
TELEGRAM_LIMIT = 50 * 1024 * 1024


def ca_bundle() -> str | None:
    """Набор доверенных корней этой машины, если он собран.

    На сервере HTTPS перехватывается, и Telegram отдаёт сертификат, подписанный
    корнем перехватчика: Windows ему верит, Python - нет. Набор собирает
    `make_ca_bundle.py`, он же кладёт `ca-bundle.pem` рядом с проектом.

    Ищем сами, а не только через `SSL_CERT_FILE`: задача из планировщика
    переменных сессии не видит, и копия переставала уезжать ровно тогда, когда
    человек об этом не узнавал.
    """
    own = (os.environ.get("SSL_CERT_FILE") or "").strip()
    if own and Path(own).exists():
        return own
    local = ROOT / "ca-bundle.pem"
    if local.exists():
        return str(local)
    return None


def _post_multipart(url: str, fields: dict[str, str], file_name: str, file_bytes: bytes):
    """Отправить файл формой. Без сторонних библиотек: скрипт зовут из планировщика."""
    import mimetypes  # noqa: PLC0415 - нужен только здесь
    import ssl  # noqa: PLC0415
    import urllib.error  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415
    import uuid  # noqa: PLC0415

    boundary = uuid.uuid4().hex
    body = bytearray()
    for key, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="document"; filename="{file_name}"\r\n'.encode()
    guess = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    body += f"Content-Type: {guess}\r\n\r\n".encode()
    body += file_bytes
    body += f"\r\n--{boundary}--\r\n".encode()

    request = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    # Проверку сертификата не отключаем даже здесь: это сняло бы защиту и с
    # остальных соединений процесса, а в копии базы лежат ключи учеников.
    bundle = ca_bundle()
    context = ssl.create_default_context(cafile=bundle) if bundle else ssl.create_default_context()

    try:
        with urllib.request.urlopen(request, timeout=300, context=context) as resp:
            return resp.status == 200, ""
    except urllib.error.HTTPError as exc:
        return False, f"Telegram ответил {exc.code}: {exc.read()[:200].decode('utf-8', 'replace')}"
    except Exception as exc:  # noqa: BLE001 - причина важнее типа, чинит человек
        hint = ""
        if "CERTIFICATE_VERIFY_FAILED" in str(exc) and not bundle:
            hint = " Соберите набор корней этой машины: python make_ca_bundle.py"
        return False, f"{type(exc).__name__}: {exc}{hint}"


def ship_to_telegram(
    path: Path,
    token: str,
    chat_id: str,
    send=_post_multipart,
) -> tuple[bool, str]:
    """Отправить копию наставнику в личку.

    Копия на диске сервера не переживёт этот сервер - 24.09.2026 мы потеряли
    базу вместе с папкой копий рядом с ней. Telegram здесь не архив, а второй
    носитель: он не зависит ни от провайдера, ни от машины, и файл виден с
    телефона.
    """
    if not token:
        return False, "Копия не отправлена: не задан BOT_TOKEN"
    if not chat_id:
        return False, "Копия не отправлена: не задан ADMIN_TG_ID"

    size = path.stat().st_size
    if size > TELEGRAM_LIMIT:
        mb = size / (1024 * 1024)
        return False, (
            f"Копия не отправлена: {mb:.0f} МБ больше 50 МБ, которые принимает Telegram. "
            "Пора настроить выгрузку в облачное хранилище."
        )

    caption = f"Копия базы NMNH: {path.name}, {size / (1024 * 1024):.1f} МБ"
    ok, why = send(
        f"https://api.telegram.org/bot{token}/sendDocument",
        {"chat_id": str(chat_id), "caption": caption},
        path.name,
        path.read_bytes(),
    )
    return (True, "") if ok else (False, f"Копия не отправлена: {why}")


def run(out_dir: Path, keep_days: int, url: str, to_telegram: bool = False) -> int:
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

    if to_telegram:
        ok, why = ship_to_telegram(
            target,
            os.getenv("BOT_TOKEN", ""),
            os.getenv("ADMIN_TG_ID", ""),
        )
        print("Копия отправлена в Telegram" if ok else why)
        # Неудачная отправка - не повод считать проход провальным: копия на
        # диске уже есть. Но код возврата другой, чтобы задача в планировщике
        # отметилась не зелёной и это было видно в её журнале.
        if not ok:
            return 3
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Копия базы Postgres")
    parser.add_argument("--out", default=str(ROOT / "backups"), help="куда складывать копии")
    parser.add_argument("--keep-days", type=int, default=KEEP_DAYS, help="сколько дней хранить")
    parser.add_argument("--url", default=os.getenv("DATABASE_URL", ""), help="адрес базы")
    parser.add_argument(
        "--telegram",
        action="store_true",
        help="отправить копию наставнику в Telegram (BOT_TOKEN и ADMIN_TG_ID из .env)",
    )
    args = parser.parse_args(argv)

    if not args.url:
        print("Адрес базы не задан: --url или DATABASE_URL")
        return 2
    try:
        return run(Path(args.out), args.keep_days, args.url, args.telegram)
    except ValueError as exc:
        print(str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
