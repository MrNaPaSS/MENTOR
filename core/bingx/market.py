"""Словарь BingX: имена, подпись, справочник пар и перевод ответов.

Всё, что отвечает на вопрос «как биржа называет то, что мы и так знаем»:
инструмент (`BTCUSDT` против `BTC-USDT`), точности вместо шагов, поля позиции и
заявки, подпись запроса и разбор конверта ответа. Торговых решений здесь нет -
они в `core/bingx/futures.py`, и этот раздел нужен ему целиком.

Отдельным файлом, потому что у этого кода два пользователя: торговый клиент и
приватный поток (`core/bingx/stream.py`). Поток переводит позиции из событий тем
же `position_row`, что клиент - из ответа ручки: разойтись этим двум местам
нельзя, сопровождение читает результат как одно и то же.

Числа и имена полей - из разбора документации биржи
(`docs/integrations/bingx-api.md`); что мы из этого строим - `docs/tz/bingx-tz.md`.
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
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from core.weex.futures import DEFAULT_FILTERS, WeexTradeError

logger = logging.getLogger("nmnh.bingx.market")

EXCHANGE = "bingx"
BASE_URL = "https://open-api.bingx.com"
# Демо-контур (VST): те же ручки, деньги учебные. Проверять адаптер на живом
# счёте ученика нельзя (ТЗ BingX, §5).
DEMO_URL = "https://open-api-vst.bingx.com"

ENDPOINTS = {
    "contracts": "/openApi/swap/v2/quote/contracts",
    "ticker": "/openApi/swap/v2/quote/ticker",
    "balance": "/openApi/swap/v3/user/balance",
    "positions": "/openApi/swap/v2/user/positions",
    "uid": "/openApi/account/v1/uid",
    "commission": "/openApi/swap/v2/user/commissionRate",
    "leverage": "/openApi/swap/v2/trade/leverage",
    "dual": "/openApi/swap/v1/positionSide/dual",
    "order": "/openApi/swap/v2/trade/order",
    "open_orders": "/openApi/swap/v2/trade/openOrders",
    "fills": "/openApi/swap/v2/trade/allFillOrders",
    "listen_key": "/openApi/user/auth/userDataStream",
}

# Идентификатор заявки: 1-40 знаков, и биржа переводит его в нижний регистр.
# Приводим сами - иначе сверка не сойдётся, и сделка окажется без сопровождения.
CLIENT_ID_LIMIT = 40
_NOT_ALLOWED = re.compile(r"[^a-z0-9_-]")

# Ставка тейкера по умолчанию для USDT-фьючерсов. Настоящая ставка счёта
# спрашивается у биржи (`taker_fee`), эта - на случай молчания.
DEFAULT_TAKER_FEE = 0.0005

# Коды, при которых запрос можно повторить: частота, перегрузка, разошедшееся
# время. Отказ по существу повторять бессмысленно.
RETRYABLE_CODES = {"100410", "100421", "80012", "80013"}

# Справочник инструментов живёт в памяти процесса: состав меняется редко, а
# запрос тяжёлый - но новый листинг не должен ждать перезапуска.
INSTRUMENTS_TTL = 3600.0

# Режим позиций трейдер меняет раз в жизни, а спрашивать его на каждом проходе
# сопровождения - лишний запрос на каждого ученика.
MODE_TTL = 600.0

# Заявку с тем же содержанием биржа принимает не чаще раза в секунду. Держим
# запас: часы и сеть не идеальны, а отказ приходит уже после нажатия «Войти».
SAME_ORDER_GUARD = 1.2

# Исполнения биржа отдаёт окном, и окно обязательно. Неделя - столько живёт
# самая долгая сделка терминала.
FILLS_WINDOW_MS = 7 * 24 * 3600 * 1000

# Состояние пары, при котором на ней торгуют: 1 работает, 25 нельзя открывать,
# 5 до листинга, 0 снята.
TRADABLE_STATUS = 1

# Типы заявок, которые для остального кода выглядят условными: стоп, цель и
# триггерные. Своей ручки для них у BingX нет - они висят в общем списке.
PLAN_TYPES = {
    "STOP_MARKET",
    "TAKE_PROFIT_MARKET",
    "STOP",
    "TAKE_PROFIT",
    "TRIGGER_LIMIT",
    "TRIGGER_MARKET",
    "TRAILING_STOP_MARKET",
    "TRAILING_TP_SL",
}

# Остаток запросов в окне биржа называет сама, заголовком ответа. Меньше этого
# - пишем в журнал: значит, бюджет подобран неверно.
LOW_REMAIN = 5


def client_id(value: str | None) -> str:
    """Идентификатор заявки в том виде, в каком его примет и вернёт BingX.

    Строчными: биржа приводит его к нижнему регистру сама, и наш `BTCUSDT-1789`
    вернулся бы как `btcusdt-1789`. Приводим до отправки - тогда в журнале
    сервера и в ответе биржи стоит одно и то же.
    """
    return _NOT_ALLOWED.sub("", str(value or "").lower())[:CLIENT_ID_LIMIT]


def source_key(value: str | None = None) -> str:
    """Метка брокера для заголовка `X-SOURCE-KEY`. Пусто - мы ещё не брокер."""
    raw = value if value is not None else os.getenv("BINGX_SOURCE_KEY", "")
    return str(raw or "").strip()


def symbol_id(symbol: str) -> str:
    """`BTCUSDT` -> `BTC-USDT`. Записанный через дефис не трогаем."""
    text = str(symbol or "").upper().strip()
    if "-" in text:
        return text
    if text.endswith("USDT") and len(text) > 4:
        return f"{text[:-4]}-USDT"
    return text


def symbol_of(instrument: str) -> str:
    """`BTC-USDT` -> `BTCUSDT`: так инструмент знает терминал."""
    return str(instrument or "").upper().replace("-", "")


def sign(secret: str, query: str) -> str:
    """Подпись запроса: HMAC-SHA256 от строки параметров, шестнадцатеричная.

    Подписывается ровно та строка, что уходит в адресе: пересобранная с другим
    порядком параметров или другим кодированием - это другая подпись.
    """
    return hmac.new(secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()


def query_string(params: dict[str, Any]) -> str:
    """Строка параметров в том виде, в каком она уйдёт в адресе."""
    return urlencode({k: v for k, v in params.items() if v not in (None, "")})


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


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


def step_of(precision: Any) -> float:
    """Шаг из числа знаков: четыре знака - шаг 0.0001.

    Весь наш код считает шагами (`floor_to_step`, `round_to_tick`), а BingX
    называет точность. Перевод живёт здесь и только здесь.
    """
    digits = max(0, min(12, _i(precision)))
    return round(10.0**-digits, 12)


@dataclass(frozen=True)
class Instrument:
    """Свойства пары: всё, что нужно знать до постановки заявки.

    Кроме шагов и минимумов здесь три признака, которых нет у других бирж, и
    каждый из них - причина отказа, непонятного ученику: пара может быть
    закрыта для брокерских пользователей (`broker_closed`), закрыта для
    открытия по API (`api_open`) или для закрытия по API (`api_close`).
    """

    symbol: str
    quantity_precision: int
    price_precision: int
    min_qty: float
    min_notional: float
    taker: float
    maker: float
    max_leverage: float
    status: int
    api_open: bool
    api_close: bool
    broker_closed: bool

    @property
    def step(self) -> float:
        return step_of(self.quantity_precision)

    @property
    def tick(self) -> float:
        return step_of(self.price_precision)

    @property
    def tradable(self) -> bool:
        return self.status == TRADABLE_STATUS

    def filters(self, taker_fee: float | None = None) -> dict[str, float]:
        """Шаги инструмента в том же виде, что у WEEX."""
        step = self.step or DEFAULT_FILTERS["step"]
        return {
            "step": step,
            "tick": self.tick or DEFAULT_FILTERS["tick"],
            "min_qty": self.min_qty or step,
            "max_leverage": self.max_leverage or DEFAULT_FILTERS["max_leverage"],
            "taker_fee": taker_fee if taker_fee else (self.taker or DEFAULT_TAKER_FEE),
            # Потолка одной заявки и всей позиции справочник BingX не называет:
            # ноль здесь значит «биржа не сказала», а не «предела нет».
            "max_qty": 0.0,
            "max_position": 0.0,
            # Минимум в деньгах - только у BingX. Держим его рядом с шагами,
            # чтобы расчёт объёма мог отказать до биржи, а не после.
            "min_notional": self.min_notional,
        }


def parse_instrument(row: dict[str, Any]) -> Instrument | None:
    """Строка справочника BingX -> свойства пары. Не USDT-фьючерс - не наш.

    Нерабочую пару в справочник не берём: в списке монет она выглядела бы
    обычной, а правду ученик узнавал бы отказом биржи.
    """
    name = str(row.get("symbol") or "").upper()
    if not name.endswith("-USDT"):
        return None
    status = _i(row.get("status")) if row.get("status") not in (None, "") else TRADABLE_STATUS
    if status != TRADABLE_STATUS:
        return None
    return Instrument(
        symbol=name,
        quantity_precision=_i(row.get("quantityPrecision")),
        price_precision=_i(row.get("pricePrecision")),
        min_qty=_f(row.get("tradeMinQuantity")),
        min_notional=_f(row.get("tradeMinUSDT")),
        taker=_f(row.get("takerFeeRate")),
        maker=_f(row.get("makerFeeRate")),
        max_leverage=_f(row.get("maxLeverage") or row.get("maxLongLeverage")),
        status=status,
        # Поля может не быть вовсе - это не запрет: молчание биржи не повод
        # отказывать в заявке.
        api_open=_bool(row.get("apiStateOpen"), True),
        api_close=_bool(row.get("apiStateClose"), True),
        broker_closed=_bool(row.get("brokerState"), False),
    )


def position_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Позиция BingX в полях WEEX. Пусто - позиции нет.

    Отдельной функцией, а не внутри запроса: тем же переводом пользуется
    приватный поток (`core/bingx/stream.py`), и разойтись этим двум местам
    нельзя - сопровождение читает результат как одно и то же.
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
    avg = _f(row.get("avgPrice"))
    return {
        "symbol": symbol_of(name),
        "instId": name,
        "side": side,
        "positionSide": side,
        "size": _num(size),
        # Номер позиции нужен при закрытии в раздельной изоляции: без него
        # биржа не поймёт, какую из двух закрывать.
        "positionId": str(row.get("positionId") or ""),
        "leverage": row.get("leverage") or "",
        "markPrice": row.get("markPrice") or "",
        "unrealizePnl": row.get("unrealizedProfit") or "0",
        "liquidatePrice": row.get("liquidationPrice") or "",
        "marginSize": row.get("margin") or row.get("initialMargin") or "",
        "averageOpenPrice": row.get("avgPrice") or "",
        # Средняя цена входа у сопровождения - стоимость на объём.
        "cumOpenSize": _num(size),
        "cumOpenValue": _num(avg * size),
    }


def is_plan(row: dict[str, Any]) -> bool:
    """Условная ли это заявка. У BingX вид заявки - единственный признак."""
    return str(row.get("type") or "").upper() in PLAN_TYPES


def plan_row(row: dict[str, Any]) -> dict[str, Any]:
    """Условная заявка BingX в виде условной заявки WEEX.

    Стоп от цели отличает тип: `STOP_MARKET` и `STOP` - защита, `TAKE_PROFIT*`
    - цель. Других признаков у заявки нет, и догадываться по цене здесь не
    нужно: тип биржа называет всегда.
    """
    kind = str(row.get("type") or "").upper()
    name = str(row.get("symbol") or "").upper()
    side = str(row.get("positionSide") or "").upper()
    if side not in ("LONG", "SHORT"):
        # В одностороннем режиме сторону позиции задаёт направление закрытия:
        # лонг защищают продажей.
        side = "LONG" if str(row.get("side") or "").upper() == "SELL" else "SHORT"
    stop_like = "STOP" in kind or "TRAILING" in kind
    return {
        "orderId": str(row.get("orderId") or ""),
        # Своего идентификатора у условных заявок BingX нет вовсе - здесь почти
        # всегда пусто, и опознаются они номером. Поле оставлено, чтобы
        # сопровождение читало все биржи одним кодом.
        "clientAlgoId": client_id(row.get("clientOrderId")),
        "clientOrderId": client_id(row.get("clientOrderId")),
        "symbol": symbol_of(name),
        "positionSide": side,
        "side": str(row.get("side") or "").upper(),
        "planType": "STOP_LOSS" if stop_like else "TAKE_PROFIT",
        "type": kind,
        "triggerPrice": row.get("stopPrice") or row.get("triggerPrice") or "",
        "quantity": _num(abs(_f(row.get("origQty") or row.get("quantity")))),
        "state": str(row.get("status") or ""),
    }


def order_row(row: dict[str, Any]) -> dict[str, Any]:
    """Обычная заявка BingX в полях WEEX."""
    name = str(row.get("symbol") or "").upper()
    side = str(row.get("positionSide") or "").upper()
    return {
        "orderId": str(row.get("orderId") or ""),
        "clientOrderId": client_id(row.get("clientOrderId") or row.get("clientOrderID")),
        "symbol": symbol_of(name),
        "side": str(row.get("side") or "").upper(),
        "positionSide": side if side in ("LONG", "SHORT") else "",
        "type": str(row.get("type") or "").upper(),
        "price": row.get("price") or "",
        "origQty": _num(abs(_f(row.get("origQty")))),
        "executedQty": _num(abs(_f(row.get("executedQty")))),
        "avgPrice": row.get("avgPrice") or "",
        "status": str(row.get("status") or "").upper(),
    }


_INSTRUMENTS: dict[str, Instrument] = {}
_INSTRUMENTS_AT = 0.0
_MODES: dict[str, tuple[bool, float]] = {}
# Счета, по которым эхо метки брокера уже проверено. Пишем об этом в журнал
# один раз, а не гадаем потом, засчитан ли оборот (ТЗ BingX, §3.1).
_SOURCE_SEEN: set[str] = set()


def _unwrap(payload: Any, status: int) -> Any:
    """Разобрать конверт ответа: `{"code": 0, "msg": "", "data": ...}`."""
    if not isinstance(payload, dict):
        if status >= 400:
            raise WeexTradeError(
                f"BingX вернула {status}", code=status, retryable=status == 429 or status >= 500
            )
        return payload

    code = str(payload.get("code") if payload.get("code") is not None else "0")
    if code not in ("0", ""):
        message = str(payload.get("msg") or "BingX отклонила запрос")
        raise WeexTradeError(
            message,
            code=code,
            retryable=code in RETRYABLE_CODES or status == 429 or status >= 500,
        )
    if status >= 400:
        raise WeexTradeError(
            f"BingX вернула {status}", code=status, retryable=status == 429 or status >= 500
        )
    data = payload.get("data")
    return data if data is not None else payload


def _watch_limits(headers: Any) -> None:
    """Остаток запросов из заголовков ответа - в журнал, пока он не кончился.

    Биржа считает частоту и по счёту, и по адресу, а остаток называет сама.
    Это лучше, чем гадать: бан приходит на пять минут и сразу всем ученикам.
    """
    try:
        remain = headers.get("X-RateLimit-Requests-Remain")
    except AttributeError:
        return
    if remain is None:
        return
    left = _i(remain)
    if left and left <= LOW_REMAIN:
        logger.warning(
            "Бюджет запросов BingX на исходе: осталось %s до %s",
            left,
            headers.get("X-RateLimit-Requests-Expire") or "?",
        )


def signed_url(base_url: str, path: str, query: str) -> URL:
    """Адрес запроса ровно в том виде, в каком он подписан.

    `encoded=True` здесь обязателен. Без него библиотека адресов перекодирует
    строку запроса по-своему - например, возвращает `%3A` обратно двоеточием, -
    и биржа считает подпись от другой строки, чем мы. У заявки с приложенной
    защитой (`stopLoss` - это JSON внутри параметра) промах был бы верным.
    """
    return URL(f"{base_url}{path}" + (f"?{query}" if query else ""), encoded=True)


async def _public_get(session, path: str, params: dict[str, Any], base_url: str = BASE_URL) -> Any:
    """Открытая ручка без подписи: справочник и цена."""
    query = query_string(params)
    url = signed_url(base_url, path, query)
    async with session.request("GET", url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        text = await resp.text()
        status = resp.status
        _watch_limits(resp.headers)
    try:
        payload = json.loads(text) if text else {}
    except ValueError as exc:
        raise WeexTradeError(f"BingX ответила не JSON ({status})", retryable=status >= 500) from exc
    return _unwrap(payload, status)


def _rows(data: Any, key: str = "") -> list[dict]:
    """Список строк из ответа: биржа кладёт их то списком, то под ключом."""
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        inner = data.get(key) if key else None
        if isinstance(inner, list):
            return [row for row in inner if isinstance(row, dict)]
        for value in data.values():
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
    return []


async def load_instruments(session, base_url: str = BASE_URL) -> dict[str, Instrument]:
    """Справочник USDT-фьючерсов, из памяти процесса, пока он свежий."""
    global _INSTRUMENTS_AT
    if _INSTRUMENTS and time.monotonic() - _INSTRUMENTS_AT < INSTRUMENTS_TTL:
        return _INSTRUMENTS
    data = await _public_get(session, ENDPOINTS["contracts"], {}, base_url)
    fresh = {
        spec.symbol: spec
        for spec in (parse_instrument(row) for row in _rows(data))
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
        logger.warning("Справочник BingX не получен: %s", exc)
        return DEFAULT_FILTERS
    spec = specs.get(symbol_id(symbol))
    return spec.filters() if spec else DEFAULT_FILTERS


async def public_price(session, symbol: str) -> float | None:
    """Последняя цена пары без ключей."""
    try:
        data = await _public_get(session, ENDPOINTS["ticker"], {"symbol": symbol_id(symbol)})
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.warning("Цена %s на BingX не получена: %s", symbol, exc)
        return None
    row = data[0] if isinstance(data, list) and data else data
    price = _f(row.get("lastPrice") or row.get("price")) if isinstance(row, dict) else 0.0
    return price if price > 0 else None




def fill_time(row: dict[str, Any]) -> int:
    """Время исполнения в миллисекундах эпохи.

    BingX называет его то числом, то строкой с часовым поясом
    («2026-09-13T05:37:24.000+0800»). Разбираем оба: журнал отбирает исполнения
    по окну сделки, и время, прочитанное нулём, выбросило бы их все.
    """
    value = row.get("filledTm") or row.get("filledTime") or row.get("time") or row.get("tradeTime")
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        logger.debug("Время исполнения BingX не разобрано: %r", value)
        return 0
    return int(stamp.timestamp() * 1000)
