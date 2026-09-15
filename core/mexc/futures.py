"""Торговый клиент фьючерсов MEXC - четвёртая биржа терминала.

Говорит полями WEEX, как клиенты OKX и BingX, и по той же причине:
сопровождение сделок, перенос уровней и журнал написаны по ответам WEEX и
читают их поля (`size`, `cumOpenValue`, `planType`, `realizedPnl`,
`commission`). Переписывать эту логику под каждую биржу значит заново пройти
все ошибки, на которых её уже учили, - а стоят они денег ученика. Сам перевод
живёт рядом, в `core/mexc/market.py`; здесь - решения, которые принимает
клиент.

Чем MEXC отличается от трёх подключённых (ТЗ MEXC, §3):

* **Объём в контрактах.** Как у OKX, но размер контракта свой у каждой пары
  (у `BTC_USDT` - 0.0001 BTC). Промах в переводе меняет позицию в сотни раз -
  это самая дорогая ошибка адаптера, и потому перевод заперт в `Instrument`.
* **Сторона и действие - одним числом** от 1 до 4. Ни у одной другой биржи
  такого нет: там сторона и `reduceOnly` разведены. Перепутать - значит
  открыть вторую позицию там, где закрывали первую.
* **Подпись считается от `apiKey + время + параметры`**, а у POST параметры -
  это тело JSON ровно в том виде, в каком оно уходит.
* **Окно годности - десять секунд.** Вдвое уже, чем просит клиент BingX, и
  расхождение часов этой машины (4.3 секунды) съедает половину. Поэтому часы
  сверяются с биржей, а не берутся с машины.
* **Защита прикладывается ко входу** полями `stopLossPrice` и
  `takeProfitPrice`, как у WEEX и BingX.
* **Стоп переносится одной ручкой** (`/stoporder/change_price`) - без снятия и
  повторной постановки, как приходится на BingX. Окна, в котором позиция стоит
  без защиты, здесь не возникает вовсе.
* **У заявки есть наша метка** (`externalOid`) и свои ручки поиска и отмены по
  ней. Это снимает главную боль BingX - но только у обычных заявок: защита
  привязана к позиции, и метки у неё нет.

Ошибки - тем же `WeexTradeError`: по нему весь торговый код решает, повторять
запрос или отказывать трейдеру, и второй класс исключений означал бы
пропущенный `except` там, где на кону стоп.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.throttle import take as take_budget
from core.weex.futures import (
    DEFAULT_FILTERS,
    POSITION_SIDES,
    SIDES,
    Credentials,
    WeexTradeError,
)

# Словарь биржи целиком: имена, подпись, справочник и перевод ответов. Имена
# перечислены поимённо, а не звёздочкой, чтобы было видно, чем клиент
# пользуется - и чтобы остальной код мог брать их отсюда, как раньше.
from core.mexc.market import (  # noqa: F401 - часть имён здесь ради тех, кто импортирует их отсюда
    BASE_URL,
    CLIENT_ID_LIMIT,
    CLOSE_LONG,
    CLOSE_SHORT,
    DEALS_WINDOW_MS,
    DEFAULT_TAKER_FEE,
    ENDPOINTS,
    EXCHANGE,
    INSTRUMENTS_TTL,
    LEGACY_URL,
    MARGIN_COIN,
    MODE_HEDGE,
    MODE_ONE_WAY,
    MODE_TTL,
    OPEN_CROSS,
    OPEN_ISOLATED,
    OPEN_LONG,
    OPEN_SHORT,
    ORDER_LIMIT_TYPE,
    ORDER_MARKET_TYPE,
    RECV_WINDOW,
    RETRYABLE_CODES,
    TRADABLE_STATE,
    Instrument,
    _f,
    _i,
    _num,
    body_string,
    clear_caches,
    client_id,
    clock_skew,
    is_clock_error,
    load_instruments,
    order_row,
    parse_instrument,
    plan_row,
    plan_rows,
    position_row,
    public_filters,
    public_price,
    query_string,
    request_url,
    rows_of,
    side_code,
    sides_of,
    sign,
    signing_string,
    stamp,
    symbol_id,
    symbol_of,
    sync_clock,
    unwrap,
)
from core.mexc.market import _MODES

logger = logging.getLogger("nmnh.mexc.futures")


class MexcFutures:
    """Торговые операции одного пользователя на MEXC.

    Сессия приходит снаружи, как у `WeexFutures`: соединения живут дольше
    запроса, и заводить их по числу учеников нельзя.
    """

    exchange = EXCHANGE

    # Ставится ли приложенная защита при частичном исполнении лимитки,
    # документация MEXC не говорит, а проверить это можно только живой сделкой
    # (ТЗ §6). Признак включён: сопровождение спросит биржу, есть ли стоп на
    # набранном объёме, и поставит свой, если его нет. Ошибка в эту сторону
    # стоит лишнего запроса, ошибка в другую - позиции без стопа.
    stop_waits_full_fill = True

    # Защита MEXC привязана к позиции, а не к нашей метке: `externalOid` есть
    # только у обычных заявок. Значит свой стоп сопровождение узнаёт номером,
    # и номер надо записать, как только позиция открылась - как на BingX
    # (`backend/trading/watcher.py`).
    plans_unlabeled = True

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str | None = None,
        timeout: float = 15.0,
        broker_key: str | None = None,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.timeout = timeout
        self.base_url = base_url or BASE_URL
        self.margin_coin = MARGIN_COIN
        # Брокерской метки у MEXC пока нет: есть ли у биржи аналог `X-SOURCE-KEY`
        # у BingX, спрашиваем у партнёрского менеджера (ТЗ §4.5). Поле принято
        # заранее, чтобы включение стоило строки, а не правки по местам вызова.
        self.broker_key = str(broker_key or "").strip()
        self._fee: float | None = None
        # Ручка заявки у биржи в двух написаниях. Какое живёт на этом счёте,
        # выясняется первым же отказом - и второй раз мы туда не ходим.
        self._order_path = ENDPOINTS["order"]
        # Плечо по паре, каким мы сами его выставили. Заявка на открытие обязана
        # нести плечо в теле, а лишний запрос к бирже перед каждым входом стоит
        # времени в самый неподходящий момент.
        self._leverage: dict[str, int] = {}

    # ── запрос ──────────────────────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | list | None = None,
        retried: bool = False,
    ) -> Any:
        """Подписанный запрос.

        У GET и DELETE подписывается строка параметров, отсортированная по
        ключу; у POST - тело JSON ровно в том виде, в каком оно уходит. Тело
        собирается один раз и уходит строкой: пересобранное библиотекой, оно
        разошлось бы с подписью, и биржа ответила бы отказом, в котором про
        тело не будет ни слова.
        """
        timestamp = stamp()
        payload = ""
        query = ""
        if body is not None:
            payload = body_string(body)
        elif params:
            query = signing_string(params)
            payload = query

        headers = {
            "ApiKey": self.creds.api_key,
            "Request-Time": timestamp,
            "Signature": sign(self.creds.secret_key, self.creds.api_key, timestamp, payload),
            "Recv-Window": str(RECV_WINDOW),
            "Content-Type": "application/json",
        }

        # Бюджет запросов биржи: сверх него ждём очереди, а не ловим отказ
        # (core/throttle.py).
        await take_budget(EXCHANGE, self.creds.api_key)

        session = await self._session_factory()
        url = request_url(self.base_url, path, query)
        try:
            async with session.request(
                method,
                url,
                data=payload if body is not None else None,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                text = await response.text()
                status = response.status
        except aiohttp.ClientError as exc:
            raise WeexTradeError(f"Сеть недоступна: {exc}", retryable=True) from exc
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise WeexTradeError("MEXC не ответила вовремя", retryable=True) from exc

        try:
            data = json.loads(text) if text else {}
        except ValueError as exc:
            raise WeexTradeError(
                f"MEXC ответила не JSON ({status})", retryable=status >= 500
            ) from exc

        try:
            return unwrap(data, status)
        except WeexTradeError as exc:
            # Отказ по метке времени лечится сам: спрашиваем часы биржи и
            # повторяем - запрос при таком отказе до биржи не дошёл, значит
            # повтор ничего не задваивает. Один раз: если и со сверенными
            # часами не вышло, дело не в них.
            if retried or not is_clock_error(exc):
                raise
            await sync_clock(await self._session_factory(), self.base_url, force=True)
            logger.info("MEXC отклонила метку времени - повторяем со сверенными часами")
            return await self._request(method, path, params=params, body=body, retried=True)

    # ── справочник и режим счёта ────────────────────────────────────────────

    async def _specs(self) -> dict[str, Instrument]:
        return await load_instruments(await self._session_factory(), self.base_url)

    async def _spec(self, symbol: str) -> Instrument:
        spec = (await self._specs()).get(symbol_id(symbol))
        if spec is None:
            raise WeexTradeError(f"Пары {symbol} нет среди USDT-фьючерсов MEXC")
        return spec

    async def position_mode(self) -> str:
        """`long_short_mode` или `net_mode` - в словах OKX, чтобы читать одинаково."""
        return "long_short_mode" if await self._hedge() else "net_mode"

    async def _hedge(self) -> bool:
        """Двусторонний ли режим позиций. Кэш по ключу, на несколько минут.

        Ошибку не глушим. От режима зависит, как уходит заявка на закрытие: в
        одностороннем режиме позиция одна, и номер её биржа выбирает сама.
        Угадав неверно, мы закрыли бы не ту сторону.
        """
        cached = _MODES.get(self.creds.api_key)
        if cached and time.monotonic() - cached[1] < MODE_TTL:
            return cached[0]
        data = await self._request("GET", ENDPOINTS["position_mode"])
        value = data.get("positionMode") if isinstance(data, dict) else data
        hedge = _i(value) == MODE_HEDGE
        _MODES[self.creds.api_key] = (hedge, time.monotonic())
        return hedge

    async def taker_fee(self) -> float:
        """Ставка тейкера этого счёта.

        Отдельной ручки комиссии у MEXC нет: ставка стоит в справочнике пары.
        Берём её у BTC - у остальных пар она та же, а разница уровня VIP
        приходит в справочнике целиком.
        """
        if self._fee is not None:
            return self._fee
        try:
            spec = await self._spec("BTCUSDT")
            rate = abs(spec.taker)
            self._fee = rate if 0 < rate < 0.01 else DEFAULT_TAKER_FEE
        except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
            logger.debug("Ставка комиссии MEXC не получена: %s", exc)
            self._fee = DEFAULT_TAKER_FEE
        return self._fee

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        try:
            spec = await self._spec(symbol)
        except WeexTradeError as exc:
            logger.warning("Шаги %s на MEXC не получены: %s", symbol, exc)
            return DEFAULT_FILTERS
        return spec.filters(await self.taker_fee())

    async def last_price(self, symbol: str) -> float | None:
        return await public_price(await self._session_factory(), symbol)

    # ── аккаунт ─────────────────────────────────────────────────────────────

    async def account_uid(self) -> str:
        """Номер счёта на бирже.

        Отдельной ручки «кто я» у MEXC нет. Счета учеников сверяются с
        подтверждением академии по номеру, который называет партнёрский отчёт,
        - поэтому здесь пусто, а не выдуманное значение: пустую строку
        подключение понимает как «биржа номера не дала» (`backend/trading/connect.py`).
        """
        return ""

    async def balance(self, margin_coin: str = "") -> list[dict[str, Any]]:
        """Средства счёта в полях WEEX: сколько доступно и сколько всего."""
        want = (margin_coin or self.margin_coin).upper()
        data = await self._request("GET", ENDPOINTS["assets"])
        rows = rows_of(data)
        if not rows and isinstance(data, dict):
            rows = [data]

        def as_weex(row: dict[str, Any]) -> dict[str, Any]:
            return {
                "marginCoin": str(row.get("currency") or want).upper(),
                "availableBalance": row.get("availableBalance") or "0",
                "equity": row.get("equity") or row.get("availableBalance") or "0",
            }

        return [row for row in map(as_weex, rows) if row["marginCoin"] == want]

    async def positions(self) -> list[dict[str, Any]]:
        data = await self._request("GET", ENDPOINTS["positions"])
        specs = await self._specs()
        out: list[dict[str, Any]] = []
        for row in rows_of(data):
            position = position_row(row, specs.get(str(row.get("symbol") or "").upper()))
            if position is not None:
                out.append(position)
        return out

    async def _position_of(self, symbol: str, position_side: str) -> dict[str, Any] | None:
        """Открытая позиция по паре и стороне. Нужна закрытию и защите."""
        name = symbol_of(symbol_id(symbol))
        side = str(position_side or "").upper()
        for row in await self.positions():
            if row["symbol"] != name:
                continue
            if side in ("LONG", "SHORT") and row["positionSide"] != side:
                continue
            return row
        return None

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        """Плечо по паре.

        MEXC меняет плечо у **открытой позиции** по её номеру, а до открытия -
        по паре и способу маржи. Позиции ещё нет - значит второй путь, и обе
        стороны разом: вторая без своего запроса осталась бы с прежним плечом.
        """
        name = symbol_id(symbol)
        value = int(leverage)
        # Запоминаем до запроса: заявке плечо нужно тем же числом, каким его
        # только что поставил терминал, и спрашивать его у биржи заново незачем.
        self._leverage[name] = value
        position = await self._position_of(symbol, "")
        if position and position.get("positionId"):
            return await self._request(
                "POST",
                ENDPOINTS["leverage"],
                body={"positionId": _i(position["positionId"]), "leverage": value},
            )
        result = None
        for position_type in (1, 2):
            result = await self._request(
                "POST",
                ENDPOINTS["leverage"],
                body={
                    "symbol": name,
                    "leverage": value,
                    "openType": OPEN_ISOLATED,
                    "positionType": position_type,
                },
            )
        return result

    async def leverage_of(self, symbol: str, long: bool = True) -> int:
        """Плечо, с которым биржа откроет позицию по этой паре.

        Сначала своё - то, что выставил терминал перед входом. Его нет (сделку
        ведёт сопровождение после перезапуска, плечо меняли из приложения
        биржи) - спрашиваем биржу: у MEXC плечо своё у каждой стороны, и
        `positionType` различает длинную и короткую.
        """
        name = symbol_id(symbol)
        mine = self._leverage.get(name)
        if mine:
            return mine
        rows = await self._request(
            "GET", ENDPOINTS["leverage_info"], params={"symbol": name}
        )
        want = 1 if long else 2
        for row in rows or []:
            if _i(row.get("positionType")) == want and _i(row.get("leverage")) > 0:
                value = _i(row.get("leverage"))
                self._leverage[name] = value
                return value
        return 0

    # ── ордера ──────────────────────────────────────────────────────────────

    async def _check_tradable(self, spec: Instrument) -> None:
        """Торгуется ли пара вообще. Иначе отказ биржи кодом ничего не объяснит."""
        if not spec.tradable:
            raise WeexTradeError(f"Торги по паре {symbol_of(spec.symbol)} на MEXC остановлены")

    async def _order(self, body: dict[str, Any]) -> dict[str, Any]:
        """Отправить заявку, зная про два написания ручки.

        Первый отказ по неизвестному адресу переключает клиент на прежнее
        написание навсегда - повтор идёт один раз и только на этот отказ:
        заявка при нём до биржи не дошла, значит вторая позиция не откроется.
        """
        try:
            data = await self._request("POST", self._order_path, body=body)
        except WeexTradeError as exc:
            if self._order_path == ENDPOINTS["order_legacy"] or not _unknown_path(exc):
                raise
            self._order_path = ENDPOINTS["order_legacy"]
            logger.info("MEXC не знает ручку заявки %s - переходим на прежнюю", ENDPOINTS["order"])
            data = await self._request("POST", self._order_path, body=body)
        if isinstance(data, dict):
            return {"orderId": str(data.get("orderId") or data.get("id") or "")}
        return {"orderId": str(data or "")}

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
        """Поставить ордер. Не повторяется при сбое: повтор - вторая позиция."""
        if side not in SIDES:
            raise WeexTradeError(f"Неизвестная сторона: {side}")
        if position_side not in POSITION_SIDES:
            raise WeexTradeError(f"Неизвестная сторона позиции: {position_side}")

        spec = await self._spec(symbol)
        await self._check_tradable(spec)

        # Сторона позиции `BOTH` приходит из одностороннего режима других бирж.
        # У MEXC стороны в числе, и «обе» там нет: для закрытия сторону берём у
        # самой позиции, для входа считаем лонгом - как и на других биржах.
        wanted = position_side if position_side in ("LONG", "SHORT") else ""
        closing = bool(reduce_only) or (
            (wanted == "LONG" and side == "SELL") or (wanted == "SHORT" and side == "BUY")
        )
        position = await self._position_of(symbol, wanted) if closing else None
        if closing and position is not None:
            wanted = position["positionSide"]
        code = side_code(side, wanted or ("LONG" if side == "BUY" else "SHORT"))

        contracts = spec.to_contracts(_f(quantity))
        if contracts < spec.min_vol:
            raise WeexTradeError(
                f"Объём {_num(_f(quantity))} меньше минимального на MEXC "
                f"({_num(spec.to_coins(spec.min_vol))})"
            )

        body: dict[str, Any] = {
            "symbol": spec.symbol,
            "vol": contracts,
            "side": code,
            "type": ORDER_LIMIT_TYPE if order_type == "LIMIT" else ORDER_MARKET_TYPE,
            "openType": _i(position.get("openType")) if position else OPEN_ISOLATED,
        }
        if order_type == "LIMIT":
            if price is None:
                raise WeexTradeError("Лимитному ордеру нужна цена")
            body["price"] = _f(price)
        if position is not None and position.get("positionId"):
            # Закрытие адресуется номером позиции: в двустороннем режиме по
            # паре и стороне биржа не поймёт, какую из двух закрывать.
            body["positionId"] = _i(position["positionId"])
        else:
            # Открытие в изолированной марже обязано нести плечо в теле заявки.
            # Без него биржа отвечает «Leverage multiplier must be within the
            # upper limit 500 and lower limit 1» (код 2006) - и вход не проходит
            # вовсе. На записанных ответах этого не видно: там плечо никто не
            # проверяет, и живой вход упирался в отказ.
            if _i(body["openType"]) == OPEN_ISOLATED:
                lever = await self.leverage_of(symbol, long=(wanted or "LONG") == "LONG")
                if lever <= 0:
                    raise WeexTradeError(
                        f"MEXC не назвала плечо по паре {symbol} - заявку на открытие "
                        "без него биржа не примет"
                    )
                body["leverage"] = lever

        mark = client_id(client_order_id)
        if mark:
            body["externalOid"] = mark

        # Защита уходит тем же ордером: между двумя запросами позиция стояла бы
        # без стопа.
        if sl_trigger:
            body["stopLossPrice"] = _f(sl_trigger)
        if tp_trigger:
            body["takeProfitPrice"] = _f(tp_trigger)

        logger.info(
            "MEXC ордер %s side=%s %s контрактов (%s монет)",
            spec.symbol,
            code,
            _num(contracts),
            _num(spec.to_coins(contracts)),
        )
        placed = await self._order(body)
        return {"orderId": placed["orderId"], "clientOrderId": mark}

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
        """Условная заявка защиты: стоп или цель на открытую позицию.

        Ставится **своей ручкой** (`stoporder/place`), а не заявкой с ценой
        защиты. Разница в этом месте стоила бы ученику позиции: обычная заявка
        с полем `takeProfitPrice` уходит на биржу рыночной и исполняется в тот
        же миг - на живом счёте так и вышло, цель, поставленная сопровождением,
        закрыла позицию по рынку через четыре секунды после входа.

        Защита у MEXC - одна запись на позицию, со своими ценой и объёмом у
        стопа и у цели. Объём здесь - объём защиты, а не всей позиции: лестница
        целей закрывает позицию частями, и биржа обязана знать, какую именно.
        """
        spec = await self._spec(symbol)
        await self._check_tradable(spec)
        position = await self._position_of(symbol, position_side)
        if position is None:
            raise WeexTradeError(f"Позиции {symbol} на MEXC нет - защиту ставить не на что")

        long = str(position["positionSide"]).upper() == "LONG"
        contracts = spec.to_contracts(_f(quantity))
        if contracts < spec.min_vol:
            raise WeexTradeError(
                f"Объём защиты {_num(_f(quantity))} меньше минимального на MEXC "
                f"({_num(spec.to_coins(spec.min_vol))})"
            )

        name = str(plan_type or "").upper()
        stop = "STOP" in name or "LOSS" in name
        body: dict[str, Any] = {
            "symbol": spec.symbol,
            "positionId": _i(position.get("positionId")),
            "vol": contracts,
        }
        body["stopLossPrice" if stop else "takeProfitPrice"] = _f(trigger_price)
        data = await self._request("POST", ENDPOINTS["stop_place"], body=body)
        order_id = str(data if isinstance(data, (str, int)) else (data or {}).get("id") or "")
        # Метки у защиты MEXC нет: она привязана к позиции. Возвращаем номер и
        # как `orderId`, и как `algoId`, чтобы сопровождение читало все биржи
        # одним кодом.
        return {"orderId": order_id, "algoId": order_id, "clientAlgoId": ""}

    async def _stop_record(self, symbol: str, order_id: str) -> dict[str, Any] | None:
        """Сырая запись защиты по её номеру: в ней обе цены и объём."""
        name = symbol_id(symbol)
        data = await self._request(
            "GET",
            ENDPOINTS["stop_orders"],
            params={"symbol": name, "is_finished": 0, "page_num": 1, "page_size": 100},
        )
        for row in rows_of(data):
            if str(row.get("id")) == str(order_id) or str(row.get("orderId")) == str(order_id):
                return row
        return None

    async def modify_tp_sl(
        self,
        *,
        symbol: str,
        order_id: str,
        trigger_price: str,
        execute_price: str | None = None,
        trigger_price_type: str | None = None,
    ) -> Any:
        """Передвинуть защиту: снять прежнюю и поставить новую.

        Ручки «поменять цену» у защиты позиции биржа не даёт, хотя на первый
        взгляд их две. Обе проверены живым счётом, и обе не годятся:
        `change_price` отвечает `success` и не двигает ничего - цена в списке
        остаётся прежней, а сопровождение считает стоп перенесённым;
        `change_plan_price` отказывает кодом 5002. Прежде здесь стояла первая, и
        перенос стопа в безубыток на MEXC молча не работал вовсе.

        Значит перенос в два шага, как на BingX, и окно без защиты здесь тоже
        есть - короткое, между снятием и постановкой.

        Вторую цену переносим как была: защита у MEXC - одна запись со стопом и
        целью сразу, и поставить только стоп значит потерять цель.
        """
        record = await self._stop_record(symbol, order_id)
        if record is None:
            raise WeexTradeError(f"Заявки {order_id} нет среди условных на MEXC")

        stop_price = _f(record.get("stopLossPrice"))
        take_price = _f(record.get("takeProfitPrice"))
        # Двигаем то, что в записи есть. Терминал зовёт эту ручку ради переноса
        # стопа в безубыток, и стоп в записи всегда стоит первым по важности.
        moving_stop = stop_price > 0
        body: dict[str, Any] = {
            "symbol": symbol_id(symbol),
            "positionId": _i(record.get("positionId")),
            "vol": _i(record.get("vol")) or 1,
        }
        if moving_stop:
            body["stopLossPrice"] = _f(trigger_price)
            if take_price > 0:
                body["takeProfitPrice"] = take_price
        else:
            body["takeProfitPrice"] = _f(trigger_price)

        # Прежние цены - на случай, если новая постановка не пройдёт. Между
        # снятием и постановкой позиция стоит без защиты вовсе, и оставлять её
        # так нельзя: биржа не умеет менять защиту, только снимать и ставить
        # заново (проверено на живом счёте 14 сентября).
        previous: dict[str, Any] = {
            key: body[key] for key in ("symbol", "positionId", "vol") if key in body
        }
        if stop_price > 0:
            previous["stopLossPrice"] = stop_price
        if take_price > 0:
            previous["takeProfitPrice"] = take_price

        await self.cancel_algo_order(symbol, str(record.get("id")))
        try:
            data = await self._request("POST", ENDPOINTS["stop_place"], body=body)
        except WeexTradeError as exc:
            # Возвращаем прежнюю защиту теми же ценами. Вышло - сделка осталась
            # со старым стопом, и это честный отказ переноса. Не вышло - об этом
            # надо кричать: позиция осталась голой.
            back = "прежняя защита возвращена"
            try:
                await self._request("POST", ENDPOINTS["stop_place"], body=previous)
            except WeexTradeError as second:
                back = f"вернуть прежнюю не вышло: {second}"
                logger.error(
                    "MEXC %s: защита снята, новая не встала, прежняя не вернулась (%s)",
                    symbol,
                    second,
                )
            raise WeexTradeError(
                f"{exc} ({back})", code=exc.code, retryable=exc.retryable
            ) from exc
        new_id = str(data if isinstance(data, (str, int)) else (data or {}).get("id") or "")
        return {"orderId": new_id, "algoId": new_id, "clientAlgoId": ""}

    async def get_order(self, symbol: str, order_id: str) -> dict[str, Any]:
        """Заявка по номеру или по нашей метке - у каждой свой адрес ручки."""
        spec = (await self._specs()).get(symbol_id(symbol))
        if str(order_id).isdigit():
            path = f"{ENDPOINTS['order_get']}/{order_id}"
        else:
            path = f"{ENDPOINTS['order_external']}/{symbol_id(symbol)}/{client_id(order_id)}"
        data = await self._request("GET", path)
        return order_row(data, spec) if isinstance(data, dict) and data else {}

    async def open_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Висящие заявки пары: вход лимиткой и всё, что не защита."""
        spec = (await self._specs()).get(symbol_id(symbol))
        data = await self._request("GET", f"{ENDPOINTS['open_orders']}/{symbol_id(symbol)}")
        return [order_row(row, spec) for row in rows_of(data)]

    async def algo_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Условные заявки: стоп и цели. У MEXC для них своя ручка.

        Биржа держит стоп и цель одной записью с двумя ценами, а терминал
        считает их разными заявками - поэтому запись раскладывается на две
        (`plan_rows`).
        """
        spec = (await self._specs()).get(symbol_id(symbol))
        name = symbol_id(symbol)
        data = await self._request(
            "GET",
            ENDPOINTS["stop_orders"],
            params={"symbol": name, "is_finished": 0, "page_num": 1, "page_size": 100},
        )
        out: list[dict[str, Any]] = []
        for row in rows_of(data):
            if str(row.get("symbol") or "").upper() != name:
                continue
            out.extend(plan_rows(row, spec))
        return out

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        """Снять обычную заявку - по номеру или по нашей метке.

        Метку биржа принимает своей ручкой, и это единственная из четырёх
        бирж, где снять заявку по нашему имени можно без предварительного
        поиска её номера.
        """
        if str(order_id).isdigit():
            return await self._request("POST", ENDPOINTS["cancel"], body=[_i(order_id)])
        return await self._request(
            "POST",
            ENDPOINTS["cancel_external"],
            body={"symbol": symbol_id(symbol), "externalOid": client_id(order_id)},
        )

    async def cancel_algo_order(self, symbol: str, order_id: str) -> Any:
        """Снять защиту. Ручка своя: обычная отмена такую заявку не знает."""
        return await self._request(
            "POST",
            ENDPOINTS["stop_cancel"],
            body=[{"symbol": symbol_id(symbol), "stopPlanOrderId": _i(order_id)}],
        )

    async def cancel_all_algo(self, symbol: str) -> int:
        """Снять защиту пары - по одной заявке, а не все разом.

        У биржи есть «снять всё по паре», но снимать лестницу целей соседней
        сделки нельзя: лишний запрос дешевле снятой цели.
        """
        removed = 0
        seen: set[str] = set()
        for order in await self.algo_orders(symbol):
            order_id = str(order.get("orderId") or "")
            if not order_id or order_id in seen:
                # Стоп и цель одной записи носят один номер: снимаем такую
                # запись один раз - вторая отмена вернула бы отказ на пустом
                # месте.
                continue
            seen.add(order_id)
            try:
                await self.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s на MEXC не снята: %s", order_id, exc)
        return removed

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Исполнения, свежие первыми, в полях WEEX.

        Объём биржа называет в контрактах - переводим в монеты здесь же, иначе
        журнал посчитает чужие числа. Окно обязательно: без него биржа отдаёт
        только последние сутки.
        """
        specs = await self._specs()
        now = int(time.time() * 1000)
        params: dict[str, Any] = {
            "start_time": now - DEALS_WINDOW_MS,
            "end_time": now,
            "page_num": 1,
            "page_size": min(max(int(limit), 1), 100),
        }
        if symbol:
            params["symbol"] = symbol_id(symbol)
        data = await self._request("GET", ENDPOINTS["deals"], params=params)

        out: list[dict[str, Any]] = []
        for row in rows_of(data):
            name = str(row.get("symbol") or "").upper()
            spec = specs.get(name)
            side, position_side = sides_of(row.get("side"))
            vol = _f(row.get("vol"))
            out.append(
                {
                    "symbol": symbol_of(name),
                    "orderId": str(row.get("orderId") or ""),
                    "clientOrderId": client_id(row.get("externalOid")),
                    "side": side,
                    "positionSide": position_side,
                    "price": row.get("price") or "",
                    "qty": _num(spec.to_coins(vol) if spec else vol),
                    "commission": _num(abs(_f(row.get("fee")))),
                    "realizedPnl": row.get("profit") or "0",
                    "time": _i(row.get("timestamp")),
                }
            )
        out.sort(key=lambda one: one["time"], reverse=True)
        return out[:limit]


def _unknown_path(exc: WeexTradeError) -> bool:
    """Отказ «такой ручки нет»: адрес заявки у биржи сменился, а не запрос плох."""
    text = str(exc).lower()
    return str(exc.code) in ("404", "1000") or "not found" in text or "not exist" in text
