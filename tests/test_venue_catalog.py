"""Состав бирж без своего сборщика.

WEEX торгует через ключи заметно меньше пар, чем показывает в справочнике: на
19 сентября 2026 - 290 из 995. Её книгу мы не собираем, и спросить состав было
не у кого: скринер не помечал на WEEX ничего, а биржа отвечала отказом уже
после нажатия «Войти».

Главное здесь - разница между «не знаем» и «биржа ничего не торгует». Вторая
пометила бы весь скринер чужим, и это хуже прежнего молчания.
"""

import asyncio

import pytest

from backend.scalping.market_hub import MarketHub
from backend.scalping.venue_catalog import VenueCatalog


def test_unasked_venue_is_unknown_not_empty():
    """Пока не спросили - `None`. Пустое множество означало бы, что биржа не
    торгует ничем, и весь список монет стал бы чужим."""
    catalog = VenueCatalog({"weex": _gives({"BTCUSDT"})})
    assert catalog.symbols("weex") is None


def test_refresh_remembers_what_exchange_said():
    catalog = VenueCatalog({"weex": _gives({"BTCUSDT", "ETHUSDT"})})
    got = asyncio.run(catalog.refresh("weex"))
    assert got == frozenset({"BTCUSDT", "ETHUSDT"})
    assert catalog.symbols("weex") == frozenset({"BTCUSDT", "ETHUSDT"})
    # Регистр биржи и наш не обязаны совпадать, спрашиваем как придётся.
    assert catalog.symbols("WEEX") == frozenset({"BTCUSDT", "ETHUSDT"})


def test_silence_keeps_the_previous_list():
    """Биржа моргнула - держим прежний состав, а не забываем его."""
    answers = [frozenset({"BTCUSDT"}), None]

    async def source():
        return answers.pop(0)

    catalog = VenueCatalog({"weex": source})
    asyncio.run(catalog.refresh("weex"))
    asyncio.run(catalog.refresh("weex"))
    assert catalog.symbols("weex") == frozenset({"BTCUSDT"})


def test_empty_answer_does_not_wipe_the_list():
    """Пустой ответ - тоже моргнувшая биржа. Приняв его всерьёз, мы пометили бы
    чужими все монеты разом."""
    answers = [frozenset({"BTCUSDT"}), frozenset()]

    async def source():
        return answers.pop(0)

    catalog = VenueCatalog({"weex": source})
    asyncio.run(catalog.refresh("weex"))
    asyncio.run(catalog.refresh("weex"))
    assert catalog.symbols("weex") == frozenset({"BTCUSDT"})


def test_broken_source_does_not_break_the_screener():
    async def source():
        raise RuntimeError("биржа легла")

    catalog = VenueCatalog({"weex": source})
    assert asyncio.run(catalog.refresh("weex")) is None
    assert catalog.symbols("weex") is None


def test_unknown_venue_is_left_alone():
    catalog = VenueCatalog({"weex": _gives({"BTCUSDT"})})
    assert asyncio.run(catalog.refresh("okx")) is None
    assert catalog.symbols("okx") is None


class _Collector:
    """Сборщик со своим справочником - такие состав знают сами."""

    exchange = "okx"
    state = None

    def __init__(self, names):
        self._names = frozenset(names)

    def listed_symbols(self):
        return self._names


def test_hub_asks_catalog_when_there_is_no_collector():
    """У WEEX сборщика нет: состав берётся из каталога, иначе на ней не
    помечается ничего."""
    catalog = VenueCatalog({"weex": _gives({"BTCUSDT"})})
    asyncio.run(catalog.refresh("weex"))

    hub = MarketHub(_Collector({"BTCUSDT", "ETHUSDT"}), {}, catalog)
    assert hub.listed("weex") == frozenset({"BTCUSDT"})


def test_collector_is_stronger_than_catalog():
    """Своя книга знает состав точнее: она по нему и читается."""
    catalog = VenueCatalog({"okx": _gives({"BTCUSDT"})})
    asyncio.run(catalog.refresh("okx"))

    hub = MarketHub(None, {}, catalog)
    hub._collectors["okx"] = _Collector({"BTCUSDT", "ETHUSDT"})
    assert hub.listed("okx") == frozenset({"BTCUSDT", "ETHUSDT"})


def test_hub_without_catalog_says_it_does_not_know():
    hub = MarketHub(None, {})
    assert hub.listed("weex") is None


def _gives(names):
    async def source():
        return frozenset(names)

    return source
