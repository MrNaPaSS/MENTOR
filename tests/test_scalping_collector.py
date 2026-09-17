"""Тесты сборщика скальпинга: состав топа, маршрутизация событий, пересборка.

Биржа здесь подменена: поток и REST — заглушки, поэтому тесты не ходят в сеть и
проверяют именно логику сборщика.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from backend.scalping.collector import ScalpingCollector, top_symbols
from backend.scalping.collector import SNAPSHOT_LIMIT, SNAPSHOT_LIMIT_PINNED, TAPE_STREAM


class FakeStream:
    """Запоминает подписки вместо реального соединения."""

    def __init__(self) -> None:
        self.subscribed: set[str] = set()
        self.calls: list[tuple[str, frozenset[str]]] = []
        self.started = False

    def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def subscribe(self, streams: set[str]) -> None:
        self.subscribed |= streams
        self.calls.append(("sub", frozenset(streams)))

    async def unsubscribe(self, streams: set[str]) -> None:
        self.subscribed -= streams
        self.calls.append(("unsub", frozenset(streams)))


class FakeRest:
    """Отдаёт заранее заданные снимок и суточную сводку."""

    # Настоящий клиент умеет сообщать, что биржа закрыла нас на время. Здесь
    # ограничения нет — иначе тесты зависели бы от него.
    blocked = False
    blocked_for = 0.0

    def __init__(self, depth: dict | None = None, tickers: list | None = None) -> None:
        self._depth = depth
        self._tickers = tickers or []
        self.depth_calls: list[tuple[str, int]] = []

    async def depth(
        self, symbol: str, limit: int = 1000, background: bool = True
    ) -> dict | None:
        self.depth_calls.append((symbol, limit))
        return self._depth

    async def tickers_24h(self) -> list[dict]:
        return self._tickers


def make_collector(depth: dict | None = None, tickers: list | None = None) -> ScalpingCollector:
    c = ScalpingCollector(top_n=2)
    c.stream = FakeStream()          # type: ignore[assignment]
    c.rest = FakeRest(depth, tickers)  # type: ignore[assignment]
    return c


SNAPSHOT = {"lastUpdateId": 1000, "bids": [["100", "2"], ["99", "1"]], "asks": [["101", "2"]]}

# Уровни вплотную к цене: метрики стакана считаются в полосе 25 б.п. вокруг неё,
# и на «круглом» стакане выше в эту полосу не попадает ничего.
TIGHT_SNAPSHOT = {
    "lastUpdateId": 1000,
    "bids": [["99.99", "2"], ["99.98", "1"]],
    "asks": [["100.01", "2"], ["100.02", "1"]],
}

TICKERS = [
    {"symbol": "BTCUSDT", "quoteVolume": "900", "lastPrice": "100", "priceChangePercent": "1.5", "count": "7"},
    {"symbol": "ETHUSDT", "quoteVolume": "500", "lastPrice": "50", "priceChangePercent": "-2", "count": "3"},
    {"symbol": "DOGEUSDT", "quoteVolume": "10", "lastPrice": "1", "priceChangePercent": "0", "count": "1"},
]


# ── отбор инструментов ───────────────────────────────────────────────────────

def test_top_symbols_sorts_by_turnover():
    assert top_symbols(TICKERS, 2) == ["BTCUSDT", "ETHUSDT"]


def test_top_symbols_skips_other_quote_currencies():
    """Обороты в разных валютах несопоставимы — берём только пары к USDT."""
    rows = [{"symbol": "BTCUSDC", "quoteVolume": "999"}, {"symbol": "ETHUSDT", "quoteVolume": "1"}]
    assert top_symbols(rows, 5) == ["ETHUSDT"]


def test_top_symbols_survives_broken_rows():
    rows = [{"symbol": "AUSDT", "quoteVolume": "х"}, {"symbol": None}, {"symbol": "BUSDT", "quoteVolume": "5"}]
    assert top_symbols(rows, 5) == ["BUSDT"]


# ── состав наблюдения ────────────────────────────────────────────────────────

async def test_rotate_subscribes_top_and_drops_rest():
    c = make_collector(SNAPSHOT, TICKERS)
    await c._rotate(TICKERS)
    assert c.tracked == {"BTCUSDT", "ETHUSDT"}
    # Списочные инструменты идут на медленном стакане: десять обновлений в
    # секунду с каждого — это нагрузка ради колонки «плита» в списке.
    assert c.stream.subscribed == {
        "btcusdt@depth@500ms", f"btcusdt@{TAPE_STREAM}",
        "ethusdt@depth@500ms", f"ethusdt@{TAPE_STREAM}",
    }

    # Обороты изменились — DOGE вытеснил ETH.
    shifted = [dict(t) for t in TICKERS]
    shifted[1]["quoteVolume"] = "1"
    shifted[2]["quoteVolume"] = "800"
    await c._rotate(shifted)
    assert c.tracked == {"BTCUSDT", "DOGEUSDT"}
    assert f"ethusdt@{TAPE_STREAM}" not in c.stream.subscribed
    assert c.state.get("ETHUSDT") is None


async def test_open_dom_switches_symbol_to_fast_depth():
    """Открытый стакан переводится на быстрый поток, закрытый — обратно.

    В списке хватает двух обновлений в секунду, но в самом стакане на скальпе
    видно, как снимают заявку, — там нужны все десять.
    """
    c = make_collector(SNAPSHOT, TICKERS)
    await c._rotate(TICKERS)
    assert "btcusdt@depth@500ms" in c.stream.subscribed

    await c.pin("BTCUSDT")
    assert "btcusdt@depth@100ms" in c.stream.subscribed
    assert "btcusdt@depth@500ms" not in c.stream.subscribed

    await c.unpin("BTCUSDT")
    assert "btcusdt@depth@500ms" in c.stream.subscribed
    assert "btcusdt@depth@100ms" not in c.stream.subscribed


async def test_tape_outlives_the_viewer():
    """Ушли со стакана - своя лента ещё пишется, вернулись - она цела.

    Иначе крупную свечу пришлось бы достраивать с биржи кусками: на OKX она
    набирается меньше чем наполовину, на MEXC доступны сто последних сделок.
    """
    c = make_collector(SNAPSHOT, TICKERS)
    await c.pin("BTCUSDT")
    history = c.state.get("BTCUSDT").clusters
    assert history is not None

    await c.unpin("BTCUSDT")
    assert c.state.get("BTCUSDT").clusters is history
    assert c._linger.waiting("BTCUSDT")

    await c.pin("BTCUSDT")
    assert c.state.get("BTCUSDT").clusters is history
    assert not c._linger.waiting("BTCUSDT")


async def test_tape_is_dropped_when_the_term_runs_out():
    """Срок вышел - история уходит: она самая объёмная структура на монету."""
    c = make_collector(SNAPSHOT, TICKERS)
    await c.pin("BTCUSDT")
    await c.unpin("BTCUSDT")
    await c._linger.clear()

    state = c.state.get("BTCUSDT")
    assert state.clusters is None and state.candles is None


async def test_untrack_drops_both_depth_rates():
    """Снятие с наблюдения убирает поток любой скорости.

    Какая скорость подписана сейчас, знать неоткуда: инструмент мог быть открыт
    в стакане. Оставленный поток продолжал бы идти в никуда.
    """
    c = make_collector(SNAPSHOT, TICKERS)
    await c._rotate(TICKERS)
    await c.pin("BTCUSDT")
    await c._untrack("BTCUSDT")
    assert not [s for s in c.stream.subscribed if s.startswith("btcusdt")]


async def test_rotate_keeps_pinned_symbol_outside_top():
    """Инструмент, открытый в стакане, не выбрасываем из наблюдения."""
    c = make_collector(SNAPSHOT, TICKERS)
    await c._rotate(TICKERS)
    await c.pin("DOGEUSDT")
    assert "DOGEUSDT" in c.tracked

    await c._rotate(TICKERS)   # DOGE по обороту в топ-2 не проходит
    assert "DOGEUSDT" in c.tracked


async def test_unpin_releases_symbol_only_after_last_client():
    c = make_collector(SNAPSHOT, TICKERS)
    await c.pin("BTCUSDT")
    await c.pin("BTCUSDT")
    await c.unpin("BTCUSDT")
    assert "BTCUSDT" in c._pinned
    await c.unpin("BTCUSDT")
    assert "BTCUSDT" not in c._pinned


async def test_pinned_symbol_gets_deeper_snapshot():
    """Открытому стакану нужна глубина больше, чем строке скринера."""
    c = make_collector(SNAPSHOT, TICKERS)
    await c.pin("BTCUSDT")
    assert c.rest.depth_calls[-1] == ("BTCUSDT", 1000)

    # Фоновой монете хватает мелкого снимка: его вес впятеро ниже, а на
    # пересборке после обрыва потока это решает, уложимся ли мы в бюджет биржи.
    c2 = make_collector(SNAPSHOT, TICKERS)
    await c2._track("ETHUSDT")
    assert c2.rest.depth_calls[-1] == ("ETHUSDT", SNAPSHOT_LIMIT)
    assert SNAPSHOT_LIMIT < SNAPSHOT_LIMIT_PINNED


# ── суточная сводка ──────────────────────────────────────────────────────────

async def test_tickers_fill_only_tracked_symbols():
    c = make_collector(SNAPSHOT, TICKERS)
    await c._rotate(TICKERS)
    c._apply_tickers(TICKERS)

    btc = c.state.get("BTCUSDT")
    assert btc.quote_volume == 900.0 and btc.change_pct == 1.5 and btc.trade_count == 7
    assert c.state.get("DOGEUSDT") is None


# ── маршрутизация событий потока ─────────────────────────────────────────────

async def test_trade_event_feeds_tape():
    c = make_collector(SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    # m=false — по рынку бил покупатель.
    c._on_message("btcusdt@trade", {"s": "BTCUSDT", "T": 5_000, "p": "100", "q": "3", "m": False})
    m = c.state.get("BTCUSDT").tape.metrics(now_second=5)
    assert m.delta_notional == 300.0 and m.buy_ratio == 1.0


async def test_trade_maker_flag_means_seller_aggression():
    c = make_collector(SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    c._on_message("btcusdt@trade", {"s": "BTCUSDT", "T": 5_000, "p": "100", "q": "3", "m": True})
    assert c.state.get("BTCUSDT").tape.metrics(now_second=5).delta_notional == -300.0


async def test_depth_event_updates_book_and_ratio():
    c = make_collector(TIGHT_SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    before = c.state.get("BTCUSDT").book_ratio
    c._on_message("btcusdt@depth@100ms",
                  {"s": "BTCUSDT", "U": 998, "u": 1005, "b": [["99.99", "50"]], "a": []})
    state = c.state.get("BTCUSDT")
    assert state.book.bids[99.99] == 50.0
    assert state.book_ratio > before   # биды потяжелели — перевес поехал вверх


async def test_far_levels_do_not_move_book_ratio():
    """Перевес считается в полосе вокруг цены: то, что стоит далеко, его не двигает."""
    c = make_collector(SNAPSHOT, TICKERS)   # уровни разнесены на 100 б.п.
    await c._track("BTCUSDT")
    c._on_message("btcusdt@depth@100ms",
                  {"s": "BTCUSDT", "U": 998, "u": 1005, "b": [["100", "900"]], "a": []})
    assert c.state.get("BTCUSDT").book_ratio == 0.5


async def test_unknown_symbol_is_ignored():
    c = make_collector(SNAPSHOT, TICKERS)
    c._on_message("xxxusdt@trade", {"s": "XXXUSDT", "T": 1, "p": "1", "q": "1", "m": False})
    assert c.state.get("XXXUSDT") is None


async def test_desync_triggers_resync_and_buffers_events():
    """При разрыве цепочки книга пересобирается, а события не теряются."""
    c = make_collector(SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    calls_before = len(c.rest.depth_calls)

    # Событие с разрывом: pu не совпадает с последним применённым u.
    c._on_message("btcusdt@depth@100ms",
                  {"s": "BTCUSDT", "pu": 1, "U": 5000, "u": 5001, "b": [], "a": []})
    assert "BTCUSDT" in c._resyncing          # помечен сразу, синхронно

    # Пока идёт пересборка, события копятся, а не применяются вслепую.
    c._on_message("btcusdt@depth@100ms",
                  {"s": "BTCUSDT", "pu": 5001, "U": 5002, "u": 5003, "b": [], "a": []})
    assert c._buffers["BTCUSDT"]

    await asyncio.sleep(0)                    # даём отработать задаче пересборки
    await asyncio.sleep(0)
    assert len(c.rest.depth_calls) > calls_before
    assert "BTCUSDT" not in c._resyncing


async def test_missing_snapshot_leaves_book_unready():
    """Если снимок не пришёл, книгу не показываем — лучше пусто, чем неверно."""
    c = make_collector(depth=None, tickers=TICKERS)
    await c._track("BTCUSDT")
    assert c.state.get("BTCUSDT").book.ready is False


async def test_stop_is_safe_without_start():
    c = make_collector(SNAPSHOT, TICKERS)
    await c.stop()


# ── бережность к бирже ───────────────────────────────────────────────────────

async def test_failed_snapshot_puts_the_symbol_on_pause():
    """Без паузы каждое событие потока запускает новый запрос.

    На полусотне монет это сотни запросов в секунду: биржа банит адрес, а бан
    продлевается каждой новой попыткой. Так мы и получили 418.
    """
    c = make_collector(None, TICKERS)          # снимок не отдаётся
    await c._resync("BTCUSDT")
    assert "BTCUSDT" in c._cooldown

    # Пока пауза не вышла, новая пересборка не планируется.
    before = len(asyncio.all_tasks())
    c._schedule_resync("BTCUSDT")
    assert len(asyncio.all_tasks()) == before


async def test_successful_snapshot_lifts_the_pause():
    c = make_collector(SNAPSHOT, TICKERS)
    c._cooldown["BTCUSDT"] = time.monotonic() + 999
    await c._resync("BTCUSDT")
    assert "BTCUSDT" not in c._cooldown


def test_rest_stops_calling_the_exchange_while_banned():
    """418 — это бан адреса. Ходить туда во время бана значит продлевать его."""
    from backend.scalping.binance import BAN_BACKOFF_MIN, BinanceRest

    rest = BinanceRest(lambda: None)           # type: ignore[arg-type]
    assert rest.blocked is False
    rest._block(BAN_BACKOFF_MIN)
    assert rest.blocked is True
    assert rest.blocked_for > 0


def test_weight_budget_stops_us_before_the_exchange_does():
    """Реагировать на 429 поздно: следом приходит 418 — бан адреса.

    Поэтому лимит держим сами: половина минутного бюджета биржи.
    """
    from backend.scalping.binance import WEIGHT_BUDGET, WEIGHTS, BinanceRest

    rest = BinanceRest(lambda: None)           # type: ignore[arg-type]
    depth_weight = WEIGHTS["/fapi/v1/depth"]
    allowed = WEIGHT_BUDGET // depth_weight

    async def spend():
        taken = 0
        for _ in range(allowed + 5):
            if await rest._reserve("/fapi/v1/depth"):
                taken += 1
        return taken

    assert asyncio.run(spend()) == allowed


def test_spent_weight_forgets_the_previous_minute():
    from backend.scalping.binance import BinanceRest, WEIGHT_WINDOW

    rest = BinanceRest(lambda: None)           # type: ignore[arg-type]
    now = time.monotonic()
    rest._spent.append((now - WEIGHT_WINDOW - 1, 1000))
    assert rest._spent_weight(now) == 0


def test_background_requests_leave_room_for_the_trader():
    """Снимки стаканов не выбирают весь бюджет: свечи трейдера должны пройти.

    После запуска сервер берёт снимки по всем монетам скринера разом, и график
    у трейдера отвечал 502 - его свечи стояли в той же очереди.
    """
    import asyncio

    from backend.scalping.binance import INTERACTIVE_RESERVE, WEIGHT_BUDGET, BinanceRest

    rest = BinanceRest(lambda: None)           # type: ignore[arg-type]

    async def run():
        while await rest._reserve("/fapi/v1/depth", 10, background=True):
            pass
        return await rest._reserve("/fapi/v1/klines")

    assert asyncio.run(run()) is True
    assert rest._spent_weight(time.monotonic()) <= WEIGHT_BUDGET - INTERACTIVE_RESERVE + 2


def test_a_deeper_snapshot_weighs_more():
    """Снимок на тысячу уровней стоит у биржи вдвое дороже, чем на пятьсот."""
    from backend.scalping.binance import depth_weight

    assert depth_weight(100) == 5
    assert depth_weight(500) == 10
    assert depth_weight(1000) == 20


# ── бюджет и повторы снимков после обрыва потока ─────────────────────────────

async def test_failed_snapshots_are_retried_spread_out():
    """Обрыв потока ломает все книги разом - повторять их разом нельзя.

    С ровной паузой полсотни монет повторяли снимки в одну секунду и снова
    выбирали бюджет до дна: стакан стоял пустым минутами.
    """
    from backend.scalping.collector import RESYNC_COOLDOWN

    c = make_collector(None, TICKERS)
    symbols = [f"C{i}USDT" for i in range(12)]
    now = time.monotonic()
    for sym in symbols:
        await c._resync(sym)
    pauses = [c._cooldown[s] - now for s in symbols]
    assert all(RESYNC_COOLDOWN - 1 <= p <= 2 * RESYNC_COOLDOWN + 1 for p in pauses)
    assert len({round(p, 3) for p in pauses}) > 1


async def test_failed_snapshot_waits_for_the_budget():
    """Бюджет освободится через минуту - и повторять раньше незачем."""
    c = make_collector(None, TICKERS)
    c.rest.budget_free_in = lambda weight=10, background=True: 55.0  # type: ignore[attr-defined]
    now = time.monotonic()
    await c._resync("BTCUSDT")
    assert c._cooldown["BTCUSDT"] - now >= 54


def test_budget_free_in_is_zero_when_there_is_room():
    from backend.scalping.binance import BinanceRest

    rest = BinanceRest(lambda: None)  # type: ignore[arg-type]
    assert rest.budget_free_in(10, background=True) == 0.0


def test_budget_free_in_names_the_wait_when_exhausted():
    from backend.scalping.binance import (
        INTERACTIVE_RESERVE,
        WEIGHT_BUDGET,
        WEIGHT_WINDOW,
        BinanceRest,
    )

    rest = BinanceRest(lambda: None)  # type: ignore[arg-type]
    now = time.monotonic()
    rest._spent.append((now - 10, WEIGHT_BUDGET - INTERACTIVE_RESERVE))
    wait = rest.budget_free_in(10, background=True)
    assert 0 < wait <= WEIGHT_WINDOW
    assert wait == pytest.approx(WEIGHT_WINDOW - 10, abs=1)


def test_background_refusals_are_reported_once_a_minute(caplog):
    """Отказ бюджета больше не прячется в отладку - но и не шумит на каждый запрос."""
    import logging

    from backend.scalping.binance import INTERACTIVE_RESERVE, WEIGHT_BUDGET, BinanceRest

    rest = BinanceRest(lambda: None)  # type: ignore[arg-type]
    rest._spent.append((time.monotonic(), WEIGHT_BUDGET - INTERACTIVE_RESERVE))

    async def refuse_many():
        for _ in range(30):
            assert await rest._reserve("/fapi/v1/depth", 10, background=True) is False

    caplog.set_level(logging.WARNING)
    asyncio.run(refuse_many())
    lines = [r for r in caplog.records if "Бюджет запросов Binance исчерпан" in r.getMessage()]
    assert len(lines) == 1


async def test_a_squeezed_message_counts_every_trade_in_it():
    """Сжатая лента везёт пачку сделок: номера первой и последней стоят рядом.

    Без них «сделок в минуту» в скринере упало бы в разы на ровном месте, а по
    этой колонке ученик и выбирает, куда смотреть.
    """
    c = make_collector(SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    c._on_message(
        "btcusdt@aggTrade",
        {"s": "BTCUSDT", "T": 5_000, "p": "100", "q": "3", "m": False, "f": 10, "l": 16},
    )

    m = c.state.get("BTCUSDT").tape.metrics(now_second=5, recent=60)
    assert m.delta_notional == 300.0
    # Семь сделок за минуту, а не одна.
    assert m.trades_per_min == 7.0


async def test_an_old_style_message_is_still_one_trade():
    """Обычная лента без номеров считается по-прежнему: одно сообщение - сделка."""
    c = make_collector(SNAPSHOT, TICKERS)
    await c._track("BTCUSDT")
    c._on_message("btcusdt@aggTrade", {"s": "BTCUSDT", "T": 5_000, "p": "100", "q": "3", "m": False})

    assert c.state.get("BTCUSDT").tape.metrics(now_second=5, recent=60).trades_per_min == 1.0


def test_the_weight_budget_is_split_between_processes():
    """Вес биржа считает по адресу: два процесса не могут брать по полному пределу.

    Живой стол 17 сентября, сразу после выноса рыночных данных в свой процесс:
    «потрачено 1690 из 1400 за минуту, фоновых отказов 21» - сборщик и сайт
    считали каждый свои 1800, а биржа даёт 2400 на адрес.
    """
    from backend.scalping.binance import (
        INTERACTIVE_RESERVE,
        WEIGHT_BUDGET,
        weight_budget,
    )

    # Один процесс - всё как было.
    assert weight_budget("all", "") == (WEIGHT_BUDGET, INTERACTIVE_RESERVE)
    assert weight_budget("api", "") == (WEIGHT_BUDGET, INTERACTIVE_RESERVE)

    market, market_reserve = weight_budget("market", "1")
    site, site_reserve = weight_budget("api", "1")

    # Сборщику большая часть, сайту остаток, и вместе не больше прежнего.
    assert market > site > 0
    assert market + site <= WEIGHT_BUDGET
    # Резерв трейдеру - той же долей, иначе фоновым не осталось бы ничего.
    assert 0 < site_reserve < site
    assert 0 < market_reserve < market


def test_a_small_budget_still_leaves_room_for_background():
    """У процесса с малой долей фоновые запросы не оказываются вне закона."""
    import asyncio

    from backend.scalping.binance import BinanceRest, weight_budget

    async def session():
        return None

    rest = BinanceRest(session)
    rest.budget, rest.reserve = weight_budget("api", "1")

    async def take() -> bool:
        return await rest._reserve("/fapi/v1/klines", 2, background=True)

    assert asyncio.run(take()) is True


async def test_the_daily_summary_is_asked_on_its_own_schedule():
    """Сводка спрашивается по своему сроку, а не на каждом шаге цикла.

    Это самый дорогой из постоянных запросов: сорок единиц веса за ответ по
    всем монетам разом. Каждые десять секунд выходило 240 веса в минуту из
    1400, и на живом столе 17 сентября бюджет упирался именно в него.
    """
    import asyncio

    from backend.scalping.collector import TICKER_INTERVAL

    # Полминуты - это шесть прежних кругов по десять секунд.
    assert TICKER_INTERVAL >= 30.0

    c = make_collector(SNAPSHOT, TICKERS)
    asked = 0

    async def tickers():
        nonlocal asked
        asked += 1
        return TICKERS

    c.rest.tickers_24h = tickers  # type: ignore[assignment]
    c.ticker_interval = 30.0

    task = asyncio.create_task(c._loop())
    # Даём циклу несколько шагов: он тикает часто, а сводку спрашивает редко.
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    # Один запрос на старте - и всё: срок следующего ещё не вышел.
    assert asked == 1


async def test_books_are_pruned_on_their_own_schedule():
    """Чистка книг не растягивается вместе со сводкой: запросов она не стоит."""
    from backend.scalping.collector import LOOP_STEP, PRUNE_INTERVAL, TICKER_INTERVAL

    # Шаг цикла короче срока чистки - иначе чистка шла бы вдвое реже
    # собственного срока.
    assert LOOP_STEP < PRUNE_INTERVAL
    assert LOOP_STEP < TICKER_INTERVAL
