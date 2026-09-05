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

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Awaitable

import aiohttp

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
    "user_trades": "/capi/v3/userTrades",
    "exchange_info": "/capi/v3/market/exchangeInfo",
    "time": "/capi/v3/market/time",
}

# Шаги инструмента, если биржа их не отдала. Не догадка: столько же стоит в
# боте заказчика как DEFAULT. Но живые шаги всегда важнее — они меняются, и на
# BTC биржа уже отвечает 0.0001 там, где в таблице записано 0.001.
DEFAULT_FILTERS = {"step": 0.001, "tick": 0.01, "min_qty": 0.001}

# Кэш на процесс: состав инструментов меняется раз в месяцы, а запрос тяжёлый.
_FILTERS: dict[str, dict[str, float]] = {}


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
        "min_qty": out.get("min_qty") or out.get("step") or DEFAULT_FILTERS["min_qty"],
    }


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


SIDES = {"BUY", "SELL"}
POSITION_SIDES = {"LONG", "SHORT", "BOTH"}


class WeexTradeError(Exception):
    """Отказ биржи или сети. `retryable` — можно ли повторить запрос."""

    def __init__(self, message: str, *, code: Any = None, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class Credentials:
    api_key: str
    secret_key: str
    passphrase: str


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

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = BASE_URL,
        timeout: float = 15.0,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.base_url = base_url
        self.timeout = timeout

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

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        return await self._request(
            "POST",
            ENDPOINTS["leverage"],
            data={
                "symbol": symbol,
                "marginCoin": margin_coin,
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
        sym = symbol.upper()
        if sym in _FILTERS:
            return _FILTERS[sym]

        try:
            data = await self._request("GET", ENDPOINTS["exchange_info"])
        except WeexTradeError as exc:
            logger.warning("Шаги инструментов не получены: %s", exc)
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
            data["newClientOrderId"] = client_order_id
        if tp_trigger:
            data["tpTriggerPrice"] = tp_trigger
        if sl_trigger:
            data["slTriggerPrice"] = sl_trigger
        if reduce_only is not None:
            data["reduceOnly"] = bool(reduce_only)

        logger.info("WEEX ордер %s %s %s %s", symbol, side, position_side, quantity)
        return await self._request("POST", ENDPOINTS["order"], data=data)

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
        return data if isinstance(data, dict) else {}

    async def open_orders(self, symbol: str) -> list[dict]:
        data = await self._request("GET", ENDPOINTS["open_orders"], params={"symbol": symbol})
        return data if isinstance(data, list) else []

    async def algo_orders(self, symbol: str) -> list[dict]:
        data = await self._request("GET", ENDPOINTS["algo_orders"], params={"symbol": symbol})
        return data if isinstance(data, list) else []

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        return await self._request(
            "DELETE", ENDPOINTS["order"], params={"symbol": symbol, "orderId": order_id}
        )

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if symbol:
            params["symbol"] = symbol
        data = await self._request("GET", ENDPOINTS["user_trades"], params=params)
        return data if isinstance(data, list) else []
