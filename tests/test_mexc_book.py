"""Стакан и лента MEXC: цепочка версий, контракты в монетах и догон коммитами.

Сети нет: поток подменён, справочник пар подставлен руками, а открытые ручки
отвечают заранее заданным. Проверяем то, без чего книга либо разойдётся с
биржей незаметно (нумерация подряд), либо покажет чужие числа (объём в
контрактах вместо монет).
"""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.scalping.mexc import MexcStreamClient, channel_of, sub_message
from backend.scalping.mexc_collector import MexcCollector, levels, span, top_symbols
from core.mexc.market import Instrument

BTC = Instrument(
    symbol="BTC_USDT",
    contract_size=0.0001,
    vol_unit=1.0,
    min_vol=1.0,
    max_vol=1000000.0,
    price_unit=0.1,
    max_leverage=200.0,
    taker=0.0002,
    maker=0.0,
    state=0,
)


class FakeStream:
    """Запоминает подписки вместо соединения с биржей."""

    def __init__(self) -> None:
        self.args: set[tuple[str, str]] = set()
        self.started = False
        self.on_reset = None

    def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def subscribe(self, args) -> None:
        self.args |= args

    async def unsubscribe(self, args) -> None:
        self.args -= args

    @property
    def connected(self) -> bool:
        return self.started


class FakeRest:
    """Открытые ручки биржи: сводка, снимок книги и коммиты."""

    def __init__(
        self,
        tickers: list[dict] | None = None,
        depth: dict | None = None,
        commits: list[dict] | None = None,
    ) -> None:
        self._tickers = tickers or []
        self._depth = depth or {}
        self._commits = commits or []
        self.depth_calls = 0
        self.commit_calls = 0

    async def tickers(self) -> list[dict]:
        return self._tickers

    async def depth(self, symbol: str, limit: int = 1000) -> dict:
        self.depth_calls += 1
        return self._depth

    async def depth_commits(self, symbol: str, limit: int = 1000) -> list[dict]:
        self.commit_calls += 1
        return self._commits


def make_collector(rest: FakeRest | None = None) -> MexcCollector:
    collector = MexcCollector()
    collector.stream = FakeStream()  # type: ignore[assignment]
    collector.rest = rest or FakeRest()  # type: ignore[assignment]
    collector._specs = {"BTC_USDT": BTC}  # справочник уже приехал

    async def specs() -> dict:
        """Справочник не спрашиваем: тест не ходит на биржу."""
        return collector._specs

    collector.specs = specs  # type: ignore[assignment]
    return collector


def opened(collector: MexcCollector, symbol: str = "BTCUSDT"):
    collector._pinned[symbol] = 1
    return collector.state.ensure(symbol)


def depth(version: int = 100) -> dict:
    """Снимок книги биржи: объём в контрактах, третье число - счёт заявок."""
    return {
        "version": version,
        "bids": [[99.9, 1000, 3], [99.8, 2000, 5]],
        "asks": [[100.1, 1000, 2], [100.2, 500, 1]],
    }


def change(version: int, bids=None, asks=None, begin: int | None = None) -> dict:
    """Изменение книги: биржа шлёт диапазон версий, а не одну.

    `begin` по умолчанию - следующая за прошлой версией, то есть сообщение
    продолжает цепочку без разрыва.
    """
    return {
        "version": version,
        "end": version,
        "begin": version if begin is None else begin,
        "bids": bids or [],
        "asks": asks or [],
    }


# ── перевод объёма ───────────────────────────────────────────────────────────


def test_levels_are_translated_from_contracts_to_coins():
    """Тысяча контрактов BTC - это 0.1 монеты. Разница в книге - в десять тысяч раз."""
    assert levels([[99.9, 1000, 3]], BTC.contract_size) == [[99.9, 0.1]]


def test_zero_level_stays_zero():
    """Ноль означает снятие уровня и обязан дойти нулём, иначе плита бессмертна."""
    assert levels([[99.9, 0, 0]], BTC.contract_size) == [[99.9, 0.0]]


# ── книга ────────────────────────────────────────────────────────────────────


async def test_snapshot_fills_the_book_in_coins():
    collector = make_collector(FakeRest(depth=depth(100)))
    opened(collector)

    await collector._snapshot("BTCUSDT")
    book = collector.state.get("BTCUSDT").book
    assert book.ready
    assert book.bids[99.9] == pytest.approx(0.1)
    assert book.asks[100.1] == pytest.approx(0.1)
    assert book.last_update_id == 100


async def test_update_continues_the_chain_by_one():
    collector = make_collector(FakeRest(depth=depth(100)))
    state = opened(collector)
    await collector._snapshot("BTCUSDT")

    collector._on_message("BTC_USDT", "depth", change(101, bids=[[99.9, 3000, 4]]))
    assert state.book.bids[99.9] == pytest.approx(0.3)
    assert state.book.last_update_id == 101


