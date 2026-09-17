"""Отложенный отпуск монеты: история переживает уход и возврат трейдера."""

from __future__ import annotations

import asyncio

import pytest

from backend.scalping.linger import Linger


@pytest.mark.asyncio
async def test_release_waits_for_delay():
    """Монета отпускается не в момент ухода, а по сроку."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=0.05, limit=3)

    await linger.part("BTCUSDT")
    assert gone == []
    assert linger.waiting("BTCUSDT")

    await asyncio.sleep(0.09)
    assert gone == ["BTCUSDT"]
    assert not linger.waiting("BTCUSDT")


@pytest.mark.asyncio
async def test_return_cancels_release():
    """Вернулись внутри срока - монету не отпускают вовсе."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=0.05, limit=3)

    await linger.part("BTCUSDT")
    assert linger.keep("BTCUSDT") is True
    await asyncio.sleep(0.09)
    assert gone == []
    # Второй возврат уже ничего не отменяет: отпуска не запланировано.
    assert linger.keep("BTCUSDT") is False


@pytest.mark.asyncio
async def test_oldest_leaves_when_limit_reached():
    """Сверх предела самая давняя монета отпускается сразу."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=5.0, limit=2)

    await linger.part("BTCUSDT")
    await linger.part("ETHUSDT")
    assert gone == []
    await linger.part("SOLUSDT")

    assert gone == ["BTCUSDT"]
    assert not linger.waiting("BTCUSDT")
    assert linger.waiting("ETHUSDT") and linger.waiting("SOLUSDT")


@pytest.mark.asyncio
async def test_same_symbol_twice_keeps_one_plan():
    """Повторный уход той же монеты не плодит сроков."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=0.05, limit=2)

    await linger.part("BTCUSDT")
    await linger.part("BTCUSDT")
    await asyncio.sleep(0.09)

    assert gone == ["BTCUSDT"]


@pytest.mark.asyncio
async def test_zero_delay_releases_at_once():
    """Срок выключен - поведение прежнее, отпуск в момент ухода."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=0.0, limit=3)

    await linger.part("BTCUSDT")
    assert gone == ["BTCUSDT"]


@pytest.mark.asyncio
async def test_clear_releases_everything():
    """Остановка сбора отпускает всё, что доживало срок."""
    gone: list[str] = []
    linger = Linger(lambda s: _note(gone, s), delay=5.0, limit=3)

    await linger.part("BTCUSDT")
    await linger.part("ETHUSDT")
    await linger.clear()

    assert sorted(gone) == ["BTCUSDT", "ETHUSDT"]
    assert not linger.waiting("BTCUSDT")


@pytest.mark.asyncio
async def test_broken_release_does_not_kill_collector():
    """Сбой отпуска не уносит с собой задачу и не мешает остальным."""
    gone: list[str] = []

    async def release(symbol: str) -> None:
        if symbol == "BTCUSDT":
            raise RuntimeError("биржа не ответила")
        gone.append(symbol)

    linger = Linger(release, delay=0.05, limit=3)
    await linger.part("BTCUSDT")
    await linger.part("ETHUSDT")
    await asyncio.sleep(0.09)

    assert gone == ["ETHUSDT"]


async def _note(sink: list[str], symbol: str) -> None:
    sink.append(symbol)
