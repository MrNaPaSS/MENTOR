"""Приватный поток, который долго молчит, живым не считается.

Тихо оборвавшийся сокет долго считает себя открытым. Пока сопровождение ему
верило, оно видело застывшие позиции - ни взятой цели, ни закрытия.
"""

from __future__ import annotations

import asyncio
import time

from core.mexc.stream import STALE_AFTER as MEXC_STALE, MexcPrivateStream
from core.okx.stream import STALE_AFTER as OKX_STALE, OkxPrivateStream


class OpenSocket:
    closed = False


def test_quiet_okx_stream_is_not_trusted():
    stream = OkxPrivateStream.__new__(OkxPrivateStream)
    stream._ws = OpenSocket()
    stream._logged_in = asyncio.Event()
    stream._logged_in.set()
    # Снимок позиций пришёл: без него поток не готов вовсе (test_okx_stream.py),
    # а здесь проверяется другое - что замолчавшему потоку не верят.
    stream._have_positions = True

    stream.alive_at = time.monotonic()
    assert stream.ready is True
    stream.alive_at = time.monotonic() - OKX_STALE - 1
    assert stream.ready is False


def test_quiet_mexc_stream_is_not_trusted():
    stream = MexcPrivateStream.__new__(MexcPrivateStream)
    stream._ws = OpenSocket()
    stream._ready = True

    stream.alive_at = time.monotonic()
    assert stream.ready is True
    stream.alive_at = time.monotonic() - MEXC_STALE - 1
    assert stream.ready is False
