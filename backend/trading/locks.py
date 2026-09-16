"""Замок счёта, общий для всех процессов сервера.

Перенос стопа руками и перенос в безубыток сопровождением, начатые в одни и те
же секунды, снимают заявки друг друга: на позиции остаётся то два стопа, то ни
одного. Пока сервер один процесс, их разводит обычный замок в памяти
(`PositionWatcher.account_lock`).

Как только сопровождение вынесут в свой процесс (§10.4 ТЗ мультибиржи), замка в
памяти станет мало: у каждого процесса он свой, и стеречь ему нечего. Поэтому
поверх него берётся замок базы - `pg_advisory_lock`, который Postgres держит на
всё соединение и снимает при его закрытии.

На SQLite такого замка нет вовсе, и здесь он ничего не делает: одному процессу
хватает замка в памяти. Значит, разделение процессов включается только после
переезда на Postgres - см. `docs/architecture/database.md`, §2.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager

from sqlalchemy import text

from core.db import get_database_url, get_engine

logger = logging.getLogger("nmnh.trading")


def cross_process(url: str | None = None) -> bool:
    """Умеет ли нынешняя база держать замок между процессами."""
    return (url or get_database_url()).startswith("postgres")


def lock_keys(student_id: int, exchange: str) -> tuple[int, int]:
    """Два числа под замок Postgres: ученик и биржа.

    Биржа - хеш имени, потому что ручка принимает только числа. Знаков берём
    четыре байта со знаком: это и есть предел её второго аргумента.
    """
    digest = hashlib.sha1(str(exchange or "").strip().lower().encode()).digest()
    return int(student_id), int.from_bytes(digest[:4], "big", signed=True)


def _take(engine, keys: tuple[int, int]):
    """Взять замок базы. Ждать здесь можно: вызывается в отдельном потоке."""
    conn = engine.connect()
    try:
        conn.execute(text("SELECT pg_advisory_lock(:a, :b)"), {"a": keys[0], "b": keys[1]})
        conn.commit()
    except Exception:
        conn.close()
        raise
    return conn


def _give_back(conn, keys: tuple[int, int]) -> None:
    try:
        conn.execute(text("SELECT pg_advisory_unlock(:a, :b)"), {"a": keys[0], "b": keys[1]})
        conn.commit()
    except Exception as exc:  # noqa: BLE001 - соединение закроется, и замок снимется с ним
        logger.debug("Замок счёта не снят явно: %s", exc)
    finally:
        conn.close()


@asynccontextmanager
async def db_lock(student_id: int, exchange: str):
    """Замок счёта в базе. На SQLite - пустышка."""
    if not cross_process():
        yield False
        return

    keys = lock_keys(student_id, exchange)
    try:
        conn = await asyncio.to_thread(_take, get_engine(), keys)
    except Exception as exc:  # noqa: BLE001 - без замка базы работаем как раньше
        logger.warning("Замок счёта в базе не взят (%s, %s): %s", student_id, exchange, exc)
        yield False
        return

    try:
        yield True
    finally:
        await asyncio.to_thread(_give_back, conn, keys)


@asynccontextmanager
async def account_guard(lock: asyncio.Lock | None, student_id: int, exchange: str):
    """Оба замка разом: в памяти процесса и в базе.

    Порядок один и тот же везде, иначе два процесса встанут друг против друга:
    сначала память, потом база.
    """
    async with (lock or asyncio.Lock()):
        async with db_lock(student_id, exchange):
            yield
