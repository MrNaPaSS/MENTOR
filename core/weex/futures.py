"""Торговый клиент фьючерсов WEEX.

Порт рабочей части из бота AlgoTradeWEEX: подпись запросов, аккаунт, позиции и
ордера. Существующий `core/weex/real.py` — это партнёрское API (статистика
рефералов), торговать через него нельзя: там другой домен, другие ключи и
другой набор ручек.

Подпись по документации биржи:

    сообщение = timestamp + МЕТОД + путь + ?строка_запроса + тело
    ACCESS-SIGN = Base64(HMAC-SHA256(сообщение, секрет))

Порядок частей важен до символа: путь без строки запроса, строка запроса со
знаком вопроса и ровно в том виде, в каком уходит в URL, тело — тем же текстом,
что и в запросе. Пересобрать тело второй раз через json.dumps с другими
пробелами значит получить подпись, которую биржа отвергнет.

Ордер не повторяется при сбое сети намеренно. Потерянный ответ на POST — это
неизвестность, а не отказ: повтор в такой ситуации открывает вторую позицию.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

import aiohttp

from core.broker import BrokerMark, weex_algo_mark, weex_mark
from core.throttle import take as take_budget

logger = logging.getLogger("nmnh.weex.futures")

BASE_URL = "https://api-contract.weex.com"

ENDPOINTS = {
    "balance": "/capi/v3/account/balance",
    "positions": "/capi/v3/account/position/allPosition",
    "leverage": "/capi/v3/account/leverage",
    "order": "/capi/v3/order",
    "open_orders": "/capi/v3/openOrders",
    "tp_sl": "/capi/v3/placeTpSlOrder",
    "modify_tp_sl": "/capi/v3/modifyTpSlOrder",
    "algo_orders": "/capi/v3/openAlgoOrders",
    "cancel_algo": "/capi/v3/algoOpenOrders",
    "algo_order": "/capi/v3/algoOrder",
    "user_trades": "/capi/v3/userTrades",
    "exchange_info": "/capi/v3/market/exchangeInfo",
    "api_symbols": "/capi/v3/market/apiTradingSymbols",
    "time": "/capi/v3/market/time",
}

# Шаги инструмента, если биржа их не отдала. Не догадка: столько же стоит в
# боте заказчика как DEFAULT. Но живые шаги всегда важнее — они меняются, и на
# BTC биржа уже отвечает 0.0001 там, где в таблице записано 0.001.
# Предельное плечо и комиссия тейкера - тоже свойства инструмента, и знать их
# нужно до отправки ордера: у большинства монет биржи потолок ×20 или ×50, а
# наши кнопки предлагают до ×400. Отказ приходил уже после нажатия «Войти».
DEFAULT_FILTERS = {
    "step": 0.001,
    "tick": 0.01,
    "min_qty": 0.001,
    "max_leverage": 20.0,
    "taker_fee": 0.0008,
    # Потолок одной заявки и всей позиции по инструменту, в монете. Биржа
    # отдаёт их в справочнике, и знать их нужно до отправки: отказ «position
    # exceed max size» приходит уже после нажатия.
    "max_qty": 0.0,
    "max_position": 0.0,
}

# Шаги по умолчанию с пометкой «угаданы». Их возвращает клиент, когда биржа
# справочник не отдала или монеты в нём нет: считать по ним можно, а ставить
# вход - нет (backend/api/trading.py, открытие сделки).
GUESSED_FILTERS = {**DEFAULT_FILTERS, "guessed": 1.0}

# Кэш на процесс: состав инструментов меняется раз в месяцы, а запрос тяжёлый.
# Но не навсегда: шаги у монет биржа всё же меняет, и процесс, живущий неделю,
# торговал бы по устаревшим. Раз в шесть часов справочник перечитывается;
# не ответила биржа - остаются прежние живые шаги.
_FILTERS: dict[str, dict[str, float]] = {}
_FILTERS_AT = 0.0
FILTERS_TTL = 6 * 3600.0


def floor_to_step(value: float, step: float) -> float:
    """Округлить объём вниз до шага лота.

    Вниз, а не к ближайшему: округление вверх увеличивает позицию, а значит и
    риск, о котором трейдер не просил, и может не пройти по марже.

    Считаем в целых шагах: 0.1 + 0.2 в двоичной дроби даёт 0.30000000000000004,
    и деление такой величины на шаг промахивается мимо целого.
    """
    if not (value > 0) or not (step > 0):
        return 0.0
    steps = int((value + step * 1e-9) / step)
    return round(steps * step, _decimals(step))


def round_to_tick(value: float, tick: float) -> float:
    """Цену — к ближайшему шагу цены: она не про размер риска.

    Результат округляем по числу знаков в самом шаге: умножение обратно на шаг
    возвращает двоичный хвост (79812.40000000001), и биржа такую цену не берёт.
    """
    if not (value > 0) or not (tick > 0):
        return value
    return round(round(value / tick) * tick, _decimals(tick))


def _decimals(step: float) -> int:
    """Сколько знаков после запятой в шаге."""
    text = f"{step:.12f}".rstrip("0")
    return len(text.split(".")[1]) if "." in text else 0


async def public_price(session, symbol: str) -> float | None:
    """Текущая цена инструмента без ключей.

    Нужна, чтобы не отправлять биржe заведомо невозможный стоп: у лонга он
    обязан стоять ниже цены, у шорта выше. В ответе по позиции цены нет вовсе -
    там только объёмы, стоимости и комиссии, - а без неё стоп после цели
    отклонялся и позиция оставалась со старым.
    """
    url = f"{BASE_URL}/capi/v3/market/symbolPrice"
    try:
        async with session.get(
            url, params={"symbol": symbol.upper()}, timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        logger.warning("Цена %s не получена: %s", symbol, exc)
        return None

    price = _f((data or {}).get("price"))
    return price if price > 0 else None


async def api_trading_symbols(session) -> frozenset[str] | None:
    """Пары, которые биржа даёт торговать через ключи. `None` - не ответила.

    У WEEX это отдельный и куда более короткий список, чем справочник
    инструментов: на 19 сентября 2026 в справочнике 995 пар, а через API
    торгуются 290. Разницы в самом справочнике не видно - поля «торгуется по
    API» там нет вовсе, и узнать это можно только здесь.

    Без этого списка монета выглядит обычной: она есть в скринере, по ней идёт
    цена и рисуется стакан, - а на «Войти» биржа отвечает «The trading pair is
    not supported via the API». То есть отказ приходит после нажатия, когда
    трейдер уже выбрал точку входа.

    Пустой ответ возвращаем как `None`, а не как пустое множество: «биржа не
    ответила» и «биржа не торгует ничего» - разные вещи, и вторая пометила бы
    весь список чужим.
    """
    url = f"{BASE_URL}{ENDPOINTS['api_symbols']}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                logger.warning("Список торгуемых по API пар: ответ %s", resp.status)
                return None
            data = await resp.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        logger.warning("Список торгуемых по API пар не получен: %s", exc)
        return None

    # Ответ - голый список имён. Если биржа однажды завернёт его в объект,
    # возьмём оттуда знакомые поля, а не упадём.
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    names = frozenset(str(one).upper() for one in rows if isinstance(one, str) and one)
    return names or None


async def public_filters(session, symbol: str) -> dict[str, float]:
    """Свойства инструмента без ключей: шаги, потолок плеча, комиссия.

    Справочник биржи открыт для всех, а знать предел плеча нужно и тому, кто
    ещё не подключил счёт: кнопка ×100 на монете с потолком ×50 - это отказ
    после нажатия «Войти», а не до него.

    Кэш общий с клиентом: состав инструментов меняется раз в месяцы.
    """
    sym = symbol.upper()
    if sym in _FILTERS:
        return _FILTERS[sym]

    url = f"{BASE_URL}{ENDPOINTS['exchange_info']}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                return DEFAULT_FILTERS
            data = await resp.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        logger.warning("Справочник инструментов не получен: %s", exc)
        return DEFAULT_FILTERS

    rows = data.get("symbols") if isinstance(data, dict) else data
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("symbol") or "").upper()
        parsed = _parse_filters(row)
        if name and parsed:
            _FILTERS[name] = parsed

    return _FILTERS.get(sym, DEFAULT_FILTERS)


def _parse_filters(row: dict[str, Any]) -> dict[str, float] | None:
    """Шаги инструмента из ответа биржи.

    Формат близок к бинансовскому, но не обязан совпадать до поля, поэтому
    читаем и фильтры, и «точность в знаках» — что найдётся.
    """
    out: dict[str, float] = {}
    for f in row.get("filters") or []:
        kind = str(f.get("filterType") or "").upper()
        if kind in ("LOT_SIZE", "MARKET_LOT_SIZE"):
            out.setdefault("step", _f(f.get("stepSize")))
            out.setdefault("min_qty", _f(f.get("minQty")))
        elif kind == "PRICE_FILTER":
            out.setdefault("tick", _f(f.get("tickSize")))

    if not out.get("step"):
        digits = row.get("quantityPrecision")
        if digits is not None:
            out["step"] = 10 ** -int(digits)
    if not out.get("tick"):
        digits = row.get("pricePrecision")
        if digits is not None:
            out["tick"] = 10 ** -int(digits)

    if not out.get("step") and not out.get("tick"):
        return None
    return {
        "step": out.get("step") or DEFAULT_FILTERS["step"],
        "tick": out.get("tick") or DEFAULT_FILTERS["tick"],
        "min_qty": _f(row.get("minOrderSize"))
        or out.get("min_qty")
        or out.get("step")
        or DEFAULT_FILTERS["min_qty"],
        "max_leverage": _f(row.get("maxLeverage")) or DEFAULT_FILTERS["max_leverage"],
        "taker_fee": _f(row.get("takerFeeRate")) or DEFAULT_FILTERS["taker_fee"],
        "max_qty": _f(row.get("maxOrderSize")),
        "max_position": _f(row.get("maxPositionSize")),
    }


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def plan_order_id(response: Any) -> str:
    """Идентификатор условной заявки из ответа биржи.

    Ответ приходит то списком `[{success, orderId}]`, то объектом, то тем же
    объектом внутри `data`. Разбираем все три: пропущенный идентификатор значит,
    что заявку потом нечем будет ни найти, ни передвинуть.
    """
    if response is None:
        return ""
    if isinstance(response, list):
        first = response[0] if response else None
        if isinstance(first, dict) and first.get("success") is False:
            return ""
        return str(first.get("orderId") or "") if isinstance(first, dict) else ""
    if isinstance(response, dict):
        if response.get("orderId"):
            return str(response["orderId"])
        if isinstance(response.get("data"), (list, dict)):
            return plan_order_id(response["data"])
    return ""


SIDES = {"BUY", "SELL"}
POSITION_SIDES = {"LONG", "SHORT", "BOTH"}


class WeexTradeError(Exception):
    """Отказ биржи или сети. `retryable` — можно ли повторить запрос."""

    def __init__(self, message: str, *, code: Any = None, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


# Чем биржи говорят «такой заявки нет». Слова у каждой свои, коды тоже: MEXC
# отвечает 2040 «order not exist», Binance -2011 «Unknown order sent», OKX
# 51603. Для снятия это не беда, а ответ: снимать нечего. Беда - считать такой
# отказ провалом и бросать начатое, не поставив ни новой заявки, ни защиты.
GONE_WORDS = (
    "not exist",
    "does not exist",
    "not found",
    "unknown order",
    "order state error",
    "не найден",
    "не существует",
)
GONE_CODES = {"2040", "-2011", "51603", "51400", "40109"}


def order_gone(exc: WeexTradeError) -> bool:
    """Отказ означает «заявки уже нет», а не «снять не вышло»."""
    if str(getattr(exc, "code", "") or "") in GONE_CODES:
        return True
    words = str(exc).lower()
    return any(one in words for one in GONE_WORDS)


@dataclass(frozen=True)
class Credentials:
    # Ключи не показываются в repr: первый же logger.exception с локальными
    # переменными или отладочный print напечатал бы доступ к деньгам ученика.
    api_key: str = field(repr=False)
    secret_key: str = field(repr=False)
    passphrase: str = field(repr=False)


def sign(secret: str, timestamp: str, method: str, path: str, query: str, body: str) -> str:
    """Подпись одного запроса."""
    message = f"{timestamp}{method.upper()}{path}{'?' + query if query else ''}{body}"
    digest = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def headers(creds: Credentials, method: str, path: str, query: str, body: str) -> dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    return {
        "ACCESS-KEY": creds.api_key,
        "ACCESS-SIGN": sign(creds.secret_key, timestamp, method, path, query, body),
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": creds.passphrase,
        "Content-Type": "application/json",
    }


def _query(params: dict[str, Any] | None) -> str:
    """Строка запроса ровно в том виде, в каком она уйдёт в URL."""
    if not params:
        return ""
    from urllib.parse import urlencode

    return urlencode({k: v for k, v in params.items() if v is not None})


class WeexFutures:
    """Торговые операции одного пользователя.

    Сессия приходит снаружи: держать по соединению на ученика значит открыть
    их столько, сколько учеников, — а живут они дольше самого запроса.
    """

    # Код биржи: по нему сделка запоминает, где открыта (core/exchanges.py).
    exchange = "weex"

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = BASE_URL,
        timeout: float = 15.0,
        broker_id: str | None = None,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.base_url = base_url
        self.timeout = timeout
        # Метка брокера. По умолчанию — из окружения, чтобы её получили все
        # места, где создаётся клиент (терминал, сопровождение, пересчёт,
        # перевод средств), а не только те, куда не забыли её передать.
        # Пустая переменная значит «мы ещё не брокер»: заявки уходят как
        # раньше, ни одно поведение не меняется.
        self.algo_mark: BrokerMark = weex_algo_mark(
            broker_id if broker_id is not None else os.getenv("WEEX_BROKER_ID", "")
        )
        self.mark: BrokerMark = weex_mark(
            broker_id if broker_id is not None else os.getenv("WEEX_BROKER_ID", "")
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> Any:
        query = _query(params)
        # Тело подписывается тем же текстом, что и отправляется: пересборка
        # через json.dumps с другими пробелами ломает подпись.
        body = json.dumps(data, separators=(",", ":"), ensure_ascii=False) if data else ""
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")

        # Бюджет запросов биржи: сверх него ждём очереди, а не ловим отказ
        # (core/throttle.py).
        await take_budget("weex", self.creds.api_key)

        session = await self._session_factory()
        try:
            async with session.request(
                method,
                url,
                data=body.encode("utf-8") if body else None,
                headers=headers(self.creds, method, path, query, body),
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                text = await response.text()
                status = response.status
        except aiohttp.ClientError as exc:
            raise WeexTradeError(f"Сеть недоступна: {exc}", retryable=True) from exc
        except TimeoutError as exc:
            raise WeexTradeError("Биржа не ответила вовремя", retryable=True) from exc

        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            raise WeexTradeError(f"Биржа ответила не JSON ({status})", retryable=status >= 500)

        # Ответ обёрнут: {"code": "0", "data": ..., "msg": ""}.
        if isinstance(payload, dict) and payload.get("code") is not None:
            if str(payload["code"]) != "0":
                # Отказ по существу: повторять бессмысленно, ответ не изменится.
                raise WeexTradeError(
                    str(payload.get("msg") or "Биржа отклонила запрос"),
                    code=payload.get("code"),
                    retryable=False,
                )
            return payload.get("data", payload)

        if status >= 400:
            raise WeexTradeError(
                f"Биржа вернула {status}",
                code=status,
                retryable=status in (408, 429) or status >= 500,
            )
        return payload

    # ── аккаунт ─────────────────────────────────────────────────────────────

    async def balance(self, margin_coin: str = "USDT") -> Any:
        return await self._request("GET", ENDPOINTS["balance"], params={"marginCoin": margin_coin})

    async def positions(self) -> list[dict]:
        data = await self._request("GET", ENDPOINTS["positions"])
        return data if isinstance(data, list) else []

    async def last_price(self, symbol: str) -> float | None:
        """Цена инструмента на этой бирже - та, от которой ставится стоп."""
        return await public_price(await self._session_factory(), symbol)

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        """Поставить плечо по монете - и в кросс-режиме, и в изолированном.

        Все три поля разом, одним числом. Биржа проверяет то из них, которое
        отвечает режиму маржи счёта, а режим этот - свойство счёта, а не наш
        выбор: у нового ученика он кросс по умолчанию, и запрос без
        ``crossLeverage`` возвращался отказом «Parameter 'crossLeverage' cannot
        be empty». Сделка при этом падала целиком, потому что плечо ставится
        перед заявкой.

        Спрашивать режим отдельным запросом ради этого не стоит: он стоит
        лишнего похода на биржу перед каждой сделкой, а плечо у нас в обоих
        режимах одно и то же - то, которое трейдер видит на графике.
        """
        return await self._request(
            "POST",
            ENDPOINTS["leverage"],
            data={
                "symbol": symbol,
                "marginCoin": margin_coin,
                "crossLeverage": str(leverage),
                "isolatedLongLeverage": str(leverage),
                "isolatedShortLeverage": str(leverage),
            },
        )

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        """Шаг лота, шаг цены и минимальный объём инструмента.

        Спрашиваем биржу, а не держим таблицу: инструментов в терминале полсотни,
        и шаги у них меняются. Ответ кэшируется на процесс — состав меняется раз
        в месяцы, а запрос тяжёлый.
        """
        global _FILTERS_AT
        sym = symbol.upper()
        if sym in _FILTERS and time.monotonic() - _FILTERS_AT < FILTERS_TTL:
            return _FILTERS[sym]

        try:
            data = await self._request("GET", ENDPOINTS["exchange_info"])
        except WeexTradeError as exc:
            logger.warning("Шаги инструментов не получены: %s", exc)
            # Прежние живые шаги лучше справочных: они были верны недавно.
            # Справочные помечены - торговая ручка по ним вход не отправит.
            return _FILTERS.get(sym) or GUESSED_FILTERS

        rows = data.get("symbols") if isinstance(data, dict) else data
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("symbol") or "").upper()
            parsed = _parse_filters(row)
            if name and parsed:
                _FILTERS[name] = parsed
        _FILTERS_AT = time.monotonic()

        return _FILTERS.get(sym, GUESSED_FILTERS)

    # ── ордера ──────────────────────────────────────────────────────────────

    async def place_order(
        self,
        *,
        symbol: str,
        side: str,
        position_side: str,
        quantity: str,
        order_type: str = "MARKET",
        price: str | None = None,
        client_order_id: str | None = None,
        tp_trigger: str | None = None,
        sl_trigger: str | None = None,
        reduce_only: bool | None = None,
        time_in_force: str | None = None,
    ) -> Any:
        """Поставить ордер. Не повторяется при сбое: повтор — вторая позиция."""
        if side not in SIDES:
            raise WeexTradeError(f"Неизвестная сторона: {side}")
        if position_side not in POSITION_SIDES:
            raise WeexTradeError(f"Неизвестная сторона позиции: {position_side}")

        data: dict[str, Any] = {
            "symbol": symbol,
            "side": side,
            "positionSide": position_side,
            "type": order_type,
            "quantity": quantity,
        }
        if order_type == "LIMIT":
            if price is None:
                raise WeexTradeError("Лимитному ордеру нужна цена")
            data["price"] = price
            # Биржа отклоняет лимитный ордер без срока жизни: «Parameter
            # timeInForce cannot be empty». GTC — заявка стоит, пока её не
            # исполнят или не снимут; именно это и значит «лимитка на уровне».
            data["timeInForce"] = time_in_force or "GTC"
        elif time_in_force:
            data["timeInForce"] = time_in_force
        if client_order_id:
            data["newClientOrderId"] = self.mark.tag(client_order_id)
        if tp_trigger:
            data["tpTriggerPrice"] = tp_trigger
        if sl_trigger:
            data["slTriggerPrice"] = sl_trigger
        if reduce_only is not None:
            data["reduceOnly"] = bool(reduce_only)

        logger.info("WEEX ордер %s %s %s %s", symbol, side, position_side, quantity)
        return await self._request("POST", ENDPOINTS["order"], data=data)

    async def place_tp_sl(
        self,
        *,
        symbol: str,
        plan_type: str,
        trigger_price: str,
        quantity: str,
        position_side: str,
        execute_price: str = "0",
        trigger_price_type: str = "MARK_PRICE",
        client_algo_id: str | None = None,
    ) -> Any:
        """Условная заявка защиты: стоп или цель.

        Именно так это делает бот заказчика, и не от хорошей жизни. Обычный
        сокращающий ордер на позицию с уже висящей защитой биржа отклоняет:
        «cannot set reduce only, you must cancel some order» — доступный к
        сокращению объём у неё нулевой, он весь зарезервирован. Условная заявка
        такого резерва не требует.

        `execute_price = "0"` значит исполнение по рынку после срабатывания.

        Метка брокера ставится и сюда. Брокерская команда WEEX ответила 12
        сентября 2026: условные заявки засчитываются, метку класть в
        `clientAlgoId`. Предел там тридцать два знака вместе с префиксом,
        поэтому ярлык защиты короткий (`backend/trading/watcher.py`,
        `take_label`). Не влез - заявка уйдёт без метки, но встанет: защита
        позиции дороже ребейта с одной заявки.
        """
        data: dict[str, Any] = {
            "symbol": symbol,
            "planType": plan_type,
            "triggerPrice": trigger_price,
            "executePrice": execute_price,
            "quantity": quantity,
            "positionSide": position_side,
            "triggerPriceType": trigger_price_type,
        }
        if client_algo_id:
            data["clientAlgoId"] = self.algo_mark.tag(client_algo_id)
        return await self._request("POST", ENDPOINTS["tp_sl"], data=data)

    async def modify_tp_sl(
        self,
        *,
        symbol: str,
        order_id: str,
        trigger_price: str,
        execute_price: str | None = None,
        trigger_price_type: str | None = None,
    ) -> Any:
        """Передвинуть стоп или тейк одним запросом, не снимая старый.

        Именно одним: снять и поставить заново — это окно, в котором позиция
        стоит без защиты, и рынок этим окном пользуется.
        """
        data: dict[str, Any] = {
            "symbol": symbol,
            "orderId": order_id,
            "triggerPrice": trigger_price,
        }
        if execute_price:
            data["executePrice"] = execute_price
        if trigger_price_type:
            data["triggerPriceType"] = trigger_price_type
        return await self._request("POST", ENDPOINTS["modify_tp_sl"], data=data)

    async def get_order(self, symbol: str, order_id: str) -> dict:
        """Состояние ордера. По нему и узнаём, что цель исполнилась.

        Спрашиваем именно ордер, а не остаток позиции: биржа знает исполненный
        объём точно, а остаток врёт при частичном исполнении и округлении лота.
        """
        data = await self._request(
            "GET", ENDPOINTS["order"], params={"symbol": symbol, "orderId": order_id}
        )
        return self.mark.clean(data) if isinstance(data, dict) else {}

    def _unmarked(self, data: Any) -> list[dict]:
        """Список заявок без метки брокера.

        Метка живёт только на стороне биржи. Внутри терминала идентификатор
        заявки должен выглядеть ровно так, как его создал терминал: по нему
        сопровождение узнаёт свою позицию, а журнал — свою сделку.
        """
        if not isinstance(data, list):
            return []
        if not self.mark.enabled:
            return data
        return [self.mark.clean(row) if isinstance(row, dict) else row for row in data]

    async def open_orders(self, symbol: str) -> list[dict]:
        data = await self._request("GET", ENDPOINTS["open_orders"], params={"symbol": symbol})
        return self._unmarked(data)

    async def algo_orders(self, symbol: str) -> list[dict]:
        data = await self._request("GET", ENDPOINTS["algo_orders"], params={"symbol": symbol})
        return self._unmarked(data)

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        return await self._request(
            "DELETE", ENDPOINTS["order"], params={"symbol": symbol, "orderId": order_id}
        )

    async def cancel_algo_order(self, symbol: str, order_id: str) -> Any:
        """Снять одну условную заявку.

        Условные заявки снимаются своей ручкой: обычная про них не знает и
        отвечает «ордер не найден», оставляя стоп висеть.
        """
        return await self._request(
            "DELETE", ENDPOINTS["algo_order"], params={"symbol": symbol, "orderId": str(order_id)}
        )

    async def cancel_all_algo(self, symbol: str) -> Any:
        """Снять условные заявки инструмента: стоп и всё, что к нему привязано.

        Нужно при полном закрытии позиции: осевшие заявки на несуществующий
        объём открывают позицию заново, стоило рынку дойти до их цены.
        """
        return await self._request("DELETE", ENDPOINTS["cancel_algo"], params={"symbol": symbol})

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if symbol:
            params["symbol"] = symbol
        data = await self._request("GET", ENDPOINTS["user_trades"], params=params)
        return self._unmarked(data)
