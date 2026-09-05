"""Торговый модуль: подпись запросов и правила сопровождения позиции.

Проверяется то, что нельзя проверить глазами: подпись, которую отвергнет
биржа, и безубыток, который на самом деле убыток. Сеть здесь не участвует —
это чистые функции, и они обязаны быть точными до последнего знака.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from core.trading.position import (
    DEFAULT_TAKER_FEE,
    Position,
    breakeven_price,
    should_move_stop,
    stop_after_take,
)
from core.weex.futures import Credentials, WeexTradeError, headers, sign


# ── подпись ──────────────────────────────────────────────────────────────────

def test_signature_matches_documented_formula():
    """Сообщение — timestamp + МЕТОД + путь + ?запрос + тело, ровно в этом порядке."""
    secret = "s3cret"
    message = "1713400000000GET/capi/v3/account/balance?marginCoin=USDT"
    expected = base64.b64encode(
        hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    ).decode()

    assert sign(secret, "1713400000000", "GET", "/capi/v3/account/balance", "marginCoin=USDT", "") == expected


def test_signature_without_query_has_no_question_mark():
    """Пустая строка запроса не добавляет знак вопроса — иначе подпись не сойдётся."""
    secret = "s3cret"
    with_query = sign(secret, "1", "GET", "/p", "", "")
    manual = base64.b64encode(hmac.new(secret.encode(), b"1GET/p", hashlib.sha256).digest()).decode()
    assert with_query == manual


def test_signature_covers_body():
    secret = "s3cret"
    a = sign(secret, "1", "POST", "/p", "", '{"a":1}')
    b = sign(secret, "1", "POST", "/p", "", '{"a":2}')
    assert a != b


def test_headers_carry_everything_exchange_asks_for():
    creds = Credentials("key", "secret", "pass")
    out = headers(creds, "GET", "/p", "", "")
    assert out["ACCESS-KEY"] == "key"
    assert out["ACCESS-PASSPHRASE"] == "pass"
    assert out["ACCESS-TIMESTAMP"].isdigit()
    assert len(out["ACCESS-TIMESTAMP"]) == 13      # миллисекунды, не секунды
    assert out["Content-Type"] == "application/json"


# ── безубыток ────────────────────────────────────────────────────────────────

def test_breakeven_of_a_long_is_above_entry():
    """Комиссия платится дважды, поэтому настоящий ноль выше цены входа."""
    position = Position("BTCUSDT", "long", entry=100.0, quantity=1.0)
    be = breakeven_price(position, mark_price=110.0)
    assert be is not None and be > 100.0
    # Проверяем саму формулу: 100 * (1 + f) / (1 - f).
    assert be == pytest.approx(100 * (1 + DEFAULT_TAKER_FEE) / (1 - DEFAULT_TAKER_FEE))


def test_breakeven_of_a_short_is_below_entry():
    position = Position("BTCUSDT", "short", entry=100.0, quantity=1.0)
    be = breakeven_price(position, mark_price=90.0)
    assert be is not None and be < 100.0


def test_breakeven_never_pushes_stop_into_a_loss():
    """Цена уже ниже безубытка: ставить туда стоп значит закрыть себя в минус."""
    position = Position("BTCUSDT", "long", entry=100.0, quantity=1.0)
    assert breakeven_price(position, mark_price=100.01) == 100.0


def test_breakeven_needs_a_real_entry():
    assert breakeven_price(Position("BTCUSDT", "long", entry=0, quantity=1)) is None


# ── перестановка стопа ───────────────────────────────────────────────────────

def test_stop_moves_only_towards_less_risk():
    long = Position("BTCUSDT", "long", entry=100, quantity=1, stop=99)
    assert should_move_stop(long, 99.5) is True
    assert should_move_stop(long, 98.5) is False

    short = Position("BTCUSDT", "short", entry=100, quantity=1, stop=101)
    assert should_move_stop(short, 100.5) is True
    assert should_move_stop(short, 101.5) is False


def test_first_stop_is_always_accepted():
    assert should_move_stop(Position("BTCUSDT", "long", 100, 1), 99) is True


def test_first_take_moves_stop_to_breakeven():
    position = Position("BTCUSDT", "long", entry=100, quantity=1, stop=99)
    stop = stop_after_take(position, takes_hit=1, targets=[101, 102, 103], mark_price=101.5)
    assert stop is not None and stop > 100


def test_second_take_hides_stop_behind_the_first_target():
    position = Position("BTCUSDT", "long", entry=100, quantity=1, stop=100.04)
    stop = stop_after_take(position, takes_hit=2, targets=[101, 102, 103], mark_price=102.5)
    assert stop == 101


def test_no_takes_no_move():
    position = Position("BTCUSDT", "long", entry=100, quantity=1, stop=99)
    assert stop_after_take(position, 0, [101, 102, 103]) is None


def test_stop_is_not_moved_backwards_after_a_take():
    """Стоп уже за первой целью — второй раз туда же его двигать не нужно."""
    position = Position("BTCUSDT", "long", entry=100, quantity=1, stop=101.5)
    assert stop_after_take(position, takes_hit=2, targets=[101, 102, 103]) is None


# ── защита от глупостей ──────────────────────────────────────────────────────

def test_unknown_side_is_rejected_before_the_network():
    from core.weex.futures import WeexFutures

    client = WeexFutures(Credentials("k", "s", "p"), lambda: None)  # type: ignore[arg-type]
    import asyncio

    with pytest.raises(WeexTradeError):
        asyncio.run(
            client.place_order(symbol="BTCUSDT", side="ВВЕРХ", position_side="LONG", quantity="1")
        )
    with pytest.raises(WeexTradeError):
        asyncio.run(
            client.place_order(symbol="BTCUSDT", side="BUY", position_side="ВНИЗ", quantity="1")
        )
