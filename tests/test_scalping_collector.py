"""Тесты сборщика скальпинга: состав топа, маршрутизация событий, пересборка.

Биржа здесь подменена: поток и REST — заглушки, поэтому тесты не ходят в сеть и
проверяют именно логику сборщика.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from backend.scalping.collector import ScalpingCollector, top_symbols


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

    async def depth(self, symbol: str, limit: int = 1000) -> dict | None:
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
        "btcusdt@depth@500ms", "btcusdt@trade",
        "ethusdt@depth@500ms", "ethusdt@trade",
    }

    # Обороты изменились — DOGE вытеснил ETH.
    shifted = [dict(t) for t in TICKERS]
    shifted[1]["quoteVolume"] = "1"
    shifted[2]["quoteVolume"] = "800"
    await c._rotate(shifted)
    assert c.tracked == {"BTCUSDT", "DOGEUSDT"}
    assert "ethusdt@trade" not in c.stream.subscribed
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

    c2 = make_collector(SNAPSHOT, TICKERS)
    await c2._track("ETHUSDT")
    assert c2.rest.depth_calls[-1] == ("ETHUSDT", 500)


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
