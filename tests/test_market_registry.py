"""Реестр источников: цепочка до первой удачи и счёт здоровья (ТЗ этап 1, §4.3).

`with_fallback` идёт по списку до первой удачи и возвращает имя сработавшего -
оно уходит в ответ API, чтобы на экране было видно происхождение цифры.
`tracked` мерит время, считает удачи и отказы и помнит последнюю ошибку.
"""

from __future__ import annotations

import pytest

from backend.sources import registry


@pytest.fixture(autouse=True)
def чистый_реестр():
    registry.reset()
    yield
    registry.reset()


def _отдаёт(value):
    async def builder():
        return value
    return builder


def _падает(message="источник упал"):
    async def builder():
        raise RuntimeError(message)
    return builder


def _пустой():
    async def builder():
        return None
    return builder


def _by_name(name: str):
    return next(s for s in registry.stats() if s.name == name)


# ── Цепочка ──────────────────────────────────────────────────────────────────


async def test_первый_живой_обрывает_цепочку():
    value, source = await registry.with_fallback([
        ("weex", _отдаёт({"price": "1"})),
        ("binance", _отдаёт({"price": "2"})),
    ])
    assert value == {"price": "1"}
    assert source == "weex"
    # До второго источника дело не дошло - его в реестре ещё нет.
    assert [s.name for s in registry.stats()] == ["weex"]


async def test_упавший_первый_уступает_второму():
    value, source = await registry.with_fallback([
        ("weex", _падает()),
        ("binance", _отдаёт({"price": "2"})),
    ])
    assert value == {"price": "2"}
    assert source == "binance"


async def test_пустой_ответ_это_отказ_а_не_данные():
    value, source = await registry.with_fallback([
        ("weex", _пустой()),
        ("binance", _отдаёт({"price": "2"})),
    ])
    assert source == "binance"
    assert _by_name("weex").failed == 1


async def test_все_упали_значит_данных_нет():
    value, source = await registry.with_fallback([
        ("weex", _падает()),
        ("binance", _падает()),
    ])
    assert value is None
    assert source is None


# ── Счёт здоровья ────────────────────────────────────────────────────────────


async def test_удачи_отказы_и_последняя_ошибка():
    await registry.tracked("weex", _отдаёт({"price": "1"}))
    await registry.tracked("weex", _отдаёт({"price": "1"}))
    with pytest.raises(registry.SourceFailed):
        await registry.tracked("weex", _падает("HTTP 502"))

    s = _by_name("weex")
    assert (s.ok, s.failed) == (2, 1)
    assert "HTTP 502" in s.last_error
    assert s.last_success is not None


async def test_скользящая_задержка_как_у_образца(monkeypatch):
    """avg = avg * 0.8 + ms * 0.2, первое измерение задаёт начало."""
    времена = iter([0.0, 0.100, 1.0, 1.200])  # 100 мс, затем 200 мс
    monkeypatch.setattr(registry, "_monotonic", lambda: next(времена))

    await registry.tracked("weex", _отдаёт({"price": "1"}))
    assert _by_name("weex").avg_latency_ms == pytest.approx(100, abs=0.5)

    await registry.tracked("weex", _отдаёт({"price": "1"}))
    s = _by_name("weex")
    assert s.last_latency_ms == pytest.approx(200, abs=0.5)
    assert s.avg_latency_ms == pytest.approx(120, abs=0.5)  # 100*0.8 + 200*0.2


# ── Самоблокировка источника ─────────────────────────────────────────────────


async def test_заблокированный_источник_пропускается():
    """Клиент Binance сам блокируется по весу запросов - долбить его нельзя."""
    registry.mark_blocked("binance", seconds=60, now=1000)

    вызовы: list[str] = []

    async def binance():
        вызовы.append("binance")
        return {"price": "2"}

    value, source = await registry.with_fallback([
        ("weex", _падает()),
        ("binance", binance),
    ], now=1030)

    assert (value, source) == (None, None)
    assert вызовы == []
    assert _by_name("binance").blocked_until == 1060


async def test_после_срока_блокировки_источник_снова_в_строю():
    registry.mark_blocked("binance", seconds=60, now=1000)

    value, source = await registry.with_fallback([
        ("binance", _отдаёт({"price": "2"})),
    ], now=1061)

    assert source == "binance"
    assert _by_name("binance").blocked_until is None
