"""Ведение позиции: перенос стопа и закрытие сделки.

Наблюдатель работает, когда трейдер закрыл вкладку и проверить его некому.
Поэтому все правила вынесены в чистую функцию и проверяются здесь, а не на
живом счёте.
"""

from __future__ import annotations

import json

from backend.trading.watcher import (
    MISSING_TOLERANCE,
    decide,
    position_size,
    takes_filled,
)
from core.models import LiveTrade


def trade(**over) -> LiveTrade:
    takes = over.pop(
        "tp_orders",
        [
            {"price": 101.0, "order_id": "tp1", "filled": False},
            {"price": 102.0, "order_id": "tp2", "filled": False},
            {"price": 103.0, "order_id": "tp3", "filled": False},
        ],
    )
    row = LiveTrade(
        student_id=1,
        client_id="c1",
        symbol="BTCUSDT",
        side="long",
        entry=100.0,
        initial_stop=99.0,
        current_stop=99.0,
        targets_json=json.dumps([t["price"] for t in takes]),
        tp_orders_json=json.dumps(takes),
        qty=3.0,
        leverage=10,
        margin=30.0,
        takes_hit=0,
        status="open",
    )
    for key, value in over.items():
        setattr(row, key, value)
    return row


def position(size: str = "3", mark: str = "101.5") -> dict:
    return {"symbol": "BTCUSDT", "total": size, "markPrice": mark}


ALL_PLANS = {"tp1", "tp2", "tp3"}


# ── чтение ответов биржи ─────────────────────────────────────────────────────

def test_position_size_reads_any_of_the_field_names():
    assert position_size({"total": "2.5"}) == 2.5
    assert position_size({"size": "-2"}) == 2.0          # шорт приходит с минусом
    assert position_size({"positionAmt": "1"}) == 1.0
    assert position_size(None) == 0.0
    assert position_size({"total": "мусор"}) == 0.0


def test_filled_takes_are_counted_by_the_remaining_size():
    """Цели — условные заявки, и обычная ручка состояния про них не знает.

    Она отвечала «ордер не найден», исполнение целей не замечалось вовсе, и
    стоп так и не переезжал в безубыток. Считаем по остатку позиции.
    """
    # Доли 30 / 50 / 20 процентов: после первой цели в позиции 70%, после
    # второй 20%, после третьей ничего.
    assert takes_filled(10.0, 10.0, 3) == 0
    assert takes_filled(10.0, 7.0, 3) == 1
    assert takes_filled(10.0, 2.0, 3) == 2
    assert takes_filled(10.0, 0.0, 3) == 3
    # Биржа режет объём по шагу лота — точного равенства долей не бывает.
    assert takes_filled(10.0, 7.1, 3) == 1
    assert takes_filled(0.0, 0.0, 3) == 0


# ── вход ─────────────────────────────────────────────────────────────────────

def test_waiting_trade_opens_when_position_appears():
    row = trade(status="waiting")
    assert decide(row, position(), ALL_PLANS, 101.5, 0).opened is True
    assert decide(row, None, set(), None, 0).opened is False


# ── цели и стоп ──────────────────────────────────────────────────────────────

def test_first_take_moves_stop_to_breakeven():
    row = trade()
    # Тридцать процентов закрылось, первая заявка ушла со списка висящих.
    decision = decide(row, position("2.1"), {"tp2", "tp3"}, 101.5, 0)
    assert decision.takes_hit == 1
    assert decision.filled_orders == ["tp1"]
    # Безубыток выше входа: комиссия платится на обеих ногах.
    assert decision.move_stop_to is not None and decision.move_stop_to > 100.0


def test_second_take_hides_stop_behind_the_first_target():
    row = trade(takes_hit=1, current_stop=100.08)
    # Осталось 20% объёма — сработали две цели.
    decision = decide(row, position("0.6"), {"tp3"}, 102.5, 0)
    assert decision.takes_hit == 2
    assert decision.move_stop_to == 101.0


def test_nothing_happens_while_the_position_is_whole():
    row = trade()
    decision = decide(row, position("3"), ALL_PLANS, 101.5, 0)
    assert decision.takes_hit == 0
    assert decision.move_stop_to is None
    assert decision.filled_orders == []


def test_stop_is_not_moved_backwards():
    """Стоп уже за первой целью — переносить его обратно в безубыток нельзя."""
    row = trade(takes_hit=1, current_stop=101.5)
    decision = decide(row, position("0.6"), {"tp3"}, 102.5, 0)
    assert decision.takes_hit == 2
    assert decision.move_stop_to is None


def test_lost_connection_does_not_look_like_filled_takes():
    """Пустой список заявок при сбое связи — не повод считать цели взятыми."""
    row = trade()
    decision = decide(row, position("3"), set(), 101.5, 0)
    assert decision.takes_hit == 0 and decision.filled_orders == []


# ── закрытие ─────────────────────────────────────────────────────────────────

def test_missing_position_closes_the_trade_only_after_a_pause():
    """Одна пустая выдача сразу после ордера — это ещё не закрытие."""
    row = trade()
    assert decide(row, None, ALL_PLANS, None, 1).closed is False
    assert decide(row, None, ALL_PLANS, None, MISSING_TOLERANCE).closed is True


def test_waiting_trade_is_not_closed_by_an_empty_book():
    row = trade(status="waiting")
    assert decide(row, None, set(), None, 5).closed is False
