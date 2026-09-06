"""Ведение позиции: перенос стопа и закрытие сделки.

Наблюдатель работает, когда трейдер закрыл вкладку и проверить его некому.
Поэтому все правила вынесены в чистую функцию и проверяются здесь, а не на
живом счёте.
"""

from __future__ import annotations

import json

import pytest

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


def test_exchange_breakeven_wins_over_our_formula():
    """Биржа знает реальную цену исполнения, комиссию и фандинг — мы нет.

    После частичного закрытия она сама сдвигает безубыток, и спорить с ней
    нашей формулой значит поставить стоп не туда.
    """
    row = trade()
    where = dict(position("2.1"))
    where["breakEvenPrice"] = "100.42"

    decision = decide(row, where, {"tp2", "tp3"}, 101.5, 0)
    assert decision.takes_hit == 1
    assert decision.move_stop_to == 100.42


def test_our_formula_covers_a_silent_exchange():
    row = trade()
    decision = decide(row, position("2.1"), {"tp2", "tp3"}, 101.5, 0)
    # Своя формула: вход плюс комиссия обеих ног.
    assert decision.move_stop_to is not None
    assert 100.0 < decision.move_stop_to < 100.2


def test_exchange_breakeven_is_still_checked_for_direction():
    """Даже биржевую цену не ставим, если она хуже текущего стопа."""
    row = trade(takes_hit=0, current_stop=100.9)
    where = dict(position("2.1"))
    where["breakEvenPrice"] = "100.42"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to is None


# ── безубыток биржи после цели ───────────────────────────────────────────────

def test_exchange_moves_breakeven_later_and_we_follow():
    """Биржа пересчитывает безубыток и после того, как цель уже взята.

    Её цифра приходит не мгновенно и потом ещё ползёт от фандинга. Раньше стоп
    ставился один раз в момент цели и оставался там навсегда — на бирже он
    оказывался не в безубытке.
    """
    row = trade(takes_hit=1, current_stop=100.08, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.35"

    decision = decide(row, where, {"tp2", "tp3"}, 101.5, 0)
    assert decision.takes_hit == 1
    assert decision.move_stop_to == 100.35


def test_a_hair_of_drift_does_not_reshuffle_the_stop():
    """Каждая перестановка — два запроса и миг без защиты. Ради копейки не стоит."""
    row = trade(takes_hit=1, current_stop=100.08, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.081"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to is None


def test_stop_follows_the_exchange_breakeven_down_too():
    """Стоп дальше биржевого нуля - это не защита, а ранний выход.

    Наша формула не знает ни цены исполнения, ни комиссии этого счёта и
    промахивалась на десятки пунктов вверх. Держаться за такую цифру только
    потому, что она «лучше», значит выбивать сделку раньше времени: на бирже
    ноль в 79841, а стоп стоял на 79876.
    """
    row = trade(takes_hit=1, current_stop=100.5, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.1"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to == 100.1


def test_breakeven_below_entry_is_refused():
    """Ноль не бывает хуже входа: туда переставлять нельзя, это уже убыток."""
    row = trade(takes_hit=1, current_stop=100.08, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "99.5"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to is None


def test_short_breakeven_above_entry_is_refused():
    row = trade(side="short", takes_hit=1, entry=100.0, current_stop=99.9, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.6"
    assert decide(row, where, {"tp2", "tp3"}, 98.5, 0).move_stop_to is None


def test_after_the_second_take_the_stop_hides_behind_the_target():
    """Дальше первой цели безубыток уже не главный: стоп прячется за целью."""
    row = trade(takes_hit=2, current_stop=101.0, qty=0.2)
    where = dict(position("0.2"))
    where["breakEvenPrice"] = "100.35"
    assert decide(row, where, {"tp3"}, 102.5, 0).move_stop_to is None


# ── запись в журнал ──────────────────────────────────────────────────────────

def test_journal_entry_keeps_the_targets_of_the_trade():
    """Журнал должен помнить не только итог, но и замысел.

    Цели не переносились вовсе: в записи оставался пустой список, и сделку
    нельзя было ни отрисовать задним числом, ни понять, какие цели сработали.
    """
    import asyncio
    from datetime import datetime, timezone

    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from backend.trading.watcher import PositionWatcher
    from core.models import Base, ScalpTrade, Student

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()

    row = trade(
        student_id=student.id,
        takes_hit=1,
        opened_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        closed_at=datetime(2026, 1, 1, 1, tzinfo=timezone.utc),
    )

    class Exchange:
        async def user_trades(self, symbol, limit=100):
            return [
                {"time": 4102444800000, "realizedPnl": "-1.2", "commission": "0.3", "price": "99.4"}
            ]

    watcher = PositionWatcher(lambda: session, lambda: None)
    asyncio.run(watcher._record(session, Exchange(), row))
    session.commit()

    saved = session.execute(select(ScalpTrade)).scalar_one()
    assert json.loads(saved.targets_json) == [101.0, 102.0, 103.0]
    assert saved.takes_hit == 1
    # Убыточная сделка со взятой целью — это стоп, а не цель: тейк был один из
    # трёх, и на счёте минус.
    assert saved.outcome == "stop"
    assert float(saved.pnl) == pytest.approx(-1.5)
