"""Ведение позиции: перенос стопа и закрытие сделки.

Наблюдатель работает, когда трейдер закрыл вкладку и проверить его некому.
Поэтому все правила вынесены в чистую функцию и проверяются здесь, а не на
живом счёте.
"""

from __future__ import annotations

import json

import pytest

from backend.trading.watcher import (
    take_label,
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


def test_stop_follows_the_exchange_breakeven_forward():
    """Стоп идёт за биржевым нулём, пока это движение вперёд.

    Ноль биржа пересчитывает после каждого частичного закрытия, и наша формула
    за ним не поспевает: на бирже 79841, а стоп по нашему расчёту вставал на
    79876. Берём биржевое число.
    """
    row = trade(takes_hit=1, current_stop=100.02, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.3"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to == 100.3


def test_breakeven_behind_the_current_stop_is_refused():
    """Назад стоп не ходит.

    Забранная прибыль опускает ноль ниже входа - это правда, но опускать за
    ним уже поставленный стоп значит увеличивать риск задним числом.
    """
    row = trade(takes_hit=1, current_stop=100.5, qty=0.7)
    where = dict(position("0.7"))
    where["breakEvenPrice"] = "100.1"
    assert decide(row, where, {"tp2", "tp3"}, 101.5, 0).move_stop_to is None


def test_short_stop_moves_only_downwards():
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


# ── сторона позиции ──────────────────────────────────────────────────────────

def test_position_side_reads_the_name_or_the_sign():
    from backend.trading.watcher import position_side

    assert position_side({"positionSide": "LONG"}) == "long"
    assert position_side({"holdSide": "short"}) == "short"
    # В одностороннем режиме стороны в ответе может не быть - её выдаёт минус.
    assert position_side({"total": "-2"}) == "short"
    assert position_side({"total": "2"}) == "long"
    assert position_side({"total": "0"}) == ""
    assert position_side(None) == ""


def test_open_short_does_not_answer_for_a_waiting_long():
    """При открытом шорте отмена ждущего лонга уходила закрывать шорт.

    Терминал видел объём чужой стороны и слал рыночный приказ с не той
    стороной позиции; биржа отвечала «position side invalid», а лимитка так и
    оставалась висеть.
    """
    from backend.trading.watcher import position_for

    rows = [{"symbol": "BTCUSDT", "positionSide": "SHORT", "total": "0.5"}]
    assert position_for(rows, "BTCUSDT", "short") is not None
    assert position_for(rows, "BTCUSDT", "long") is None


def test_one_way_position_belongs_to_its_own_side():
    from backend.trading.watcher import position_for

    # Без поля стороны, но с минусом в объёме - это шорт, и лонгу он не свой.
    rows = [{"symbol": "BTCUSDT", "total": "-0.5"}]
    assert position_for(rows, "BTCUSDT", "short") is not None
    assert position_for(rows, "BTCUSDT", "long") is None


# ── безубыток по цифрам самой биржи ─────────────────────────────────────────

def weex_position(**over) -> dict:
    """Позиция в том виде, в каком её отдаёт WEEX: без цены и без безубытка.

    Полей `breakEvenPrice` и `markPrice` в ответе нет вовсе - есть только
    объёмы, стоимости и удержанные комиссии.
    """
    row = {
        "symbol": "BTCUSDT",
        "side": "long",
        "size": "1",
        "cumOpenSize": "1",
        "cumOpenValue": "80000",
        "cumOpenFee": "64",
        "cumCloseSize": "0",
        "cumCloseValue": "0",
        "cumCloseFee": "0",
        "cumFundingFee": "0",
    }
    row.update(over)
    return row


def test_breakeven_is_computed_from_money_in_and_out():
    """Готового поля с безубытком WEEX не отдаёт - считаем сами и точно.

    Вход на 80000 с комиссией 64 (0.08%): чтобы выйти в ноль, цена должна
    покрыть и комиссию входа, и комиссию выхода.
    """
    from backend.trading.watcher import exchange_breakeven

    price = exchange_breakeven(weex_position(), taker_fee=0.0008)
    assert price is not None
    # (80000 + 64) / (1 * (1 - 0.0008)) = 80128.1
    assert price == pytest.approx(80128.1, abs=0.5)
    assert price > 80000  # ноль всегда выше входа для лонга


def test_breakeven_of_a_short_lies_below_the_entry():
    from backend.trading.watcher import exchange_breakeven

    price = exchange_breakeven(
        weex_position(side="short", size="-1"), taker_fee=0.0008
    )
    assert price is not None and price < 80000


def test_partial_close_moves_the_breakeven():
    """Забранная цель сдвигает ноль: часть прибыли уже на счёте."""
    from backend.trading.watcher import exchange_breakeven

    whole = exchange_breakeven(weex_position(), taker_fee=0.0008)
    after = exchange_breakeven(
        weex_position(
            size="0.7",
            cumCloseSize="0.3",
            cumCloseValue="24300",   # 0.3 по 81000
            cumCloseFee="19.4",
        ),
        taker_fee=0.0008,
    )
    assert whole is not None and after is not None
    assert after < whole


def test_average_entry_comes_from_value_over_size():
    from backend.trading.watcher import average_entry

    assert average_entry(weex_position()) == pytest.approx(80000)
    assert average_entry({}) is None


# ── итог по исполнениям ──────────────────────────────────────────────────────

def test_settle_takes_the_number_the_exchange_named():
    from backend.trading.watcher import settle

    fills = [
        {"realizedPnl": "40", "commission": "3", "price": "81000", "qty": "0.5", "side": "sell"},
        {"realizedPnl": "24", "commission": "2", "price": "81200", "qty": "0.5", "side": "sell"},
    ]
    gross, fee, price = settle(fills, entry=80000.0, side="long")
    assert gross == 64.0
    assert fee == 5.0
    assert price == 81200.0


def test_settle_counts_it_itself_when_the_field_is_missing():
    """Поля с результатом в отчёте может не быть - как не было безубытка.

    Молчать нельзя: в журнал уходил ноль, и трейдер видел +2 вместо +64.
    Считаем по ценам закрывающих исполнений от цены входа.
    """
    from backend.trading.watcher import settle

    fills = [
        {"price": "81000", "size": "0.5", "side": "sell", "fee": "3"},
        {"price": "81200", "size": "0.5", "side": "sell", "fee": "2"},
    ]
    gross, fee, _ = settle(fills, entry=80000.0, side="long")
    # 0.5 * 1000 + 0.5 * 1200
    assert gross == pytest.approx(1100.0)
    assert fee == 5.0


def test_settle_ignores_the_entry_fill():
    """Открывающее исполнение результат не создаёт - оно его начало."""
    from backend.trading.watcher import settle

    fills = [
        {"price": "80000", "size": "1", "side": "buy", "fee": "6.4"},
        {"price": "80500", "size": "1", "side": "sell", "fee": "6.4"},
    ]
    gross, fee, _ = settle(fills, entry=80000.0, side="long")
    assert gross == pytest.approx(500.0)
    assert fee == pytest.approx(12.8)


def test_settle_of_a_short_counts_the_other_way():
    from backend.trading.watcher import settle

    fills = [{"price": "79000", "size": "1", "side": "buy", "fee": "6"}]
    gross, _, _ = settle(fills, entry=80000.0, side="short")
    assert gross == pytest.approx(1000.0)


def test_fill_time_reads_any_of_the_names():
    from backend.trading.watcher import fill_time

    assert fill_time({"time": 1700000000000}) == 1700000000000
    assert fill_time({"createdTime": "1700000000000"}) == 1700000000000
    assert fill_time({"unknown": 1}) == 0


# ── лестница целей на маленькой позиции ─────────────────────────────────────

def test_ladder_keeps_all_three_when_the_size_allows():
    from backend.trading.watcher import split_ladder

    plan = split_ladder(10.0, [101.0, 102.0, 103.0], step=0.001, min_qty=0.001)
    assert [p for p, _ in plan] == [101.0, 102.0, 103.0]
    assert [round(size, 6) for _, size in plan] == [3.0, 5.0, 2.0]
    assert sum(size for _, size in plan) == pytest.approx(10.0)


def test_small_position_gets_fewer_targets_but_gets_them():
    """Раньше сделка оставалась с одним стопом: доля не набирала минимума.

    Цели при этом были нарисованы на графике - трейдер видел лестницу, которой
    на бирже нет. Мелкие доли теперь копятся до первой проходящей.
    """
    from backend.trading.watcher import split_ladder

    # 0.0002 BTC при минимуме 0.0001: треть - это 0.00006, не проходит.
    plan = split_ladder(0.0002, [101.0, 102.0, 103.0], step=0.0001, min_qty=0.0001)
    assert plan, "лестница обязана быть хоть какой-то"
    assert sum(size for _, size in plan) == pytest.approx(0.0002)
    # Первая цель пропущена, объём ушёл дальше по лестнице.
    assert plan[0][0] > 101.0


def test_ladder_is_empty_only_when_even_the_whole_position_is_too_small():
    from backend.trading.watcher import split_ladder

    assert split_ladder(0.00005, [101.0, 102.0], step=0.0001, min_qty=0.0001) == []
    assert split_ladder(0.0, [101.0], step=0.001, min_qty=0.001) == []


def test_leftover_goes_to_the_last_target():
    """Остаток и по замыслу её: последняя цель забирает всё, что осталось."""
    from backend.trading.watcher import split_ladder

    plan = split_ladder(0.0007, [101.0, 102.0, 103.0], step=0.0001, min_qty=0.0001)
    assert sum(size for _, size in plan) == pytest.approx(0.0007)


# ── сколько целей взято на самом деле ───────────────────────────────────────

def test_last_take_is_counted_when_it_closes_the_position():
    """Последняя цель закрывает позицию целиком - по остатку её не сосчитать.

    Считаем по заявкам: цели, которой не стало среди висящих, исполнилась.
    Снимать их к этому моменту мы ещё не начинали, так что перепутать не с чем.
    """
    row = trade(
        takes_hit=2,
        qty=0.6,
        tp_orders=[
            {"price": 101.0, "order_id": "tp1", "filled": True},
            {"price": 102.0, "order_id": "tp2", "filled": True},
            {"price": 103.0, "order_id": "tp3", "filled": False},
        ],
    )
    decision = decide(row, None, set(), None, MISSING_TOLERANCE)
    assert decision.closed is True
    # tp3 пропала из висящих - значит сработала.
    assert decision.takes_hit == 3
    assert decision.filled_orders == ["tp3"]


def test_manual_close_does_not_invent_taken_targets():
    """Цели сняли, вышли руками выше - взятых целей от этого не появилось.

    Раньше считалось по цене: дошли до уровня - значит «цель взята». В журнал
    попадали две цели там, где не сработала ни одна.
    """
    row = trade(takes_hit=0, qty=3.0, tp_orders=[])
    decision = decide(row, None, set(), None, MISSING_TOLERANCE)
    assert decision.closed is True
    assert decision.takes_hit == 0
    assert decision.filled_orders == []
def test_watcher_awaits_the_session_factory():
    """Фабрика сессии асинхронная, и забытое ожидание валит весь обход.

    В запрос уходила корутина вместо сеанса: «'coroutine' object has no
    attribute 'get'» на каждом проходе - позиции оставались без сопровождения,
    стоп не переезжал, цели не выставлялись, журнал не писался.
    """
    import inspect

    from backend.trading.watcher import PositionWatcher

    source = inspect.getsource(PositionWatcher._handle_student)
    assert "await self._http()" in source
    assert "public_price(self._http()" not in source


def test_only_recognized_stops_are_cancelled():
    """Заявка незнакомого вида остаётся жить.

    Раньше снималось всё, кроме опознанных целей: цель с непривычным названием
    вида уходила под нож через несколько секунд после входа - трейдер видел,
    как его тейки исчезают сами.
    """
    import inspect

    from backend.trading.watcher import PositionWatcher

    source = inspect.getsource(PositionWatcher._drop_old_stops)
    assert "stop_like" in source
    assert "if not stop_like:" in source


def test_partial_fill_is_not_a_taken_target():
    """Лимитка исполнилась частью - это не взятая цель.

    Цели считались от планируемого объёма: набрали 70% - значит «первая
    взята». Следом терминал двигал стоп в безубыток и снимал заявки, которые
    считал лишними, - цели пропадали через несколько секунд после входа.
    Объём сделки теперь берётся с биржи в момент, когда позиция появилась.
    """
    row = trade(status="waiting", qty=10.0)
    opened = decide(row, position("7"), ALL_PLANS, 101.5, 0)
    assert opened.opened is True
    assert opened.size == 7.0
    assert opened.takes_hit == 0

    # Дальше цели считаются уже от набранного, а не от задуманного.
    row = trade(status="open", qty=opened.size)
    assert decide(row, position("7"), ALL_PLANS, 101.5, 0).takes_hit == 0
    assert decide(row, position("4.9"), {"tp2", "tp3"}, 101.5, 0).takes_hit == 1


def test_opened_trade_remembers_the_real_size():
    row = trade(status="waiting", qty=10.0)
    decision = decide(row, position("6.5"), ALL_PLANS, 101.5, 0)
    assert decision.opened is True
    assert decision.size == 6.5


def test_growing_position_is_a_top_up_not_a_target():
    row = trade(status="open", qty=5.0)
    decision = decide(row, position("8"), ALL_PLANS, 101.5, 0)
    assert decision.takes_hit == 0
    assert decision.size == 8.0


def test_stop_goes_to_the_exchange_breakeven_after_every_take():
    """После каждой цели стоп идёт в ноль, посчитанный биржей.

    Так это сделано и в боте заказчика: частичное закрытие меняет стоимость
    позиции, и ноль после второй цели уже не тот, что после первой. Правило
    «за предыдущей целью» остаётся запасным - на случай, если биржа молчит.
    """
    row = trade(takes_hit=1, current_stop=100.05, qty=3.0)
    where = weex_position(size="0.6", cumOpenSize="3", cumOpenValue="300", cumOpenFee="0.24")
    where["cumCloseSize"] = "2.4"
    where["cumCloseValue"] = "247"     # закрыто выгодно, ноль уехал вниз
    where["cumCloseFee"] = "0.2"

    decision = decide(row, where, {"tp3"}, 102.5, 0)
    assert decision.takes_hit == 2
    # Ноль биржи ниже текущего стопа - назад не двигаем.
    assert decision.move_stop_to is None


def test_forward_move_to_a_better_breakeven_happens():
    row = trade(takes_hit=1, current_stop=99.5, qty=3.0)
    where = weex_position(size="2.1", cumOpenSize="3", cumOpenValue="300", cumOpenFee="0.24")
    where["cumCloseSize"] = "0.9"
    where["cumCloseValue"] = "91"
    where["cumCloseFee"] = "0.07"

    decision = decide(row, where, {"tp2", "tp3"}, 101.5, 0)
    assert decision.move_stop_to is not None
    assert decision.move_stop_to > 99.5


# ── опознание своих заявок ──────────────────────────────────────────────────

def test_our_orders_are_recognized_by_our_own_label():
    """Идентификатор биржа возвращает не всегда - метку задаём мы сами.

    На потерянной связи со своими заявками ломалось всё: цель считалась
    взятой, потому что «не нашлась», стоп снимался как чужой, а сверка защиты
    писала «целей нет» при живых целях.
    """
    from backend.trading.watcher import order_marks, stop_label, take_label

    assert take_label("BTCUSDT-1", 0) == "tp1_BTCUSDT-1"
    assert stop_label("BTCUSDT-1", 2) == "sl2_BTCUSDT-1"
    assert order_marks({"clientAlgoId": "tp1_BTCUSDT-1", "orderId": ""}) == {"tp1_BTCUSDT-1"}


def test_take_alive_under_its_label_is_not_counted_as_filled():
    row = trade(status="open", qty=3.0)
    # Биржа вернула заявки без идентификаторов, но с нашими метками.
    plans = {take_label(row.client_id, i) for i in range(3)}
    decision = decide(row, position("2.1"), plans, 101.5, 0)
    # Объём упал, но заявка жива - значит цель не сработала, а лимитка добралась.
    assert decision.filled_orders == []
