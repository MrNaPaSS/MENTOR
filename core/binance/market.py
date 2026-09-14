"""Словарь Binance: имена, подпись, справочник пар и перевод ответов.

Всё, что отвечает на вопрос «как биржа называет то, что мы и так знаем».
Отвечает она, надо сказать, привычнее всех: пара пишется `BTCUSDT` - ровно так,
как её знает терминал, - объём считается в монетах, сторона и `reduceOnly`
разведены. Переводить здесь почти нечего, и это главное отличие Binance от трёх
предыдущих бирж.

Торговых решений здесь нет - они в `core/binance/futures.py`; этот раздел нужен
ему и приватному потоку (`core/binance/stream.py`) целиком: перевод позиции
обязан быть у них общим, сопровождение читает результат как одно и то же.

Рыночная половина биржи живёт отдельно и давно
(`backend/scalping/binance.py`): с неё идут скринер, книга и свечи всем, у кого
своя биржа не подключена. Здесь - только то, что требует ключей.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from core.broker.tag import BrokerMark, binance_mark
from core.weex.futures import DEFAULT_FILTERS, WeexTradeError

logger = logging.getLogger("nmnh.binance.market")

EXCHANGE = "binance"
BASE_URL = "https://fapi.binance.com"
# Учебный контур биржи. В отличие от MEXC, у Binance он есть, и это редкая
# удача: адаптер проверяется живыми заявками, не тратя денег ученика.
#
# Адрес - тот, что биржа называет в «General Info» своей документации
# (developers.binance.com, раздел USDⓈ-M Futures). Прежнее написание
# `testnet.binancefuture.com` ещё отвечает, но новое стоит в документации, а
# догадки об адресах нам уже стоили вечера на BingX.
TESTNET_URL = "https://demo-fapi.binance.com"

ENDPOINTS = {
    "time": "/fapi/v1/time",
    "exchange_info": "/fapi/v1/exchangeInfo",
    "price": "/fapi/v1/ticker/price",
    "balance": "/fapi/v2/balance",
    "positions": "/fapi/v2/positionRisk",
    "leverage": "/fapi/v1/leverage",
    "leverage_bracket": "/fapi/v1/leverageBracket",
    "dual": "/fapi/v1/positionSide/dual",
    "commission": "/fapi/v1/commissionRate",
    "order": "/fapi/v1/order",
    # Условные заявки с 9 декабря 2025 живут отдельно: обычная ручка заявки
    # отвечает на них кодом -4120 «Order type not supported for this endpoint».
    # Стоп и цель ставятся, читаются и снимаются только здесь.
    "algo_order": "/fapi/v1/algoOrder",
    "open_algo_orders": "/fapi/v1/openAlgoOrders",
    "open_orders": "/fapi/v1/openOrders",
    "all_open_orders": "/fapi/v1/allOpenOrders",
    "user_trades": "/fapi/v1/userTrades",
    "listen_key": "/fapi/v1/listenKey",
}

# Окно годности запроса. По умолчанию биржа даёт пять секунд, и этого мало:
# столько набегает от неточных часов машины и медленной сети вместе. Берём тот
# же запас, что у BingX.
RECV_WINDOW = 20000

# Насколько часы этой машины расходятся с часами биржи, миллисекунды.
_SKEW_MS = 0.0
_SKEW_AT = 0.0
SKEW_TTL = 300.0

# Идентификатор заявки: 36 знаков вместе с меткой брокера и узкий набор знаков.
# Это самый тесный предел из пяти бирж - у WEEX, для сравнения, 64.
CLIENT_ID_LIMIT = 36
_NOT_ALLOWED = re.compile(r"[^.A-Za-z0-9:/_-]")

# Ставка тейкера по умолчанию для USDT-фьючерсов, нулевой уровень VIP.
DEFAULT_TAKER_FEE = 0.0005

# Коды, при которых запрос можно повторить: частота и внутренние сбои биржи.
# Отказ по существу повторять бессмысленно.
RETRYABLE_CODES = {"-1003", "-1007", "-1015", "-1016", "-1021"}
# Отказ по метке времени: часы разошлись с биржей.
CLOCK_CODES = {"-1021", "-1022"}

INSTRUMENTS_TTL = 3600.0
MODE_TTL = 600.0
# Плечо по паре трейдер меняет редко, а спрашивать его на каждом проходе
# сопровождения - лишний запрос на каждого ученика.
BRACKET_TTL = 3600.0

# Исполнения биржа отдаёт окном, и окно у неё - семь суток на запрос.
TRADES_WINDOW_MS = 7 * 24 * 3600 * 1000

MARGIN_COIN = "USDT"

# Состояние пары, при котором на ней торгуют.
TRADABLE_STATUS = "TRADING"

# Типы заявок, которые для остального кода выглядят условными. Своей ручки для
# них у Binance нет - они висят в общем списке, как на BingX.
PLAN_TYPES = {
    "STOP",
    "STOP_MARKET",
    "TAKE_PROFIT",
    "TAKE_PROFIT_MARKET",
    "TRAILING_STOP_MARKET",
}


def broker_mark(value: str | None = None) -> BrokerMark:
    """Метка брокера: префикс `x-{BrokerID}` в идентификаторе заявки.

    Пусто - метки нет вовсе, и поведение не отличается от нынешнего. Брокерская
    программа Binance закрыта порогами (docs/integrations/broker-applications.md,
    §6), поэтому переменная пустая и будет пустой до Link-статуса.
    """
    raw = value if value is not None else os.getenv("BINANCE_BROKER_ID", "")
    return binance_mark(raw)


def client_id(value: str | None) -> str:
    """Идентификатор заявки в том виде, в каком его примет биржа.

    Регистр Binance сохраняет; набор знаков сужен до того, что разрешает её
    правило (`^[\\.A-Z\\:/a-z0-9_-]{1,36}$`) - чужой знак биржа отвергает
    вместе со всей заявкой.
    """
    return _NOT_ALLOWED.sub("", str(value or ""))[:CLIENT_ID_LIMIT]


def symbol_id(symbol: str) -> str:
    """Пара в написании биржи. У Binance оно совпадает с нашим: `BTCUSDT`."""
    return str(symbol or "").upper().strip().replace("-", "").replace("_", "")


def symbol_of(instrument: str) -> str:
    """`BTCUSDT` -> `BTCUSDT`: перевода нет, и функция здесь ради единообразия.

    Остальной код зовёт `symbol_of` у каждой биржи, не зная, надо ли ей что-то
    переводить. Пусть у Binance это будет видно строкой, а не исключением из
    правила по месту вызова.
    """
    return str(instrument or "").upper()


def sign(secret: str, query: str) -> str:
    """Подпись запроса: HMAC-SHA256 от строки параметров, шестнадцатеричная."""
    return hmac.new(secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()


def query_string(params: dict[str, Any]) -> str:
    """Строка параметров. Подписывается ровно она и ровно она уходит на биржу."""
    return urlencode({k: v for k, v in params.items() if v not in (None, "")})


def stamp() -> str:
    """Метка времени для подписи - с поправкой на часы биржи."""
    return str(int(time.time() * 1000 + _SKEW_MS))


def request_url(base_url: str, path: str, query: str = "") -> URL:
    """Адрес запроса ровно в том виде, в каком он подписан.

    `encoded=True` обязателен: без него библиотека адресов перекодирует строку
    запроса по-своему, и биржа посчитает подпись от другого текста. На OKX и
    BingX это уже стоило вечера (коммит 66abd1b).
    """
    return URL(f"{base_url}{path}" + (f"?{query}" if query else ""), encoded=True)


async def sync_clock(session, base_url: str = BASE_URL, force: bool = False) -> float:
    """Узнать, на сколько наши часы расходятся с биржей. Возвращает смещение, мс."""
    global _SKEW_MS, _SKEW_AT
    if not force and _SKEW_AT and time.monotonic() - _SKEW_AT < SKEW_TTL:
        return _SKEW_MS
    before = time.time() * 1000
    try:
        data = await public_get(session, ENDPOINTS["time"], {}, base_url)
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.debug("Время Binance не получено: %s", exc)
        return _SKEW_MS
    after = time.time() * 1000
    server = _f(data.get("serverTime")) if isinstance(data, dict) else 0.0
    if server <= 0:
        return _SKEW_MS
    _SKEW_MS = server - (before + after) / 2
    _SKEW_AT = time.monotonic()
    if abs(_SKEW_MS) > 1000:
        logger.info(
            "Часы разошлись с Binance на %.0f мс - подписываем запросы с поправкой", _SKEW_MS
        )
    return _SKEW_MS


def clock_skew() -> float:
    """Последнее известное расхождение часов, миллисекунды. Нужно пробнику."""
    return _SKEW_MS


def is_clock_error(exc: WeexTradeError) -> bool:
    """Отказ по метке времени: часы разошлись с биржей."""
    text = str(exc).lower()
    return str(exc.code) in CLOCK_CODES or "timestamp" in text or "recvwindow" in text


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _num(value: float) -> str:
    """Число строкой, без экспоненты и двоичного хвоста."""
    return f"{round(value, 10):.10f}".rstrip("0").rstrip(".") or "0"


def _bool(value: Any, default: bool = False) -> bool:
    """Биржа отвечает то `true`, то `"true"`, то единицей."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Instrument:
    """Свойства пары: всё, что нужно знать до постановки заявки.

    Шаги Binance называет прямо, фильтрами, а не числом знаков, как BingX, и не
    контрактами, как OKX с MEXC: что пришло, то и считаем. Единственное, чего в
    справочнике нет, - предел плеча: он живёт в отдельной подписанной ручке
    (`leverageBracket`), и без ключей его не узнать.
    """

    symbol: str
    step: float
    tick: float
    min_qty: float
    max_qty: float
    min_notional: float
    status: str
    max_leverage: float = 0.0

    @property
    def tradable(self) -> bool:
        return self.status == TRADABLE_STATUS

    def filters(self, taker_fee: float | None = None, max_leverage: float = 0.0) -> dict[str, float]:
        """Шаги инструмента в том же виде, что у WEEX."""
        step = self.step or DEFAULT_FILTERS["step"]
        return {
            "step": step,
            "tick": self.tick or DEFAULT_FILTERS["tick"],
            "min_qty": self.min_qty or step,
            # Ноль здесь значит «биржа не сказала»: предел плеча приходит
            # подписанной ручкой, и без ключей мы его не знаем. Врать
            # двадцаткой нельзя - на Binance плечо бывает и 125.
            "max_leverage": max_leverage or self.max_leverage or 0.0,
            "taker_fee": taker_fee if taker_fee else DEFAULT_TAKER_FEE,
            "max_qty": self.max_qty,
            "max_position": 0.0,
            # Минимум в деньгах: у Binance он есть, как у BingX, и это вторая
            # причина отказа, непонятного ученику.
            "min_notional": self.min_notional,
        }


