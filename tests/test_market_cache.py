"""Кэш рыночных данных: свежесть, устаревшее и предел устаревания (ТЗ этап 1, §4.2).

Кэш отдаёт **значение и признак свежести**, а не одно значение: вызывающему
нужно знать, отдал он живые данные или последние известные. Главное здесь -
предел устаревания. У образца (OpenTerminal) его нет вовсе, устаревшее живёт
вечно; в продукте, где по этой цене считают позицию, так нельзя.
"""

from __future__ import annotations

import pytest

from backend.sources import cache


@pytest.fixture(autouse=True)
def чистый_кэш():
    cache.reset()
    yield
    cache.reset()


def _считающий(value, *, ломается: bool = False):
    """Строитель значения, который помнит, сколько раз его звали."""
    calls: list[int] = []

    async def builder():
        calls.append(1)
        if ломается:
            raise RuntimeError("источник упал")
        return value

    return builder, calls


# ── Свежее ───────────────────────────────────────────────────────────────────


async def test_свежее_отдаётся_без_повторного_запроса():
    builder, calls = _считающий({"price": "1"})

    assert await cache.cached("btc", 10, builder, now=100) == ({"price": "1"}, False)
    assert await cache.cached("btc", 10, builder, now=105) == ({"price": "1"}, False)
    assert len(calls) == 1


async def test_за_пределом_ttl_идём_к_источнику_снова():
    builder, calls = _считающий({"price": "1"})

    await cache.cached("btc", 10, builder, now=100)
    await cache.cached("btc", 10, builder, now=111)
    assert len(calls) == 2


# ── Устаревшее ───────────────────────────────────────────────────────────────


async def test_источник_упал_отдаём_последнее_известное():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 10, живой, now=100)

    мёртвый, _ = _считающий(None, ломается=True)
    value, stale = await cache.cached("btc", 10, мёртвый, now=120)

    assert value == {"price": "1"}
    assert stale is True


async def test_источник_вернул_ничего_это_тоже_отказ():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 10, живой, now=100)

    пустой, _ = _считающий(None)
    assert await cache.cached("btc", 10, пустой, now=120) == ({"price": "1"}, True)


async def test_нечего_отдавать_значит_ничего():
    """Источник упал, и в кэше пусто. Пустота честнее выдумки."""
    мёртвый, _ = _считающий(None, ломается=True)
    assert await cache.cached("btc", 10, мёртвый, now=100) == (None, False)


# ── Предел устаревания ───────────────────────────────────────────────────────


async def test_за_пределом_устаревания_не_отдаём_ничего():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 2, живой, stale_ttl=30, now=100)

    мёртвый, _ = _считающий(None, ломается=True)
    assert (await cache.cached("btc", 2, мёртвый, stale_ttl=30, now=125))[0] == {"price": "1"}
    assert await cache.cached("btc", 2, мёртвый, stale_ttl=30, now=131) == (None, False)


async def test_стакану_устаревшее_запрещено_совсем():
    """`stale_ttl=0` - стакан и лента. По старому стакану нельзя ставить заявку."""
    живой, _ = _считающий({"bids": [["1", "2"]]})
    await cache.cached("depth", 1, живой, stale_ttl=0, now=100)

    мёртвый, _ = _считающий(None, ломается=True)
    assert (await cache.cached("depth", 1, мёртвый, stale_ttl=0, now=100.5))[0] == {"bids": [["1", "2"]]}
    assert await cache.cached("depth", 1, мёртвый, stale_ttl=0, now=102) == (None, False)


async def test_предел_по_умолчанию_пятнадцать_ttl():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 4, живой, now=100)

    мёртвый, _ = _считающий(None, ломается=True)
    assert (await cache.cached("btc", 4, мёртвый, now=155))[0] == {"price": "1"}   # 55 < 60
    assert await cache.cached("btc", 4, мёртвый, now=161) == (None, False)       # 61 > 60


# ── Состояние для /api/market/status ─────────────────────────────────────────


async def test_счёт_ключей_и_отданного_устаревшего():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 10, живой, now=100)
    await cache.cached("eth", 10, живой, now=100)

    мёртвый, _ = _считающий(None, ломается=True)
    await cache.cached("btc", 10, мёртвый, now=120)

    state = cache.stats(now=120)
    assert state["keys"] == 2
    assert state["stale_served_last_hour"] == 1


async def test_отданное_устаревшее_забывается_через_час():
    живой, _ = _считающий({"price": "1"})
    await cache.cached("btc", 10, живой, now=100)
    мёртвый, _ = _считающий(None, ломается=True)
    await cache.cached("btc", 10, мёртвый, now=120)

    assert cache.stats(now=120)["stale_served_last_hour"] == 1
    assert cache.stats(now=120 + 3601)["stale_served_last_hour"] == 0
