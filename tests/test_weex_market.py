"""Список монет WEEX для скринера.

Разбор сводки биржи проверяется числами: по этим строкам трейдер выбирает, чем
торговать, и молча ошибиться здесь значит увести его не в ту монету.
"""

from __future__ import annotations

import pytest

from backend.scalping.weex_market import row_of, symbol_of, _order


def ticker(**over):
    body = {
        "symbol": "cmt_btcusdt",
        "last": "79148.0",
        "best_ask": "79148.0",
        "best_bid": "79147.9",
        "high_24h": "80531.0",
        "low_24h": "78638.4",
        "volume_24h": "1048969668.61236",
        "priceChangePercent": "-0.009607",
        "base_volume": "13191.2982",
        "markPrice": "79148",
    }
    body.update(over)
    return body


def test_symbol_loses_the_exchange_prefix():
    """`cmt_btcusdt` - это BTCUSDT: под этим именем монета известна везде."""
    assert symbol_of("cmt_btcusdt") == "BTCUSDT"
    assert symbol_of("BTCUSDT") == "BTCUSDT"
    assert symbol_of("") == ""


def test_change_comes_as_a_share_and_becomes_percent():
    """Биржа отдаёт долю: -0.009607 это -0.96%, а не -0.0096%."""
    row = row_of(ticker())
    assert row is not None
    assert row["change_pct"] == pytest.approx(-0.9607, rel=1e-9)


def test_price_and_volume_are_taken_as_they_are():
    row = row_of(ticker())
    assert row is not None
    assert row["price"] == pytest.approx(79148.0)
    assert row["volume_24h"] == pytest.approx(1048969668.61236)


def test_spread_is_counted_in_basis_points():
    row = row_of(ticker(best_bid="79000", best_ask="79079"))
    assert row is not None
    # Десятая доля процента - это десять базисных пунктов.
    assert row["spread_bp"] == pytest.approx(10.0, rel=1e-3)


def test_fields_we_cannot_know_stay_empty():
    """Дельта ленты и плиты считаются по стакану, которого для этих монет нет.

    Ноль здесь означает «не знаем». Выдумать число значит соврать трейдеру в
    той самой колонке, по которой он сортирует.
    """
    row = row_of(ticker())
    assert row is not None
    assert row["delta_notional"] == 0
    assert row["wall_notional"] == 0
    assert row["wall_side"] == ""
    # И честно говорим, что стакан по этой монете не ведётся.
    assert row["live"] is False


@pytest.mark.parametrize(
    "bad",
    [
        {"symbol": "cmt_btcusd"},      # не USDT-пара
        {"last": "0", "markPrice": "0"},  # цены нет
    ],
)
def test_useless_rows_are_dropped(bad):
    assert row_of(ticker(**bad)) is None


def test_unknown_sort_falls_back_to_turnover():
    """Сортировки по полю, которого в сводке нет, не молчат, а идут по обороту.

    Случайный порядок трейдер принял бы за настоящий; порядок по обороту он
    узнает и поймёт, что сортировка не сработала.
    """
    rows = [
        {"volume_24h": 10, "change_pct": 5, "range_bp": 1, "spread_bp": 1},
        {"volume_24h": 30, "change_pct": 1, "range_bp": 9, "spread_bp": 2},
    ]
    by_delta = sorted(rows, key=_order("delta"), reverse=True)
    assert by_delta[0]["volume_24h"] == 30
