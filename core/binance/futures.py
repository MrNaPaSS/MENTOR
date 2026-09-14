"""Торговый клиент фьючерсов Binance - пятая биржа терминала.

Говорит полями WEEX, как клиенты OKX, BingX и MEXC, и по той же причине:
сопровождение сделок, перенос уровней и журнал написаны по ответам WEEX и
читают их поля. Сам перевод живёт рядом, в `core/binance/market.py`; здесь -
решения, которые принимает клиент.

Binance - самая привычная из пяти: пара пишется так же, как у нас, объём в
монетах, шаги названы прямо, сторона и `reduceOnly` разведены. Отличий, о
которых нужно помнить, три, и первое из них важнее остальных:

* **защиту нельзя приложить ко входу.** Ни `stopLossPrice`, как у MEXC, ни
  строки с JSON, как у BingX, здесь нет: стоп и цель - это отдельные условные
  заявки, и ставятся они **после** входа, вторым запросом. Значит между входом
  и стопом есть окно в доли секунды, и закрыть его нечем - так устроена биржа.
  Клиент ставит защиту сам, сразу за подтверждением входа, а если биржа
  откажет - вход не откатывается (позиция уже открыта), но в журнал идёт
  тревога, и сопровождение достроит стоп своим кругом
  (`stop_waits_full_fill`, `backend/trading/watcher.py`).
* **`closePosition` вместо объёма.** Стоп на всю позицию Binance умеет ставить
  без объёма вовсе - такая заявка закрывает её целиком, сколько бы в ней ни
  было. Для стопа это лучше объёма: позиция подросла лимиткой, а стоп всё
  равно накрывает её всю. Лестница целей закрывает части, и там объём нужен.
* **идентификатор заявки короче всех** - 36 знаков вместе с меткой брокера,
  против 64 у WEEX (`core/broker/tag.py`).

Ошибки - тем же `WeexTradeError`: по нему весь торговый код решает, повторять
запрос или отказывать трейдеру.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.broker.tag import BrokerMark
from core.throttle import take as take_budget
from core.weex.futures import (
    DEFAULT_FILTERS,
    POSITION_SIDES,
    SIDES,
    Credentials,
    WeexTradeError,
    floor_to_step,
)

# Словарь биржи целиком: имена, подпись, справочник и перевод ответов.
from core.binance.market import (  # noqa: F401 - часть имён здесь ради тех, кто импортирует их отсюда
    BASE_URL,
    BRACKET_TTL,
    CLIENT_ID_LIMIT,
    DEFAULT_TAKER_FEE,
    ENDPOINTS,
    EXCHANGE,
    INSTRUMENTS_TTL,
    MARGIN_COIN,
    MODE_TTL,
    PLAN_TYPES,
    RECV_WINDOW,
    RETRYABLE_CODES,
    TESTNET_URL,
    TRADABLE_STATUS,
    TRADES_WINDOW_MS,
    Instrument,
    _bool,
    _f,
    _i,
    _num,
    broker_mark,
    client_id,
    clock_skew,
    is_clock_error,
    is_plan,
    load_instruments,
    order_row,
    parse_instrument,
    plan_row,
    position_row,
    public_filters,
    public_price,
    query_string,
    request_url,
    rows_of,
    sign,
    stamp,
    symbol_id,
    symbol_of,
    sync_clock,
    unwrap,
)
from core.binance.market import _BRACKETS, _MODES

logger = logging.getLogger("nmnh.binance.futures")


class BinanceFutures:
    """Торговые операции одного пользователя на Binance.

    Сессия приходит снаружи, как у `WeexFutures`: соединения живут дольше
    запроса, и заводить их по числу учеников нельзя.
    """

    exchange = EXCHANGE

    # Приложенной ко входу защиты у Binance нет вовсе: стоп ставится вторым
    # запросом. Клиент делает это сам, но признак включён - сопровождение
    # проверит, есть ли стоп на набранном объёме, и поставит свой, если
    # второй запрос не дошёл. Ошибка в эту сторону стоит лишнего запроса,
    # ошибка в другую - позиции без стопа.
    stop_waits_full_fill = True

    # Метка у условных заявок Binance есть - в отличие от BingX и MEXC.
    # Опознавать защиту номером не нужно.
    plans_unlabeled = False

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str | None = None,
        timeout: float = 15.0,
        broker_key: str | None = None,
        testnet: bool | None = None,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.timeout = timeout
        # Учебный контур живёт на своём адресе, а не на признаке в заголовке:
        # адрес и решает, учебные деньги или живые.
        self.testnet = (
            testnet
            if testnet is not None
            else os.getenv("BINANCE_TESTNET", "").strip().lower() in ("1", "true", "yes")
        )
        self.base_url = base_url or (TESTNET_URL if self.testnet else BASE_URL)
        self.margin_coin = MARGIN_COIN
        # Метка брокера - из окружения по умолчанию, как у WEEX и BingX.
        self.mark: BrokerMark = broker_mark(broker_key)
        self._fee: float | None = None

    # ── запрос ──────────────────────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        signed: bool = True,
        retried: bool = False,
    ) -> Any:
        """Подписанный запрос. Параметры Binance ждёт в адресе, а не в теле."""
        data = dict(params or {})
        if signed:
            # Время - с поправкой на часы биржи: расхождение в несколько секунд
            # набегает на любой машине, а биржа отклоняет такие запросы.
            data["timestamp"] = stamp()
            data["recvWindow"] = str(RECV_WINDOW)
        query = query_string(data)
        if signed:
            query = f"{query}&signature={sign(self.creds.secret_key, query)}"
        url = request_url(self.base_url, path, query)

        # Бюджет запросов биржи: сверх него ждём очереди, а не ловим отказ
        # (core/throttle.py).
        await take_budget(EXCHANGE, self.creds.api_key)

        session = await self._session_factory()
        try:
            async with session.request(
                method,
                url,
                headers={"X-MBX-APIKEY": self.creds.api_key},
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                text = await response.text()
                status = response.status
        except aiohttp.ClientError as exc:
            raise WeexTradeError(f"Сеть недоступна: {exc}", retryable=True) from exc
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise WeexTradeError("Binance не ответила вовремя", retryable=True) from exc

        try:
            payload = json.loads(text) if text else {}
        except ValueError as exc:
            raise WeexTradeError(
                f"Binance ответила не JSON ({status})", retryable=status >= 500
            ) from exc

        try:
            return unwrap(payload, status)
        except WeexTradeError as exc:
            # Отказ по метке времени лечится сам: спрашиваем часы биржи и
            # повторяем - запрос при таком отказе до биржи не дошёл, значит
            # повтор ничего не задваивает. Один раз: если и со сверенными
            # часами не вышло, дело не в них.
            if retried or not is_clock_error(exc):
                raise
            await sync_clock(await self._session_factory(), self.base_url, force=True)
            logger.info("Binance отклонила метку времени - повторяем со сверенными часами")
            return await self._request(method, path, params=params, signed=signed, retried=True)

    # ── справочник и режим счёта ────────────────────────────────────────────

    async def _specs(self) -> dict[str, Instrument]:
        return await load_instruments(await self._session_factory(), self.base_url)

    async def _spec(self, symbol: str) -> Instrument:
        spec = (await self._specs()).get(symbol_id(symbol))
        if spec is None:
            raise WeexTradeError(f"Пары {symbol} нет среди USDT-фьючерсов Binance")
        return spec

    async def position_mode(self) -> str:
        """`long_short_mode` или `net_mode` - в словах OKX, чтобы читать одинаково."""
        return "long_short_mode" if await self._hedge() else "net_mode"

    async def _hedge(self) -> bool:
        """Двусторонний ли режим позиций. Кэш по ключу, на несколько минут.

        Ошибку не глушим. От режима зависит, как уходит заявка: в двустороннем
        сторона позиции обязательна, в одностороннем - запрещена вместе с
        `reduceOnly`. Угадав неверно, мы поставили бы заявку не в ту сторону.
        """
        cached = _MODES.get(self.creds.api_key)
        if cached and time.monotonic() - cached[1] < MODE_TTL:
            return cached[0]
        data = await self._request("GET", ENDPOINTS["dual"])
        row = data if isinstance(data, dict) else {}
        hedge = _bool(row.get("dualSidePosition"), False)
        _MODES[self.creds.api_key] = (hedge, time.monotonic())
        return hedge

    async def account_uid(self) -> str:
        """Номер счёта на бирже.

        Отдельной ручки «кто я» у фьючерсного API Binance нет. Счёт ученика
        сверяется с подтверждением академии по номеру из партнёрского отчёта -
        поэтому здесь пусто, а не выдуманное значение: пустую строку
        подключение понимает как «биржа номера не дала».
        """
        return ""

    async def max_leverage(self, symbol: str) -> float:
        """Предел плеча по паре - из подписанной ручки, другой её нет.

        В справочнике инструментов Binance плеча не называет вовсе, а оно у
        монет разное: у BTC сто двадцать пять, у мелких бывает пять. Показать
        ученику чужой предел значит дать ему собрать заявку, которую биржа не
        примет.
        """
        key = (self.creds.api_key, symbol_id(symbol))
        cached = _BRACKETS.get(key)
        if cached and time.monotonic() - cached[1] < BRACKET_TTL:
            return cached[0]
        try:
            data = await self._request(
                "GET", ENDPOINTS["leverage_bracket"], params={"symbol": symbol_id(symbol)}
            )
        except WeexTradeError as exc:
            logger.debug("Предел плеча %s на Binance не получен: %s", symbol, exc)
            return 0.0
        rows = rows_of(data)
        brackets = rows[0].get("brackets") if rows else None
        first = brackets[0] if isinstance(brackets, list) and brackets else {}
        value = _f(first.get("initialLeverage")) if isinstance(first, dict) else 0.0
        if value > 0:
            _BRACKETS[key] = (value, time.monotonic())
        return value

    async def taker_fee(self) -> float:
        """Ставка тейкера этого счёта."""
        if self._fee is not None:
            return self._fee
        try:
            data = await self._request(
                "GET", ENDPOINTS["commission"], params={"symbol": "BTCUSDT"}
            )
            row = data if isinstance(data, dict) else {}
            rate = abs(_f(row.get("takerCommissionRate")))
            self._fee = rate if 0 < rate < 0.01 else DEFAULT_TAKER_FEE
        except WeexTradeError as exc:
            logger.debug("Ставка комиссии Binance не получена: %s", exc)
            self._fee = DEFAULT_TAKER_FEE
        return self._fee

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        try:
            spec = await self._spec(symbol)
        except WeexTradeError as exc:
            logger.warning("Шаги %s на Binance не получены: %s", symbol, exc)
            return DEFAULT_FILTERS
        return spec.filters(await self.taker_fee(), await self.max_leverage(symbol))

    async def last_price(self, symbol: str) -> float | None:
        return await public_price(await self._session_factory(), symbol)

    # ── аккаунт ─────────────────────────────────────────────────────────────

    async def balance(self, margin_coin: str = "") -> list[dict[str, Any]]:
        """Средства счёта в полях WEEX: сколько доступно и сколько всего."""
        want = (margin_coin or self.margin_coin).upper()
        data = await self._request("GET", ENDPOINTS["balance"])
        out = []
        for row in rows_of(data):
            if str(row.get("asset") or "").upper() != want:
                continue
            out.append(
                {
                    "marginCoin": want,
                    "availableBalance": row.get("availableBalance") or "0",
                    "equity": row.get("balance") or row.get("crossWalletBalance") or "0",
                }
            )
        return out

    async def positions(self) -> list[dict[str, Any]]:
        data = await self._request("GET", ENDPOINTS["positions"])
        out: list[dict[str, Any]] = []
        for row in rows_of(data):
            position = position_row(row)
            if position is not None:
                out.append(position)
        return out

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        """Плечо по паре. У Binance оно одно на пару - и в одностороннем, и в
        двустороннем режиме: сторонам раздельного плеча биржа не даёт."""
        return await self._request(
            "POST",
            ENDPOINTS["leverage"],
            params={"symbol": symbol_id(symbol), "leverage": str(int(leverage))},
        )

    # ── ордера ──────────────────────────────────────────────────────────────

    async def _check_tradable(self, spec: Instrument) -> None:
        if not spec.tradable:
            raise WeexTradeError(f"Торги по паре {spec.symbol} на Binance остановлены")

    async def _check_size(self, spec: Instrument, quantity: float, price: float | None) -> None:
        """Оба минимума биржи: в монетах и в деньгах.

        Проверяем до постановки и только на входе. Отказ по минимуму приходит
        кодом и без цифр, и ученик видит «заявка отклонена» там, где правда -
        «объём мал».
        """
        if spec.min_qty > 0 and quantity < spec.min_qty:
            raise WeexTradeError(
                f"Объём {_num(quantity)} меньше минимального на Binance ({_num(spec.min_qty)})"
            )
        if spec.min_notional <= 0:
            return
        mark = price if price and price > 0 else await self.last_price(spec.symbol)
        if not mark or mark <= 0:
            # Цену не узнали - молчим: отказать по непроверенному условию хуже,
            # чем дать бирже сказать своё слово.
            return
        value = quantity * mark
        if value < spec.min_notional:
            raise WeexTradeError(
                f"Сумма заявки {_num(value)} USDT меньше минимальной на Binance "
                f"({_num(spec.min_notional)} USDT)"
            )

    def _sides(self, hedge: bool, side: str, position_side: str, closing: bool) -> dict[str, Any]:
        """Как назвать сторону заявки в этом режиме счёта.

        В двустороннем сторона позиции обязательна и `reduceOnly` запрещён; в
        одностороннем наоборот: позиция называется `BOTH`, а закрытие обязано
        быть сокращающим - иначе продажа сверх лонга развернёт позицию вместо
        того, чтобы закрыть её.
        """
        if hedge and position_side in ("LONG", "SHORT"):
            return {"positionSide": position_side}
        params: dict[str, Any] = {"positionSide": "BOTH"}
        if closing:
            params["reduceOnly"] = "true"
        return params

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
    ) -> dict[str, Any]:
        """Поставить ордер. Не повторяется при сбое: повтор - вторая позиция.

        Защита, если её просили, уходит **следом отдельными заявками**:
        приложить её ко входу Binance не умеет. Отказ в защите вход не
        отменяет - позиция уже открыта, и «откатить» её значило бы закрыть
        рынком за счёт ученика; вместо этого пишем тревогу, а стоп достроит
        сопровождение.
        """
        if side not in SIDES:
            raise WeexTradeError(f"Неизвестная сторона: {side}")
        if position_side not in POSITION_SIDES:
            raise WeexTradeError(f"Неизвестная сторона позиции: {position_side}")

        spec = await self._spec(symbol)
        await self._check_tradable(spec)
        hedge = await self._hedge()
        closing = bool(reduce_only) or (
            (side == "SELL" and position_side == "LONG")
            or (side == "BUY" and position_side == "SHORT")
        )

        size = floor_to_step(_f(quantity), spec.step)
        if not closing:
            # Минимумы проверяем только на входе. На выходе они не наши: если
            # от позиции остался хвост меньше минимума, закрыть его всё равно
            # надо, и последнее слово тут за биржей.
            await self._check_size(spec, size, _f(price) if price else None)

        params: dict[str, Any] = {
            "symbol": spec.symbol,
            "side": side,
            "type": "LIMIT" if order_type == "LIMIT" else "MARKET",
            "quantity": _num(size),
            **self._sides(hedge, position_side, position_side, closing),
        }
        if order_type == "LIMIT":
            if price is None:
                raise WeexTradeError("Лимитному ордеру нужна цена")
            params["price"] = price
            params["timeInForce"] = time_in_force or "GTC"

        mark = client_id(self.mark.tag(client_id(client_order_id)))
        if mark:
            params["newClientOrderId"] = mark

        logger.info(
            "Binance ордер %s %s %s %s", spec.symbol, side, params["positionSide"], params["quantity"]
        )
        data = await self._request("POST", ENDPOINTS["order"], params=params)
        row = data if isinstance(data, dict) else {}
        placed = {
            "orderId": str(row.get("orderId") or ""),
            "clientOrderId": client_id(
                self.mark.untag(str(row.get("clientOrderId") or mark))
            ),
        }

        # Защита - вторым запросом. Позиция между ними стоит без стопа доли
        # секунды: приложить его ко входу биржа не даёт.
        if sl_trigger or tp_trigger:
            await self._attach_protection(
                spec=spec,
                hedge=hedge,
                position_side=position_side if position_side in ("LONG", "SHORT") else "LONG",
                quantity=size,
                sl_trigger=sl_trigger,
                tp_trigger=tp_trigger,
                placed=placed,
            )
        return placed

    async def _attach_protection(
        self,
        *,
        spec: Instrument,
        hedge: bool,
        position_side: str,
        quantity: float,
        sl_trigger: str | None,
        tp_trigger: str | None,
        placed: dict[str, Any],
    ) -> None:
        """Поставить стоп и цель следом за входом.

        Ошибку наверх не отдаём: вход уже прошёл, и исключение здесь терминал
        прочитал бы как «заявки нет» - а она есть, и человек остался бы с
        позицией, о которой терминал не знает. Поэтому громко пишем в журнал, и
        сопровождение достроит стоп своим кругом.
        """
        for trigger, plan in ((sl_trigger, "STOP_LOSS"), (tp_trigger, "TAKE_PROFIT")):
            if not trigger:
                continue
            try:
                order = await self.place_tp_sl(
                    symbol=spec.symbol,
                    plan_type=plan,
                    trigger_price=trigger,
                    quantity=_num(quantity),
                    position_side=position_side,
                )
            except WeexTradeError as exc:
                logger.warning(
                    "Binance: защита %s по %s не встала (%s) - позиция без неё, "
                    "ставить будет сопровождение",
                    plan,
                    spec.symbol,
                    exc,
                )
                continue
            # Номер защиты нужен сопровождению: по нему стоп потом переносится
            # и снимается.
            placed["slOrderId" if plan == "STOP_LOSS" else "tpOrderId"] = order.get("orderId", "")

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
    ) -> dict[str, Any]:
        """Условная заявка защиты: стоп или цель, исполнение по рынку.

        Своей ручки для условных заявок у Binance нет - это та же ручка заявки
        с типом `STOP_MARKET` или `TAKE_PROFIT_MARKET`, и висят они в общем
        списке. Метку биржа у них принимает - в отличие от BingX и MEXC.
        """
        spec = await self._spec(symbol)
        await self._check_tradable(spec)
        hedge = await self._hedge()
        long = position_side != "SHORT"
        name = str(plan_type or "").upper()
        stop = "STOP" in name or "LOSS" in name

        working = str(trigger_price_type or "MARK_PRICE").upper()
        if working not in ("MARK_PRICE", "CONTRACT_PRICE"):
            working = "MARK_PRICE" if "MARK" in working else "CONTRACT_PRICE"

        params: dict[str, Any] = {
            "symbol": spec.symbol,
            "side": "SELL" if long else "BUY",
            "type": "STOP_MARKET" if stop else "TAKE_PROFIT_MARKET",
            "stopPrice": trigger_price,
            "workingType": working,
            **self._sides(hedge, position_side, position_side, closing=True),
        }

        size = floor_to_step(_f(quantity), spec.step)
        if stop and size <= 0:
            # Стоп без объёма закрывает позицию целиком - и это лучше объёма:
            # позиция могла подрасти лимиткой, а стоп всё равно накроет её всю.
            params["closePosition"] = "true"
            params.pop("reduceOnly", None)
        else:
            if spec.min_qty > 0 and size < spec.min_qty:
                raise WeexTradeError(
                    f"Объём {_num(size)} меньше минимального на Binance ({_num(spec.min_qty)})"
                )
            params["quantity"] = _num(size)

        mark = client_id(self.mark.tag(client_id(client_algo_id)))
        if mark:
            params["newClientOrderId"] = mark

        data = await self._request("POST", ENDPOINTS["order"], params=params)
        row = data if isinstance(data, dict) else {}
        order_id = str(row.get("orderId") or "")
        own = client_id(self.mark.untag(str(row.get("clientOrderId") or mark)))
        return {"orderId": order_id, "algoId": order_id, "clientAlgoId": own}

    async def modify_tp_sl(
        self,
        *,
        symbol: str,
        order_id: str,
        trigger_price: str,
        execute_price: str | None = None,
        trigger_price_type: str | None = None,
    ) -> Any:
        """Передвинуть условную заявку: поставить новую и снять прежнюю.

        Ручка «изменить на месте» у Binance есть, но только для лимитных
        заявок - условную она не меняет. Порядок именно такой: сначала новая,
        потом снятие старой. Наоборот - это окно, в котором позиция стоит без
        защиты, и рынок этим окном пользуется; лишний же стоп живёт мгновение.
        """
        current = next(
            (
                one
                for one in await self.algo_orders(symbol)
                if str(order_id) == str(one.get("orderId"))
            ),
            None,
        )
        if current is None:
            raise WeexTradeError(f"Заявки {order_id} нет среди условных на Binance")

        placed = await self.place_tp_sl(
            symbol=symbol,
            plan_type=str(current.get("planType") or "STOP_LOSS"),
            trigger_price=trigger_price,
            # Заявка на всю позицию объёма не имеет - и новая не должна иметь
            # его тоже, иначе стоп перестанет накрывать позицию целиком.
            quantity="0" if current.get("closePosition") else str(current.get("quantity") or "0"),
            position_side=str(current.get("positionSide") or "LONG"),
            trigger_price_type=trigger_price_type or "MARK_PRICE",
        )
        try:
            await self.cancel_order(symbol, str(order_id))
        except WeexTradeError as exc:
            # Новая уже стоит: молчать нельзя - на позиции две заявки, и
            # разбирать это будет сопровождение при следующем переносе.
            logger.warning("Прежняя условная заявка %s на Binance не снята: %s", order_id, exc)
        return placed

    async def get_order(self, symbol: str, order_id: str) -> dict[str, Any]:
        params: dict[str, Any] = {"symbol": symbol_id(symbol)}
        if str(order_id).isdigit():
            params["orderId"] = str(order_id)
        else:
            params["origClientOrderId"] = client_id(self.mark.tag(client_id(order_id)))
        data = await self._request("GET", ENDPOINTS["order"], params=params)
        return order_row(data, self.mark) if isinstance(data, dict) and data else {}

    async def _pending(self, symbol: str) -> list[dict[str, Any]]:
        """Висящие заявки пары - как их отдала биржа, одним списком."""
        data = await self._request(
            "GET", ENDPOINTS["open_orders"], params={"symbol": symbol_id(symbol)}
        )
        return rows_of(data) if isinstance(data, list) else []

    async def open_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Обычные заявки: вход лимиткой и всё, что не условное."""
        return [order_row(row, self.mark) for row in await self._pending(symbol) if not is_plan(row)]

    async def algo_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Условные заявки: стоп и цели.

        Тот же список биржи, что и у `open_orders`, но другой его половиной:
        отдельной ручки для условных заявок у Binance нет.
        """
        return [plan_row(row, self.mark) for row in await self._pending(symbol) if is_plan(row)]

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        params: dict[str, Any] = {"symbol": symbol_id(symbol)}
        if str(order_id).isdigit():
            params["orderId"] = str(order_id)
        else:
            params["origClientOrderId"] = client_id(self.mark.tag(client_id(order_id)))
        return await self._request("DELETE", ENDPOINTS["order"], params=params)

    async def cancel_algo_order(self, symbol: str, order_id: str) -> Any:
        """Снять условную заявку. Ручка та же, что у обычной: они одно и то же."""
        return await self.cancel_order(symbol, order_id)

    async def cancel_all_algo(self, symbol: str) -> int:
        """Снять условные заявки пары - по одной, а не все заявки разом.

        У биржи есть ручка «снять всё по паре», но она снимает и лимитку входа
        соседней сделки. Перебираем свои: лишний запрос дешевле снятого входа.
        """
        removed = 0
        for order in await self.algo_orders(symbol):
            order_id = str(order.get("orderId") or "")
            if not order_id:
                continue
            try:
                await self.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s на Binance не снята: %s", order_id, exc)
        return removed

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Исполнения, свежие первыми, в полях WEEX.

        Пара обязательна: без неё Binance исполнений не отдаёт вовсе. Когда её
        не назвали, спрашивать всю биржу нечем - возвращаем пусто, и журнал
        спросит по своей паре сам.
        """
        if not symbol:
            return []
        now = int(time.time() * 1000)
        params: dict[str, Any] = {
            "symbol": symbol_id(symbol),
            "startTime": str(now - TRADES_WINDOW_MS),
            "endTime": str(now),
            "limit": str(min(max(int(limit), 1), 1000)),
        }
        data = await self._request("GET", ENDPOINTS["user_trades"], params=params)

        out: list[dict[str, Any]] = []
        for row in rows_of(data) if isinstance(data, list) else []:
            side = str(row.get("positionSide") or "").upper()
            out.append(
                {
                    "symbol": str(row.get("symbol") or "").upper(),
                    "orderId": str(row.get("orderId") or ""),
                    # В исполнении своего идентификатора Binance не возвращает:
                    # он есть у заявки, а сделка ссылается на неё номером.
                    "clientOrderId": "",
                    "side": str(row.get("side") or "").upper(),
                    "positionSide": side if side in ("LONG", "SHORT") else "",
                    "price": row.get("price") or "",
                    "qty": _num(abs(_f(row.get("qty")))),
                    "commission": _num(abs(_f(row.get("commission")))),
                    "realizedPnl": row.get("realizedPnl") or "0",
                    "time": _i(row.get("time")),
                }
            )
        out.sort(key=lambda one: one["time"], reverse=True)
        return out[:limit]