async def test_message_before_snapshot_is_held_and_applied_after():
    """Пришло раньше снимка - придерживаем: иначе книга начнётся с дыры."""
    collector = make_collector(FakeRest(depth=depth(100)))
    state = opened(collector)

    collector._on_message("BTC_USDT", "depth", change(101, bids=[[99.9, 3000, 4]]))
    assert state.book.ready is False

    await collector._snapshot("BTCUSDT")
    collector._drain("BTCUSDT")
    assert state.book.bids[99.9] == pytest.approx(0.3)
    assert state.book.last_update_id == 101


async def test_repeated_version_is_ignored():
    """Тот же номер или старее - изменение уже учтено снимком."""
    collector = make_collector(FakeRest(depth=depth(100)))
    state = opened(collector)
    await collector._snapshot("BTCUSDT")

    collector._on_message("BTC_USDT", "depth", change(100, bids=[[99.9, 7000, 1]]))
    assert state.book.bids[99.9] == pytest.approx(0.1)
    assert collector.gaps == 0


async def test_gap_is_caught_up_by_commits_without_rebuilding():
    """Разрыв догоняется коммитами: снимок дороже, а ученик ждёт стакан.

    Биржа отдаёт последнюю тысячу изменений по возрастанию версии; применяем
    их подряд от того номера, что у нас есть.
    """
    rest = FakeRest(
        depth=depth(100),
        commits=[
            change(101, bids=[[99.9, 1100, 3]]),
            change(102, bids=[[99.9, 1200, 3]]),
        ],
    )
    collector = make_collector(rest)
    state = opened(collector)
    await collector._snapshot("BTCUSDT")
    rest.depth_calls = 0

    # Сообщение начинается с 103, а у нас 100: между ними дыра.
    collector._on_message("BTC_USDT", "depth", change(103, bids=[[99.9, 1300, 3]], begin=103))
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert collector.gaps == 1
    assert rest.commit_calls == 1
    # Книгу не пересобирали - её догнали.
    assert rest.depth_calls == 0
    assert state.book.last_update_id == 103
    assert state.book.bids[99.9] == pytest.approx(0.13)


async def test_gap_wider_than_commits_rebuilds_the_book():
    """Коммитов не хватило - тогда честнее собрать книгу заново снимком."""
    rest = FakeRest(depth=depth(100), commits=[change(900), change(901)])
    collector = make_collector(rest)
    opened(collector)
    await collector._snapshot("BTCUSDT")
    rest.depth_calls = 0

    collector._on_message("BTC_USDT", "depth", change(500, bids=[[99.9, 1300, 3]], begin=500))
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert rest.commit_calls == 1
    assert rest.depth_calls == 1


async def test_zero_size_removes_level():
    collector = make_collector(FakeRest(depth=depth(100)))
    state = opened(collector)
    await collector._snapshot("BTCUSDT")

    collector._on_message("BTC_USDT", "depth", change(101, bids=[[99.8, 0, 0]]))
    assert 99.8 not in state.book.bids


async def test_broken_connection_leaves_no_stale_book():
    """Обрыв - книга несобрана, и кадр стакана до нового снимка не уходит."""
    collector = make_collector(FakeRest(depth=depth(100)))
    state = opened(collector)
    await collector._snapshot("BTCUSDT")

    collector._forget_books()
    assert state.book.ready is False


async def test_snapshot_without_version_is_refused():
    """Снимок без номера версии бесполезен: цепочку с него не начать."""
    collector = make_collector(FakeRest(depth={"bids": [], "asks": []}))
    state = opened(collector)
    await collector._snapshot("BTCUSDT")
    assert state.book.ready is False


async def test_wide_version_range_is_not_a_gap():
    """Версия шагает внутри сообщения, и это не потеря - это его диапазон.

    Живой пробник 14 сентября 2026 насчитал 289 «разрывов» за минуту и девять
    пересборок книги, пока цепочка проверялась по одной `version`: на BTC_USDT
    номер шагает через десятки и сотни. По диапазону разрывов нет.
    """
    rest = FakeRest(depth=depth(100))
    collector = make_collector(rest)
    state = opened(collector)
    await collector._snapshot("BTCUSDT")

    # Сообщение покрывает версии 101-350: начинается там, где мы стоим.
    collector._on_message(
        "BTC_USDT", "depth", change(350, bids=[[99.9, 1300, 3]], begin=101)
    )
    assert collector.gaps == 0
    assert rest.commit_calls == 0
    assert state.book.last_update_id == 350
    assert state.book.bids[99.9] == pytest.approx(0.13)


def test_span_falls_back_to_a_single_version():
    """У снимка по REST диапазона нет - только `version`, и это не дыра."""
    assert span({"begin": 101, "end": 350, "version": 350}) == (101, 350)
    assert span({"version": 100}) == (100, 100)


