"""Замок счёта, общий для процессов.

Пока сервер один процесс, счёт стережёт замок в памяти. После разделения
процессов память у каждого своя, и нужен замок базы: Postgres держит
`pg_advisory_lock` на всё соединение. Здесь проверяется выбор замка и порядок
взятия - самой базы в тестах нет.
"""

from __future__ import annotations

import asyncio

from backend.trading import locks


def test_sqlite_has_no_lock_between_processes():
    assert locks.cross_process("sqlite:///nmnh_dev.sqlite3") is False
    assert locks.cross_process("postgresql+psycopg://user@host/nmnh") is True


def test_the_key_names_the_account_and_the_exchange():
    """Ключ - ученик и биржа: замок одного счёта не держит соседний."""
    weex = locks.lock_keys(7, "weex")
    okx = locks.lock_keys(7, "okx")
    other = locks.lock_keys(8, "weex")

    assert weex[0] == 7 and other[0] == 8
    assert weex[1] != okx[1]
    # Написание биржи роли не играет: ключ один и тот же.
    assert locks.lock_keys(7, " WEEX ") == weex
    # И он умещается в четыре байта со знаком - предел ручки Postgres.
    assert -(2**31) <= weex[1] < 2**31


def test_the_guard_takes_memory_first_then_the_database(monkeypatch):
    order: list[str] = []

    monkeypatch.setattr(locks, "cross_process", lambda url=None: True)
    monkeypatch.setattr(locks, "get_engine", lambda: object())
    monkeypatch.setattr(locks, "_take", lambda engine, keys: order.append("база") or "conn")
    monkeypatch.setattr(locks, "_give_back", lambda conn, keys: order.append("отдали"))

    lock = asyncio.Lock()

    async def run():
        async with locks.account_guard(lock, 1, "binance"):
            order.append("работа")
            assert lock.locked()

    asyncio.run(run())
    assert order == ["база", "работа", "отдали"]


def test_a_silent_database_does_not_stop_the_terminal(monkeypatch):
    """База не дала замок - работаем на замке в памяти, а не падаем."""
    monkeypatch.setattr(locks, "cross_process", lambda url=None: True)
    monkeypatch.setattr(locks, "get_engine", lambda: object())

    def broken(engine, keys):
        raise RuntimeError("нет связи с базой")

    monkeypatch.setattr(locks, "_take", broken)

    done = []

    async def run():
        async with locks.account_guard(asyncio.Lock(), 1, "okx"):
            done.append(True)

    asyncio.run(run())
    assert done == [True]


def test_two_passes_of_one_account_do_not_overlap():
    """Второй заход ждёт первый: ради этого замок и нужен."""
    lock = asyncio.Lock()
    marks: list[str] = []

    async def pass_one(name: str):
        async with locks.account_guard(lock, 1, "weex"):
            marks.append(f"{name} взял")
            await asyncio.sleep(0.01)
            marks.append(f"{name} отдал")

    async def both():
        await asyncio.gather(pass_one("первый"), pass_one("второй"))

    asyncio.run(both())
    assert marks == ["первый взял", "первый отдал", "второй взял", "второй отдал"]
