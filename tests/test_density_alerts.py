"""Оповещения о плотности: выдержка, пробой и снятие заявки."""

from __future__ import annotations

from backend.scalping.density_alerts import (
    HOLD_SECONDS,
    QUIET_SECONDS,
    DensityWatcher,
)
from backend.scalping.state import MarketState


# Уровни разносим на шаг склейки: иначе соседние сливаются в одну корзину
# и объём плиты в сообщении оказывается больше заданного
STEP = 25


def _state(bid_wall: float = 0.0, ask_wall: float = 0.0) -> MarketState:
    """Стакан с ровным фоном и, если попросят, крупной заявкой."""
    market = MarketState()
    symbol = market.ensure("BTCUSDT")

    # Фон: по одному биткойну на уровень, это около 80 тысяч долларов
    bids = [[str(80_000 - STEP * i), "1"] for i in range(1, 12)]
    asks = [[str(80_000 + STEP * i), "1"] for i in range(1, 12)]

    if bid_wall:
        price = 80_000 - STEP * 5
        bids[4] = [str(price), str(bid_wall / price)]
    if ask_wall:
        price = 80_000 + STEP * 5
        asks[4] = [str(price), str(ask_wall / price)]

    symbol.book.apply_snapshot(bids, asks, 1)
    symbol.book.synced = True
    return market


def test_молчит_пока_плита_не_выстояла():
    watcher = DensityWatcher(state=_state(ask_wall=6_000_000), min_notional=5_000_000)

    assert watcher.poll(now=0) == []
    assert watcher.poll(now=HOLD_SECONDS - 1) == []


def test_сообщает_о_выстоявшей_плите():
    watcher = DensityWatcher(state=_state(ask_wall=6_000_000), min_notional=5_000_000)
    watcher.poll(now=0)

    messages = watcher.poll(now=HOLD_SECONDS + 1)

    assert len(messages) == 1
    assert "плита на продажу" in messages[0]
    assert "6,0 млн" in messages[0]


def test_не_повторяется():
    watcher = DensityWatcher(state=_state(ask_wall=6_000_000), min_notional=5_000_000)
    watcher.poll(now=0)
    watcher.poll(now=HOLD_SECONDS + 1)

    assert watcher.poll(now=HOLD_SECONDS + 10) == []


def test_мелкая_заявка_не_плита():
    watcher = DensityWatcher(state=_state(ask_wall=1_000_000), min_notional=5_000_000)
    watcher.poll(now=0)

    assert watcher.poll(now=HOLD_SECONDS + 1) == []


def test_снятую_заявку_отличаем_от_пробитой():
    watcher = DensityWatcher(state=_state(ask_wall=6_000_000), min_notional=5_000_000)
    watcher.poll(now=0)
    watcher.poll(now=HOLD_SECONDS + 1)

    # Заявка исчезла, а цена до неё так и не дошла
    watcher.state = _state()
    messages = watcher.poll(now=HOLD_SECONDS + 2000)

    assert len(messages) == 1
    assert "сняли" in messages[0]


def test_за_обход_уходит_одна_плита():
    """Стакан отдаёт по семь полок на сторону - в форум идёт крупнейшая."""
    market = MarketState()
    symbol = market.ensure("BTCUSDT")

    # Пять крупных заявок на продажу разом
    bids = [[str(80_000 - STEP * i), "1"] for i in range(1, 12)]
    asks = [[str(80_000 + STEP * i), "1"] for i in range(1, 12)]
    for i in range(5):
        price = 80_000 + STEP * (i + 1)
        asks[i] = [str(price), str((6_000_000 + i * 1_000_000) / price)]
    symbol.book.apply_snapshot(bids, asks, 1)
    symbol.book.synced = True

    watcher = DensityWatcher(state=market, min_notional=5_000_000)
    watcher.poll(now=0)
    messages = watcher.poll(now=HOLD_SECONDS + 1)

    assert len(messages) == 1
    # Самая крупная из пяти - десять миллионов
    assert "10,0 млн" in messages[0]


def test_держит_паузу_между_сообщениями():
    watcher = DensityWatcher(state=_state(ask_wall=6_000_000), min_notional=5_000_000)
    watcher.poll(now=0)
    assert watcher.poll(now=HOLD_SECONDS + 1)

    # Появилась вторая плита, но пауза ещё не вышла
    watcher.state = _state(ask_wall=6_000_000, bid_wall=7_000_000)
    watcher.poll(now=HOLD_SECONDS + 2)
    assert watcher.poll(now=HOLD_SECONDS + 100) == []

    assert watcher.poll(now=HOLD_SECONDS + QUIET_SECONDS + 10)
