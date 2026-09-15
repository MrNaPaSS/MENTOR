"""Приватный поток OKX: на что подписываемся и чем подписываем запрос.

Проверок здесь немного, и каждая закрывает то, что уже стоило нам живого
прогона: подписка на канал, которого по этому адресу нет, отвергается биржей
целиком, а демо-счёт живёт на своём адресе и с боевого не виден.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from core.okx.stream import CHANNELS, WS_PRIVATE, WS_PRIVATE_DEMO, login_sign


def test_algo_channel_is_not_asked_from_the_private_address():
    """Условных заявок отсюда не просим: канал живёт на деловом адресе.

    Биржа отвечает «wrong URL or channel: orders-algo, instType: SWAP doesn't
    exist» и отказ пишется в журнал как сбой входа - проверено живым счётом
    14 сентября.
    """
    assert "orders-algo" not in CHANNELS
    # Позиции и заявки - то, на чём держится сопровождение.
    assert set(CHANNELS) == {"positions", "orders"}


def test_demo_account_lives_at_its_own_address():
    """Демо-счёт с боевого адреса не виден: биржа пускает, но данных не даёт."""
    assert WS_PRIVATE != WS_PRIVATE_DEMO
    assert "wspap" in WS_PRIVATE_DEMO


def test_login_is_signed_by_time_and_the_fixed_path():
    """Подпись входа: время, метод и постоянный путь. Тела в запросе нет."""
    stamp = "1700000000"
    expected = base64.b64encode(
        hmac.new(b"secret", f"{stamp}GET/users/self/verify".encode(), hashlib.sha256).digest()
    ).decode()
    assert login_sign("secret", stamp) == expected


# ── готовность и позиции ─────────────────────────────────────────────────────

import asyncio
import json
import time

from core.okx.futures import Credentials
from core.okx.stream import OkxPrivateStream


class _OpenWs:
    closed = False

    async def close(self) -> None:
        self.closed = True


def _logged_in_stream(specs: dict | None = None) -> OkxPrivateStream:
    async def load() -> dict:
        return specs or {}

    stream = OkxPrivateStream(Credentials("key", "secret", "pass"), load)
    stream._ws = _OpenWs()  # type: ignore[assignment]
    stream._logged_in.set()
    stream.alive_at = time.monotonic()
    return stream


def _positions_message(rows: list) -> str:
    return json.dumps({"arg": {"channel": "positions", "instType": "SWAP"}, "data": rows})


def test_stream_is_not_ready_until_positions_arrive():
    """Вход выполнен и соединение живо - но позиций ещё нет, и верить ему рано.

    Поток считался готовым сразу после входа и отдавал пустой список. Свежий
    вход по рынку в стакане не стоит, позиции «не было», и сопровождение через
    пять обходов молча снимало запись: сделка пропадала с терминала, а позиция
    на бирже жила.
    """
    stream = _logged_in_stream()
    assert stream.ready is False

    asyncio.run(stream._dispatch(stream._ws, _positions_message([])))
    assert stream.ready is True


def test_pong_alone_does_not_make_the_stream_ready():
    """Ответ на ping подтверждает соединение, но не состояние счёта."""
    stream = _logged_in_stream()
    asyncio.run(stream._dispatch(stream._ws, "pong"))
    assert stream.ready is False


def test_a_break_forgets_the_snapshot():
    """После обрыва снимок прежнего соединения не в счёт - ждём новый."""
    stream = _logged_in_stream()
    asyncio.run(stream._dispatch(stream._ws, _positions_message([])))
    assert stream.ready is True
    stream._down()
    stream.alive_at = time.monotonic()
    assert stream.ready is False


def test_a_position_without_its_instrument_is_not_erased():
    """Нет справочника по инструменту - это не закрытие позиции."""
    stream = _logged_in_stream(specs={})
    kept = {"symbol": "BTCUSDT", "positionSide": "LONG", "size": "0.01"}
    stream._positions[("BTC-USDT-SWAP", "long")] = kept
    row = {"instId": "BTC-USDT-SWAP", "pos": "1", "posSide": "long"}
    asyncio.run(stream._dispatch(stream._ws, _positions_message([row])))
    assert stream.positions() == [kept]
