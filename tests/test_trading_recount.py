"""Пересчёт журнала по отчётам биржи.

Записи, сделанные до исправления комиссии, сами себя не перепишут: журнал
хранит итог, а не способ его получить. Здесь проверяется, что пересчёт
поправляет ровно то, что было сломано, и молчит там, где данных нет.

Сделка настоящая, с биржи: лонг ETHUSDT, вход 2482.71, закрытие 2488.80,
объём 20.155, на счёт пришло +90.7024. В журнале стояло +98.71 при комиссии
24.08 и три цели вместо двух.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.trading.recount import _one

ENTRY = 2482.71
EXIT = 2488.80
QTY = 20.155
# Ставка, по которой биржа удержала на самом деле: 0.032% с ноги.
RATE = 0.00032

OPENED = datetime(2026, 9, 8, 0, 16, 53, tzinfo=timezone.utc)
CLOSED = datetime(2026, 9, 8, 0, 28, 18, tzinfo=timezone.utc)


def ms(at: datetime) -> int:
    return int(at.timestamp() * 1000)


def fills() -> list[dict]:
    """Исполнения сделки: вход и три закрытия, про среднее комиссия молчит."""
    out = [
        {
            "side": "BUY",
            "price": str(ENTRY),
            "qty": str(QTY),
            "realizedPnl": "0",
            "commission": str(ENTRY * QTY * RATE),
            "time": ms(OPENED),
        }
    ]
    for i, share in enumerate([0.3, 0.5, 0.2]):
        size = QTY * share
        one = {
            "side": "SELL",
            "price": str(EXIT),
            "qty": str(size),
            "realizedPnl": str((EXIT - ENTRY) * size),
            "time": ms(CLOSED - timedelta(seconds=10 - i)),
        }
        if i != 1:
            one["commission"] = str(EXIT * size * RATE)
        out.append(one)
    return out


class Exchange:
    """Биржа, отвечающая заранее известным отчётом."""

    def __init__(self, report: list[dict]):
        self._report = report
        self.asked = 0

    async def user_trades(self, symbol: str, limit: int = 100) -> list[dict]:
        self.asked += 1
        return self._report

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        return {"taker_fee": 0.0008}


def trade(**over) -> SimpleNamespace:
    row = SimpleNamespace(
        client_id="eth-1",
        symbol="ETHUSDT",
        side="long",
        entry=ENTRY,
        exit_price=2487.04,
        qty=QTY,
        targets_json=json.dumps([2486.0, 2488.0, 2495.0]),
        takes_hit=3,
        pnl=98.71,
        fee=24.08,
        opened_at=OPENED,
        closed_at=CLOSED,
        from_exchange=True,
        note="биржа",
    )
    for key, value in over.items():
        setattr(row, key, value)
    return row


def test_recount_fixes_the_fee_and_the_takes():
    row = trade()
    client = Exchange(fills())

    changed = asyncio.run(_one(None, client, row, {}, apply=True))

    assert changed == 1
    # То, что пришло на счёт.
    assert float(row.pnl) == pytest.approx(90.70, abs=0.05)
    # Комиссия обеих ног целиком, а не трёх четвертей.
    assert float(row.fee) == pytest.approx(QTY * (ENTRY + EXIT) * RATE, rel=1e-6)
    # Две цели: до третьей, 2495, цена не дошла.
    assert row.takes_hit == 2


def test_dry_run_changes_nothing():
    """Сухой прогон показывает расхождение, но записи не трогает."""
    row = trade()
    client = Exchange(fills())

    changed = asyncio.run(_one(None, client, row, {}, apply=False))

    assert changed == 1
    assert row.pnl == 98.71
    assert row.fee == 24.08
    assert row.takes_hit == 3


def test_a_trade_the_exchange_forgot_is_left_alone():
    """Исполнений в отчёте нет - запись не трогаем.

    Отчёт приходит окном: у сделки постарше он пуст. Записать по нему ноль
    значило бы стереть настоящую сделку.
    """
    row = trade()
    client = Exchange([])

    changed = asyncio.run(_one(None, client, row, {}, apply=True))

    assert changed == 0
    assert row.pnl == 98.71
    assert row.takes_hit == 3


def test_foreign_fills_of_the_same_coin_do_not_get_in():
    """Чужие исполнения по той же монете в счёт не идут.

    За день по одной монете сделок бывает много, а отчёт общий: взять его
    целиком значит сложить в одну запись результат нескольких сделок.
    """
    later = [
        {
            "side": "BUY",
            "price": "2500",
            "qty": "5",
            "realizedPnl": "0",
            "commission": "4",
            "time": ms(CLOSED + timedelta(hours=2)),
        },
        {
            "side": "SELL",
            "price": "2600",
            "qty": "5",
            "realizedPnl": "500",
            "commission": "4",
            "time": ms(CLOSED + timedelta(hours=3)),
        },
    ]
    row = trade()
    client = Exchange(fills() + later)

    asyncio.run(_one(None, client, row, {}, apply=True))

    # Пятьсот из соседней сделки сюда не попали.
    assert float(row.pnl) == pytest.approx(90.70, abs=0.05)


def test_the_report_is_asked_once_per_coin():
    """Отчёт по инструменту берём один раз на все его сделки."""
    client = Exchange(fills())
    reports: dict[str, list[dict]] = {}

    asyncio.run(_one(None, client, trade(), reports, apply=False))
    asyncio.run(_one(None, client, trade(client_id="eth-2"), reports, apply=False))

    assert client.asked == 1
