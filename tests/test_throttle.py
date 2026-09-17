"""Бюджет запросов к бирже: сверх него ждём очереди, а не ловим отказ."""

from __future__ import annotations

import asyncio
import time

import pytest

from core import throttle
from core.throttle import Budget, take


@pytest.fixture(autouse=True)
def _clean():
    throttle.clear()
    yield
    throttle.clear()


def run(coro):
    return asyncio.run(coro)


SMALL = (Budget(2, 0.05), Budget(10, 0.05))


def test_requests_within_the_budget_do_not_wait():
    async def two():
        return await take("okx", "key-1", SMALL), await take("okx", "key-1", SMALL)

    assert run(two()) == (0.0, 0.0)


def test_the_one_over_the_budget_waits_for_its_place():
    async def three():
        await take("okx", "key-1", SMALL)
        await take("okx", "key-1", SMALL)
        started = time.monotonic()
        waited = await take("okx", "key-1", SMALL)
        return waited, time.monotonic() - started

    waited, spent = run(three())
    assert waited > 0
    # Ждали примерно окно, а не отказали.
    assert spent >= 0.04


def test_one_student_does_not_eat_the_budget_of_another():
    async def flow():
        await take("okx", "key-1", SMALL)
        await take("okx", "key-1", SMALL)
        return await take("okx", "key-2", SMALL)

    assert run(flow()) == 0.0


def test_exchanges_are_counted_apart():
    async def flow():
        await take("okx", "key-1", SMALL)
        await take("okx", "key-1", SMALL)
        return await take("weex", "key-1", SMALL)

    assert run(flow()) == 0.0


def test_the_whole_exchange_has_its_own_ceiling():
    """Сто учеников выходят к бирже с одного адреса - она считает это одним."""
    shared = (Budget(10, 0.05), Budget(2, 0.05))

    async def flow():
        await take("okx", "key-1", shared)
        await take("okx", "key-2", shared)
        return await take("okx", "key-3", shared)

    assert run(flow()) > 0


def test_a_crowd_goes_one_by_one_and_all_get_through():
    async def crowd():
        return await asyncio.gather(*(take("okx", f"key-{i}", SMALL) for i in range(6)))

    waits = run(crowd())
    assert len(waits) == 6
    # Общий предел - десять за окно, поэтому шестеро проходят без очереди.
    assert all(wait == 0.0 for wait in waits)


def test_known_exchanges_have_their_own_budgets():
    own, shared = throttle.BUDGETS["okx"]
    # Самая узкая нужная ручка OKX - позиции, 10 запросов за 2 секунды.
    assert own.limit < 10 and own.window == 2.0
    assert shared.limit >= own.limit
    assert "weex" in throttle.BUDGETS


# ── два процесса, один предел ────────────────────────────────────────────────
#
# С 16 сентября на столе два процесса: терминал и сопровождение. Счётчик живёт
# в памяти процесса, и каждый считал весь предел биржи своим - вместе они
# выходили к бирже вдвое чаще, чем мы себе разрешили.


def test_two_processes_share_the_limit_without_going_over():
    for limit in (4, 8, 10, 60):
        api = throttle.role_limit(limit, "api")
        watcher = throttle.role_limit(limit, "watcher")
        assert api + watcher == limit
        # Сопровождение ставит стопы - ему не меньше, чем терминалу.
        assert watcher >= api >= 1


def test_one_process_keeps_the_whole_limit():
    assert throttle.role_limit(10, "all") == 10
    assert throttle.role_limit(10, "") == 10


def test_the_role_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("NMNH_ROLE", "api")
    assert throttle.role_limit(10) == 4
    monkeypatch.setenv("NMNH_ROLE", "watcher")
    assert throttle.role_limit(10) == 6


async def test_affiliate_queue_is_separate_from_trading():
    """Страница наставника не занимает очередь, которой ждут стопы и цели.

    Партнёрские ручки живут на другом адресе биржи со своими пределами, а
    листают они всех рефералов по запросу на страницу. В общей очереди эта
    пачка вставала перед торговлей, а после деления бюджета между двумя
    процессами сама растянулась на сорок семь секунд (панель здоровья,
    17 сентября).
    """
    from core.weex.real import AFFILIATE_BUDGET

    throttle.clear()
    # Партнёрская очередь выбрана до дна.
    for _ in range(AFFILIATE_BUDGET[0].limit):
        assert await take("weex-affiliate", "affiliate", AFFILIATE_BUDGET, split=False) == 0

    # Торговый запрос уходит сразу же.
    assert await take("weex", "ключ-ученика") == 0