def parse_instrument(row: dict[str, Any]) -> Instrument | None:
    """Строка справочника Binance -> свойства пары. Не USDT-фьючерс - не наш.

    Шаги лежат в фильтрах, каждый своим типом: `LOT_SIZE` - объём, `PRICE_FILTER`
    - цена, `MIN_NOTIONAL` - минимальная сумма. Нерабочую пару в справочник не
    берём: в списке монет она выглядела бы обычной, а правду ученик узнавал бы
    отказом биржи.
    """
    name = str(row.get("symbol") or "").upper()
    if str(row.get("quoteAsset") or "").upper() != "USDT":
        return None
    if str(row.get("contractType") or "PERPETUAL").upper() != "PERPETUAL":
        return None
    status = str(row.get("status") or TRADABLE_STATUS).upper()
    if status != TRADABLE_STATUS:
        return None

    lot: dict[str, Any] = {}
    price: dict[str, Any] = {}
    notional: dict[str, Any] = {}
    for one in row.get("filters") or []:
        if not isinstance(one, dict):
            continue
        kind = str(one.get("filterType") or "")
        if kind == "LOT_SIZE":
            lot = one
        elif kind == "PRICE_FILTER":
            price = one
        elif kind in ("MIN_NOTIONAL", "NOTIONAL"):
            notional = one

    return Instrument(
        symbol=name,
        step=_f(lot.get("stepSize")),
        tick=_f(price.get("tickSize")),
        min_qty=_f(lot.get("minQty")),
        max_qty=_f(lot.get("maxQty")),
        min_notional=_f(notional.get("notional") or notional.get("minNotional")),
        status=status,
    )


