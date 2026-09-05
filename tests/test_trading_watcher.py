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
    order_filled,
    position_size,
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


POSITION = {"symbol": "BTCUSDT", "total": "3", "markPrice": "101.5"}


# ── чтение ответов биржи ─────────────────────────────────────────────────────

def test_position_size_reads_any_of_the_field_names():
    assert position_size({"total": "2.5"}) == 2.5
    assert position_size({"size": "-2"}) == 2.0          # шорт приходит с минусом
    assert position_size({"positionAmt": "1"}) == 1.0
    assert position_size(None) == 0.0
    assert position_size({"total": "мусор"}) == 0.0


def test_filled_order_is_recognised_by_status_or_volume():
    assert order_filled({"status": "FILLED"}) is True
    assert order_filled({"state": "closed"}) is True
    assert order_filled({"executedQty": "1", "origQty": "1"}) is True
    assert order_filled({"executedQty": "0.5", "origQty": "1"}) is False
    assert order_filled({"status": "NEW"}) is False
    assert order_filled(None) is False


# ── вход ─────────────────────────────────────────────────────────────────────

def test_waiting_trade_opens_when_position_appears():
    row = trade(status="waiting")
    assert decide(row, POSITION, {}, 101.5, 0).opened is True
    assert decide(row, None, {}, None, 0).opened is False


# ── цели и стоп ──────────────────────────────────────────────────────────────

def test_first_take_moves_stop_to_breakeven():
    row = trade()
    decision = decide(row, POSITION, {"tp1": {"status": "FILLED"}}, 101.5, 0)
    assert decision.takes_hit == 1
    assert decision.filled_orders == ["tp1"]
    # Безубыток выше входа: комиссия платится на обеих ногах.
    assert decision.move_stop_to is not None and decision.move_stop_to > 100.0


def test_second_take_hides_stop_behind_the_first_target():
    row = trade(takes_hit=1, current_stop=100.08)
    decision = decide(row, POSITION, {"tp2": {"status": "FILLED"}}, 102.5, 0)
    assert decision.takes_hit == 2
    assert decision.move_stop_to == 101.0


def test_nothing_happens_while_no_take_is_filled():
    row = trade()
    decision = decide(row, POSITION, {"tp1": {"status": "NEW"}}, 101.5, 0)
    assert decision.takes_hit == 0
    assert decision.move_stop_to is None
    assert decision.filled_orders == []


def test_stop_is_not_moved_backwards():
    """Стоп уже за первой целью — переносить его обратно в безубыток нельзя."""
    row = trade(takes_hit=1, current_stop=101.5)
    decision = decide(row, POSITION, {"tp2": {"status": "FILLED"}}, 102.5, 0)
    assert decision.takes_hit == 2
    assert decision.move_stop_to is None


def test_already_filled_takes_are_not_counted_twice():
    row = trade(
        takes_hit=1,
        tp_orders=[
            {"price": 101.0, "order_id": "tp1", "filled": True},
            {"price": 102.0, "order_id": "tp2", "filled": False},
        ],
    )
    decision = decide(row, POSITION, {"tp1": {"status": "FILLED"}}, 101.5, 0)
    assert decision.takes_hit == 1
    assert decision.filled_orders == []


# ── закрытие ─────────────────────────────────────────────────────────────────

def test_missing_position_closes_the_trade_only_after_a_pause():
    """Одна пустая выдача сразу после ордера — это ещё не закрытие."""
    row = trade()
    assert decide(row, None, {}, None, 1).closed is False
    assert decide(row, None, {}, None, MISSING_TOLERANCE).closed is True


def test_waiting_trade_is_not_closed_by_an_empty_book():
    row = trade(status="waiting")
    assert decide(row, None, {}, None, 5).closed is False