# ── лента ────────────────────────────────────────────────────────────────────


async def test_trade_goes_to_tape_in_coins_with_the_taker_side():
    """Сделка: объём в монетах, сторона - `T` (1 покупка, 2 продажа)."""
    collector = make_collector()
    state = opened(collector)

    collector._on_message("BTC_USDT", "deal", {"t": 1757320800000, "p": 100, "v": 500, "T": 1})
    # Пятьсот контрактов - это 0.05 монеты, то есть пять долларов покупки.
    assert state.tape.metrics(1757320800).delta_notional == pytest.approx(5.0)

    collector._on_message("BTC_USDT", "deal", {"t": 1757320800000, "p": 100, "v": 500, "T": 2})
    # Продажа той же величины гасит перевес: сторону читаем по `T`.
    assert state.tape.metrics(1757320800).delta_notional == pytest.approx(0.0)


def test_trades_arrive_as_a_list_and_each_one_counts():
    """Ленту биржа шлёт списком сделок за такт, книгу - объектом.

    Ждать только объект значило бы не увидеть ни одной сделки: поймано живым
    пробником - лента молчала, пока разбор отбрасывал списки.
    """
    got: list[tuple[str, str, dict]] = []
    client = MexcStreamClient(lambda symbol, channel, row: got.append((symbol, channel, row)))
    client._dispatch(
        json.dumps(
            {
                "channel": "push.deal",
                "symbol": "BTC_USDT",
                "data": [
                    {"p": 77696.6, "v": 17646, "T": 2, "t": 1789385667495},
                    {"p": 77696.7, "v": 9, "T": 1, "t": 1789385667652},
                ],
            }
        )
    )
    assert [one[1] for one in got] == ["deal", "deal"]
    assert got[0][2]["v"] == 17646

    # Книга по-прежнему приходит одним объектом.
    got.clear()
    client._dispatch(
        json.dumps({"channel": "push.depth", "symbol": "BTC_USDT", "data": {"version": 5}})
    )
    assert len(got) == 1


# ── подписки и сводка ────────────────────────────────────────────────────────


async def test_pin_subscribes_to_book_and_tape():
    collector = make_collector(FakeRest(depth=depth(100)))
    await collector.pin("BTCUSDT")
    assert collector.stream.args == {("BTC_USDT", "depth"), ("BTC_USDT", "deal")}

    await collector.unpin("BTCUSDT")
    assert collector.stream.args == set()
    assert collector.state.get("BTCUSDT") is None


async def test_second_viewer_does_not_double_the_subscription():
    collector = make_collector(FakeRest(depth=depth(100)))
    await collector.pin("BTCUSDT")
    await collector.pin("BTCUSDT")
    await collector.unpin("BTCUSDT")
    # Один ушёл, второй смотрит - поток остаётся.
    assert collector.stream.args == {("BTC_USDT", "depth"), ("BTC_USDT", "deal")}


async def test_supports_answers_by_the_reference_book():
    collector = make_collector()
    assert await collector.supports("BTCUSDT") is True
    assert await collector.supports("NOSUCHUSDT") is False
    assert collector.listed_symbols() == frozenset({"BTCUSDT"})


async def test_tickers_fill_price_and_turnover():
    """Суточное изменение биржа даёт долей единицы, терминал считает процентами."""
    rest = FakeRest(
        tickers=[
            {
                "symbol": "BTC_USDT",
                "lastPrice": 80000,
                "riseFallRate": 0.0125,
                "amount24": 1000000,
                "volume24": 12,
            }
        ]
    )
    collector = make_collector(rest)
    state = opened(collector)
    await collector._apply_tickers()

    assert state.last_price == pytest.approx(80000)
    assert state.change_pct == pytest.approx(1.25)
    assert state.quote_volume == pytest.approx(1000000)


def test_top_symbols_are_sorted_by_turnover_in_money():
    rows = [
        {"symbol": "BTC_USDT", "amount24": 900},
        {"symbol": "ETH_USDT", "amount24": 1000},
        {"symbol": "BTC_USDC", "amount24": 5000},   # не USDT-фьючерс
    ]
    assert top_symbols(rows, 5) == ["ETHUSDT", "BTCUSDT"]


# ── конверт потока ───────────────────────────────────────────────────────────


def test_subscription_message_matches_the_exchange():
    assert sub_message("depth", "BTC_USDT") == {
        "method": "sub.depth",
        "param": {"symbol": "BTC_USDT"},
    }
    assert sub_message("deal", "BTC_USDT", "unsub")["method"] == "unsub.deal"


def test_channel_name_is_read_from_the_push_prefix():
    assert channel_of("push.depth") == "depth"
    assert channel_of("push.deal") == "deal"
    assert channel_of("pong") == ""