def position_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Позиция Binance в полях WEEX. Пусто - позиции нет.

    Отдельной функцией, а не внутри запроса: тем же переводом пользуется
    приватный поток, и разойтись этим двум местам нельзя - сопровождение
    читает результат как одно и то же.
    """
    amount = _f(row.get("positionAmt"))
    size = abs(amount)
    name = str(row.get("symbol") or "").upper()
    if size <= 0 or not name:
        return None
    side = str(row.get("positionSide") or "").upper()
    if side not in ("LONG", "SHORT"):
        # Односторонний режим: стороны в ответе нет, но знак объёма есть всегда.
        side = "LONG" if amount >= 0 else "SHORT"
    avg = _f(row.get("entryPrice"))
    position = {
        "symbol": name,
        "instId": name,
        "side": side,
        "positionSide": side,
        "size": _num(size),
        # Отдельного номера у позиции Binance нет: она адресуется парой и
        # стороной. Поле оставлено пустым, чтобы сопровождение читало все биржи
        # одним кодом.
        "positionId": "",
        "leverage": row.get("leverage") or "",
        "markPrice": row.get("markPrice") or "",
        "unrealizePnl": row.get("unRealizedProfit") or row.get("unrealizedProfit") or "0",
        "liquidatePrice": row.get("liquidationPrice") or "",
        "marginSize": row.get("isolatedWallet") or row.get("isolatedMargin") or "",
        "averageOpenPrice": row.get("entryPrice") or "",
        # Средняя цена входа у сопровождения - стоимость на объём.
        "cumOpenSize": _num(size),
        "cumOpenValue": _num(avg * size),
    }
    # Безубыток биржа считает сама, с комиссией: терминал обязан быть зеркалом
    # биржи, а не спорить с ней своей формулой.
    if _f(row.get("breakEvenPrice")) > 0:
        position["breakEvenPrice"] = row.get("breakEvenPrice")
    return position


def is_plan(row: dict[str, Any]) -> bool:
    """Условная ли это заявка. У Binance вид заявки - единственный признак."""
    kind = str(row.get("type") or row.get("origType") or "").upper()
    return kind in PLAN_TYPES


def plan_row(row: dict[str, Any], mark: BrokerMark | None = None) -> dict[str, Any]:
    """Условная заявка Binance в виде условной заявки WEEX.

    Стоп от цели отличает тип. Объём у стопа может быть не назван вовсе - это
    заявка с `closePosition`, закрывающая позицию целиком; в таком виде её и
    показываем, нулём, а не выдуманным числом.
    """
    # У алго-ручки свои имена: вид заявки в `orderType`, номер в `algoId`,
    # цена срабатывания в `triggerPrice`, состояние в `algoStatus`. Читаем оба
    # написания: обычную ручку мы ещё спрашиваем про лимитки.
    kind = str(row.get("type") or row.get("origType") or row.get("orderType") or "").upper()
    name = str(row.get("symbol") or "").upper()
    side = str(row.get("positionSide") or "").upper()
    if side not in ("LONG", "SHORT"):
        # В одностороннем режиме сторону позиции задаёт направление закрытия:
        # лонг защищают продажей.
        side = "LONG" if str(row.get("side") or "").upper() == "SELL" else "SHORT"
    stop_like = "STOP" in kind
    tag = mark or broker_mark()
    return {
        "orderId": str(row.get("algoId") or row.get("orderId") or ""),
        "algoId": str(row.get("algoId") or row.get("orderId") or ""),
        # У Binance метка есть и у условных заявок - в отличие от BingX и MEXC.
        "clientAlgoId": client_id(
            tag.untag(str(row.get("clientAlgoId") or row.get("clientOrderId") or ""))
        ),
        "clientOrderId": client_id(
            tag.untag(str(row.get("clientAlgoId") or row.get("clientOrderId") or ""))
        ),
        "symbol": name,
        "positionSide": side,
        "side": str(row.get("side") or "").upper(),
        "planType": "STOP_LOSS" if stop_like else "TAKE_PROFIT",
        "type": kind,
        "triggerPrice": row.get("triggerPrice") or row.get("stopPrice") or "",
        "quantity": _num(abs(_f(row.get("quantity") or row.get("origQty")))),
        "state": str(row.get("algoStatus") or row.get("status") or ""),
        # Заявка закрывает позицию целиком: объёма у неё нет по устройству.
        "closePosition": _bool(row.get("closePosition"), False),
    }


def order_row(row: dict[str, Any], mark: BrokerMark | None = None) -> dict[str, Any]:
    """Обычная заявка Binance в полях WEEX."""
    name = str(row.get("symbol") or "").upper()
    side = str(row.get("positionSide") or "").upper()
    tag = mark or broker_mark()
    return {
        "orderId": str(row.get("orderId") or ""),
        "clientOrderId": client_id(tag.untag(str(row.get("clientOrderId") or ""))),
        "symbol": name,
        "side": str(row.get("side") or "").upper(),
        "positionSide": side if side in ("LONG", "SHORT") else "",
        "type": str(row.get("type") or row.get("origType") or "").upper(),
        "price": row.get("price") or "",
        "origQty": _num(abs(_f(row.get("origQty")))),
        "executedQty": _num(abs(_f(row.get("executedQty")))),
        "avgPrice": row.get("avgPrice") or "",
        "status": str(row.get("status") or "").upper(),
    }


_INSTRUMENTS: dict[str, Instrument] = {}
_INSTRUMENTS_AT = 0.0
_MODES: dict[str, tuple[bool, float]] = {}
_BRACKETS: dict[tuple[str, str], tuple[float, float]] = {}


def clear_caches() -> None:
    """Забыть справочник, режимы счетов и пределы плеча. Нужно тестам и пробнику."""
    global _INSTRUMENTS_AT
    _INSTRUMENTS.clear()
    _INSTRUMENTS_AT = 0.0
    _MODES.clear()
    _BRACKETS.clear()


def unwrap(payload: Any, status: int) -> Any:
    """Разобрать ответ. Конверта у Binance нет: успех - это сами данные.

    Отказ приходит объектом с отрицательным `code` и текстом в `msg`; по коду
    видно, можно ли повторять - частота и внутренний сбой можно, «баланса не
    хватает» нет.
    """
    if isinstance(payload, dict) and payload.get("code") is not None and "msg" in payload:
        code = str(payload.get("code"))
        if code not in ("0", "200"):
            message = str(payload.get("msg") or "Binance отклонила запрос")
            raise WeexTradeError(
                message,
                code=code,
                retryable=code in RETRYABLE_CODES or status == 429 or status >= 500,
            )
    if status >= 400:
        raise WeexTradeError(
            f"Binance вернула {status}", code=status, retryable=status == 429 or status >= 500
        )
    return payload


def rows_of(data: Any) -> list[dict]:
    """Список строк ответа. Биржа отдаёт их списком, но бывает и один объект."""
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [data]
    return []


async def public_get(session, path: str, params: dict[str, Any], base_url: str = BASE_URL) -> Any:
    """Открытая ручка без подписи: справочник, цена, время."""
    query = query_string(params)
    url = request_url(base_url, path, query)
    async with session.request("GET", url, timeout=aiohttp.ClientTimeout(total=15)) as response:
        text = await response.text()
        status = response.status
    try:
        payload = json.loads(text) if text else {}
    except ValueError as exc:
        raise WeexTradeError(
            f"Binance ответила не JSON ({status})", retryable=status >= 500
        ) from exc
    return unwrap(payload, status)


async def load_instruments(session, base_url: str = BASE_URL) -> dict[str, Instrument]:
    """Справочник USDT-фьючерсов, из памяти процесса, пока он свежий."""
    global _INSTRUMENTS_AT
    if _INSTRUMENTS and time.monotonic() - _INSTRUMENTS_AT < INSTRUMENTS_TTL:
        return _INSTRUMENTS
    data = await public_get(session, ENDPOINTS["exchange_info"], {}, base_url)
    rows = data.get("symbols") if isinstance(data, dict) else None
    fresh = {
        spec.symbol: spec
        for spec in (
            parse_instrument(row) for row in (rows or []) if isinstance(row, dict)
        )
        if spec is not None
    }
    if fresh:
        _INSTRUMENTS.clear()
        _INSTRUMENTS.update(fresh)
        _INSTRUMENTS_AT = time.monotonic()
    return _INSTRUMENTS


async def public_filters(session, symbol: str) -> dict[str, float]:
    """Шаги инструмента без ключей. Не узнали - шаги по умолчанию, как у WEEX."""
    try:
        specs = await load_instruments(session)
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.warning("Справочник Binance не получен: %s", exc)
        return DEFAULT_FILTERS
    spec = specs.get(symbol_id(symbol))
    return spec.filters() if spec else DEFAULT_FILTERS


async def public_price(session, symbol: str) -> float | None:
    """Последняя цена пары без ключей."""
    try:
        data = await public_get(session, ENDPOINTS["price"], {"symbol": symbol_id(symbol)})
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.warning("Цена %s на Binance не получена: %s", symbol, exc)
        return None
    row = data[0] if isinstance(data, list) and data else data
    price = _f(row.get("price")) if isinstance(row, dict) else 0.0
    return price if price > 0 else None
