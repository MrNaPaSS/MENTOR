"""Живая свеча из ленты сделок.

График тянул историю опросом раз в пять секунд, и текущая свеча отставала от
биржи ровно на это время. Здесь проверяется, что из ленты она собирается верно:
цифры на графике трейдер сверяет с биржей, и расхождение недопустимо.
"""

from __future__ import annotations

from backend.scalping.candles import LiveCandles


def ms(seconds: int) -> int:
    return seconds * 1000


def test_candle_takes_first_price_as_open_and_last_as_close():
    live = LiveCandles()
    live.add(ms(60), 100.0, 1)
    live.add(ms(75), 105.0, 2)
    live.add(ms(90), 99.0, 3)
    live.add(ms(110), 101.0, 4)

    candle = live.current(60, ms(115))
    assert candle is not None
    assert candle.time == 60          # начало минуты, а не время первой сделки
    assert candle.open == 100.0
    assert candle.close == 101.0
    assert candle.high == 105.0
    assert candle.low == 99.0
    assert candle.volume == 10


def test_candle_covers_only_its_own_interval():
    """Сделки прошлой минуты в текущую свечу не попадают."""
    live = LiveCandles()
    live.add(ms(59), 500.0, 5)        # прошлая минута
    live.add(ms(61), 100.0, 1)

    candle = live.current(60, ms(61))
    assert candle is not None
    assert candle.open == 100.0 and candle.high == 100.0 and candle.volume == 1


def test_interval_boundaries_are_aligned_to_the_epoch():
    """Границы у биржи выровнены по эпохе — иначе свечи не совпадут с её."""
    live = LiveCandles()
    live.add(ms(1_000_000), 10.0, 1)
    assert live.current(300, ms(1_000_050)).time == 1_000_000 - 1_000_000 % 300


def test_no_trades_no_candle():
    """Пустую свечу не рисуем: это выдуманные данные."""
    assert LiveCandles().current(60, ms(120)) is None


def test_five_minute_candle_sums_its_minutes():
    live = LiveCandles()
    for i, price in enumerate((100.0, 103.0, 98.0, 101.0)):
        live.add(ms(600 + i * 60), price, 1)

    candle = live.current(300, ms(840))
    assert candle is not None
    assert candle.time == 600
    assert (candle.open, candle.high, candle.low, candle.close) == (100.0, 103.0, 98.0, 101.0)
    assert candle.volume == 4


def test_broken_trades_are_ignored():
    """Битая сделка не портит свечу и не создаёт её из ничего."""
    live = LiveCandles()
    live.add(ms(60), 0.0, 1)          # цены не бывает нулевой
    live.add(ms(60), 100.0, -5)       # отрицательный объём
    assert live.current(60, ms(65)) is None

    live.add(ms(62), 100.0, 2)
    candle = live.current(60, ms(65))
    assert candle is not None and candle.volume == 2 and candle.open == 100.0


def test_history_does_not_grow_without_limit():
    """Час секунд на инструмент — потолок, дальше старое выбрасывается."""
    live = LiveCandles(history=10)
    for second in range(200):
        live.add(ms(second), 100.0 + second, 1)
    assert len(live._seconds) <= 21
