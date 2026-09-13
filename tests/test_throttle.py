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
