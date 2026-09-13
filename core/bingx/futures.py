"""Торговый клиент фьючерсов BingX - третья биржа терминала.

Говорит полями WEEX, как и клиент OKX, и по той же причине: сопровождение
сделок, перенос уровней и журнал написаны по ответам WEEX и читают их поля
(`size`, `cumOpenValue`, `planType`, `realizedPnl`, `commission`). Переписывать
эту логику под каждую биржу значит заново пройти все ошибки, на которых её уже
учили, - а стоят они денег ученика. Сам перевод живёт рядом, в
`core/bingx/market.py`; здесь - решения, которые принимает клиент.

Чем BingX отличается от двух уже подключённых (docs/integrations/bingx-api.md):

* **Объём в монетах.** Контрактов нет вовсе: то, что у OKX стоило отдельного
  слоя арифметики и самых опасных ошибок, здесь не нужно.
* **Два минимума.** `tradeMinQuantity` в монетах и `tradeMinUSDT` в деньгах.
  Проверяем оба до постановки - и только на входе: отказ биржи по минимуму
  выглядит для ученика необъяснимым, а хвост позиции закрыть надо в любом
  случае.
* **Три признака пары из справочника** - `brokerState`, `apiStateOpen`,
  `apiStateClose`. Каждый из них означает отказ, который иначе пришёл бы кодом
  биржи, ничего ученику не объясняющим.
* **Защита при входе** прикладывается к заявке строками с JSON внутри
  (`stopLoss`, `takeProfit`), а не отдельными полями.
* **Метка брокера - заголовком** `X-SOURCE-KEY`, один раз на запрос, а не в
  каждой заявке по отдельности. Поэтому она ставится внутри клиента, а не по
  местам вызова: заголовок легко забыть ровно один раз - в новом месте, где
  создаётся сессия (ТЗ BingX, §7). Засчитала ли биржа метку, видно по эху того
  же заголовка в ответе - пишем об этом в журнал один раз, при первой заявке.
* **Свой идентификатор заявки живёт только у `LIMIT` и `MARKET`.** У стопов и
  целей его нет, и опознавать их приходится номерами, которые вернула биржа
  (`LiveTrade.sl_order_id`, `tp_orders_json`; признак `plans_unlabeled` ниже).
  Всё, что биржа приняла как `clientOrderId`, она переводит в нижний регистр -
  поэтому наши идентификаторы уходят строчными сразу, а сверка
  (`backend/trading/watcher.py`, `client_matches`) регистра не различает.
* **Условных ручек нет.** Стоп и цель ставятся той же ручкой заявки, типом
  `STOP_MARKET`/`TAKE_PROFIT_MARKET`, и висят в общем списке заявок. Поэтому
  `open_orders` и `algo_orders` здесь - два взгляда на один список биржи, а
  «передвинуть условную» разложено на «поставить новую, снять прежнюю».
* **Одну и ту же заявку нельзя подать дважды за секунду** - правило BingX,
  которого нет у других. Повтор при сбое сети запрещён и так, но здесь биржа
  накажет и за невинный дубль от двойного нажатия.

Ошибки - тем же `WeexTradeError`: по нему весь торговый код решает, повторять
запрос или отказывать трейдеру, и второй класс исключений означал бы
пропущенный `except` там, где на кону стоп.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
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
    floor_to_step,
)

# Словарь биржи целиком: имена, подпись, справочник и перевод ответов. Имена
# перечислены поимённо, а не звёздочкой, чтобы было видно, чем клиент
# пользуется - и чтобы остальной код мог брать их отсюда, как раньше.
from core.bingx.market import (  # noqa: F401 - часть имён здесь ради тех, кто импортирует их отсюда
    BASE_URL,
    CLIENT_ID_LIMIT,
    DEFAULT_TAKER_FEE,
    DEMO_URL,
    ENDPOINTS,
    EXCHANGE,
    FILLS_WINDOW_MS,
    INSTRUMENTS_TTL,
    LOW_REMAIN,
    MODE_TTL,
    PLAN_TYPES,
    RETRYABLE_CODES,
    SAME_ORDER_GUARD,
    TRADABLE_STATUS,
    Instrument,
    _bool,
    _f,
    _i,
    _num,
    _rows,
    _unwrap,
    _watch_limits,
    client_id,
    fill_time,
    is_plan,
    load_instruments,
    order_row,
    parse_instrument,
    plan_row,
    position_row,
    DEMO_MARGIN_COIN,
    MARGIN_COIN,
    RECV_WINDOW,
    clock_skew,
    is_clock_error,
    public_filters,
    public_price,
    query_string,
    request_query,
    sign,
    signed_url,
    signing_string,
    stamp,
    sync_clock,
    source_key,
    step_of,
    symbol_id,
    symbol_of,
)
from core.bingx.market import _MODES, _SOURCE_SEEN

logger = logging.getLogger("nmnh.bingx.futures")


class BingxFutures:
    """Торговые операции одного пользователя на BingX.

    Сессия приходит снаружи, как у `WeexFutures`: соединения живут дольше
    запроса, и заводить их по числу учеников нельзя.
    """

    exchange = EXCHANGE

    # При **полном** исполнении приложенная защита встаёт сразу: проверено
    # сделкой на демо-счёте - после рыночного входа на бирже тут же появились
    # обе условные заявки, стоп и цель. Что будет при частичном исполнении
    # лимитки, документация не говорит, и поймать его на демо не вышло.
    #
    # Поэтому признак оставлен включённым: сопровождение проверит, есть ли стоп
    # на набранном объёме, и поставит свой, если его нет (`_ensure_stop`, он же
    # сперва спрашивает биржу и второй стоп рядом не ставит). Ошибка в эту
    # сторону стоит лишнего запроса, ошибка в другую - позиции без стопа.
    stop_waits_full_fill = True

    # Условную заявку на BingX нечем пометить: `clientOrderId` работает только
    # у `LIMIT` и `MARKET`. Значит свою защиту сопровождение узнаёт номером, и
    # номер надо записать, как только позиция открылась, - иначе стоп,
    # приложенный ко входу, останется висеть после закрытия сделки
    # (`backend/trading/watcher.py`, ТЗ BingX, §3.2).
    plans_unlabeled = True

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str | None = None,
        timeout: float = 15.0,
        broker_key: str | None = None,
        demo: bool | None = None,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.timeout = timeout
        # Демо-контур BingX живёт на своём адресе, а не на признаке в
        # заголовке: адрес и решает, учебные деньги или живые.
        self.demo = (
            demo
            if demo is not None
            else os.getenv("BINGX_DEMO", "").strip().lower() in ("1", "true", "yes")
        )
        self.base_url = base_url or (DEMO_URL if self.demo else BASE_URL)
        # Монета счёта: на демо-контуре биржа ведёт его в учебных VST.
        self.margin_coin = DEMO_MARGIN_COIN if self.demo else MARGIN_COIN
        # Метка брокера - из окружения по умолчанию, как у WEEX и OKX: её
        # получат все места, где создаётся клиент. Пусто - заголовка нет вовсе,
        # и поведение не отличается от нынешнего.
        self.source_key = source_key(broker_key)
        self._fee: float | None = None
        # Отпечатки недавних заявок: биржа не принимает одну и ту же дважды за
        # секунду, и ловить это отказом после нажатия «Войти» ни к чему.
        self._recent: dict[tuple, float] = {}

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
        """Подписанный запрос. Параметры BingX ждёт в адресе, а не в теле."""
        data = dict(params or {})
        if signed:
            # Время - с поправкой на часы биржи: расхождение в несколько секунд
            # набегает на любой машине, а биржа отклоняет такие запросы.
            data["timestamp"] = stamp()
            data["recvWindow"] = str(RECV_WINDOW)
        if signed:
            # Подпись считается по строке, отсортированной по ключу и не
            # закодированной - так требует биржа. В адрес уходит та же строка,
            # но со значениями в процентах, когда в ней есть JSON (`stopLoss`,
            # `takeProfit`).
            signing = signing_string(data)
            query = f"{request_query(signing)}&signature={sign(self.creds.secret_key, signing)}"
        else:
            query = query_string(data)
        url = signed_url(self.base_url, path, query)

        headers = {"X-BX-APIKEY": self.creds.api_key}
        if self.source_key:
            # Заголовок ставится здесь, а не по местам вызова: так его получают
            # все заявки разом, включая стопы и цели (ТЗ BingX, §3.1).
            headers["X-SOURCE-KEY"] = self.source_key

        # Бюджет запросов биржи: сверх него ждём очереди, а не ловим отказ
        # (core/throttle.py).
        await take_budget(EXCHANGE, self.creds.api_key)

        session = await self._session_factory()
        try:
            async with session.request(
                method,
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                text = await response.text()
                status = response.status
                _watch_limits(response.headers)
                self._check_source(path, response.headers)
        except aiohttp.ClientError as exc:
            raise WeexTradeError(f"Сеть недоступна: {exc}", retryable=True) from exc
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise WeexTradeError("BingX не ответила вовремя", retryable=True) from exc

        try:
            payload = json.loads(text) if text else {}
        except ValueError as exc:
            raise WeexTradeError(
                f"BingX ответила не JSON ({status})", retryable=status >= 500
            ) from exc

        try:
            return _unwrap(payload, status)
        except WeexTradeError as exc:
            # Отказ по метке времени лечится сам: спрашиваем часы биржи и
            # повторяем - заявка при таком отказе на биржу не попала, значит
            # повтор ничего не задваивает. Один раз: если и со свежими часами
            # не вышло, дело не в них.
            if retried or not is_clock_error(exc):
                raise
            await sync_clock(await self._session_factory(), self.base_url, force=True)
            logger.info("BingX отклонила метку времени - повторяем со сверенными часами")
            return await self._request(
                method, path, params=params, signed=signed, retried=True
            )

    def _check_source(self, path: str, headers: Any) -> None:
        """Засчитала ли биржа метку брокера. Проверяется раз на счёт.

        Биржа возвращает тот же заголовок в ответе - это единственный способ
        узнать, что оборот метится, не дожидаясь отчёта в панели брокера.
        """
        if not self.source_key or path != ENDPOINTS["order"]:
            return
        key = self.creds.api_key
        if key in _SOURCE_SEEN:
            return
        _SOURCE_SEEN.add(key)
        try:
            echo = headers.get("X-SOURCE-KEY")
        except AttributeError:
            echo = None
        if echo == self.source_key:
            logger.info("BingX приняла метку брокера: заявки метятся %s", self.source_key)
        else:
            logger.warning(
                "BingX не вернула метку брокера в ответе на заявку (пришло %r) - "
                "оборот может не засчитаться",
                echo,
            )

    # ── справочник и режим счёта ────────────────────────────────────────────

    async def _specs(self) -> dict[str, Instrument]:
        return await load_instruments(await self._session_factory(), self.base_url)

    async def _spec(self, symbol: str) -> Instrument:
        spec = (await self._specs()).get(symbol_id(symbol))
        if spec is None:
            raise WeexTradeError(f"Пары {symbol} нет среди USDT-фьючерсов BingX")
        return spec

    async def position_mode(self) -> str:
        """`long_short_mode` или `net_mode` - в словах OKX, чтобы читать одинаково."""
        return "long_short_mode" if await self._hedge() else "net_mode"

    async def _hedge(self) -> bool:
        """Двусторонний ли режим позиций. Кэш по ключу, на несколько минут."""
        cached = _MODES.get(self.creds.api_key)
        if cached and time.monotonic() - cached[1] < MODE_TTL:
            return cached[0]
        # Ошибку не глушим. От режима зависит, как уходит заявка: в
        # двустороннем сторона позиции обязательна, в одностороннем - запрещена
        # вместе с `reduceOnly`. Угадав неверно, мы поставили бы заявку не в ту
        # сторону; отказ с понятным текстом честнее.
        data = await self._request("GET", ENDPOINTS["dual"])
        row = data if isinstance(data, dict) else {}
        hedge = _bool(row.get("dualSidePosition"), False)
        _MODES[self.creds.api_key] = (hedge, time.monotonic())
        return hedge

    async def account_uid(self) -> str:
        """Номер счёта на бирже: по нему счёт сверяется с подтверждённым академией.

        Спрашиваем саму биржу, а не ученика: назвать чужой номер он может и по
        ошибке, а ребейт с него уйдёт другому человеку.
        """
        data = await self._request("GET", ENDPOINTS["uid"])
        row = data if isinstance(data, dict) else {}
        return str(row.get("uid") or row.get("id") or "")

    async def taker_fee(self) -> float:
        """Ставка тейкера этого счёта."""
        if self._fee is not None:
            return self._fee
        try:
            data = await self._request("GET", ENDPOINTS["commission"])
            row = data if isinstance(data, dict) else {}
            inner = row.get("commission") if isinstance(row.get("commission"), dict) else row
            rate = abs(_f(inner.get("takerCommissionRate")))
            self._fee = rate if 0 < rate < 0.01 else DEFAULT_TAKER_FEE
        except WeexTradeError as exc:
            logger.debug("Ставка комиссии BingX не получена: %s", exc)
            self._fee = DEFAULT_TAKER_FEE
        return self._fee

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        try:
            spec = await self._spec(symbol)
        except WeexTradeError as exc:
            logger.warning("Шаги %s на BingX не получены: %s", symbol, exc)
            return DEFAULT_FILTERS
        return spec.filters(await self.taker_fee())

    async def last_price(self, symbol: str) -> float | None:
        return await public_price(await self._session_factory(), symbol)

    # ── аккаунт ─────────────────────────────────────────────────────────────

    async def balance(self, margin_coin: str = "") -> list[dict[str, Any]]:
        """Средства счёта в полях WEEX: сколько доступно и сколько всего.

        Монету по умолчанию выбирает контур: на демо BingX ведёт счёт в VST, и
        строки с USDT там нет вовсе. Раньше такой счёт выглядел пустым при ста
        тысячах на нём - и это первое, что видит человек при подключении.
        """
        want = (margin_coin or self.margin_coin).upper()
        data = await self._request("GET", ENDPOINTS["balance"])
        rows = _rows(data, "balance")
        if not rows and isinstance(data, dict):
            inner = data.get("balance")
            rows = [inner] if isinstance(inner, dict) else []

        def as_weex(row: dict[str, Any]) -> dict[str, Any]:
            return {
                "marginCoin": str(row.get("asset") or row.get("currency") or want).upper(),
                "availableBalance": row.get("availableMargin")
                or row.get("availableBalance")
                or row.get("balance")
                or "0",
                "equity": row.get("equity") or row.get("balance") or "0",
            }

        out = [
            as_weex(row)
            for row in rows
            if str(row.get("asset") or row.get("currency") or want).upper() == want
        ]
        if out or not rows:
            return out
        # Биржа назвала другую монету - отдаём то, что есть, а не пустоту:
        # молчаливый ноль на счёте с деньгами хуже незнакомого названия.
        logger.info("BingX ведёт счёт не в %s, а в %s", want, rows[0].get("asset"))
        return [as_weex(rows[0])]

    async def positions(self) -> list[dict[str, Any]]:
        data = await self._request("GET", ENDPOINTS["positions"])
        out: list[dict[str, Any]] = []
        for row in _rows(data, "positions"):
            position = position_row(row)
            if position is not None:
                out.append(position)
        return out

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        """Плечо по паре. В двустороннем режиме оно ставится каждой стороне.

        Односторонняя позиция у BingX называется `BOTH`, и одной заявкой на неё
        плечо ставится целиком; в режиме «лонг и шорт» сторон две, и вторая без
        своего запроса осталась бы с прежним плечом.
        """
        name = symbol_id(symbol)
        sides = ("LONG", "SHORT") if await self._hedge() else ("BOTH",)
        result = None
        for side in sides:
            result = await self._request(
                "POST",
                ENDPOINTS["leverage"],
                params={"symbol": name, "side": side, "leverage": str(int(leverage))},
            )
        return result

    # ── ордера ──────────────────────────────────────────────────────────────

    def _guard_double(self, mark: tuple) -> None:
        """Не дать уйти той же заявке дважды за секунду - это правило BingX.

        Терминал и так не повторяет POST при сбое сети: потерянный ответ - это
        неизвестность, а повтор открывает вторую позицию. Но здесь биржа
        накажет и за невинный дубль - двойное нажатие «Войти», - и отказ придёт
        уже после него. Ловим до отправки, и говорим человеку почему.
        """
        now = time.monotonic()
        for key, at in list(self._recent.items()):
            if now - at > SAME_ORDER_GUARD:
                self._recent.pop(key, None)
        was = self._recent.get(mark)
        if was is not None and now - was <= SAME_ORDER_GUARD:
            raise WeexTradeError(
                "BingX не принимает одну и ту же заявку дважды за секунду - "
                "подождите мгновение и повторите"
            )
        self._recent[mark] = now

    async def _check_tradable(self, spec: Instrument, *, closing: bool) -> None:
        """Можно ли вообще ставить заявку по этой паре, и если нет - почему.

        Всё это биржа сказала бы отказом, но отказ приходит кодом, который
        ученику ничего не объясняет: «пара закрыта для брокерских
        пользователей» и «api state» выглядят как поломка терминала.
        """
        if not spec.tradable:
            raise WeexTradeError(f"Торги по паре {symbol_of(spec.symbol)} на BingX остановлены")
        if spec.broker_closed and self.source_key:
            # Запрет касается брокерских пользователей. Пока метки брокера нет,
            # мы обычный партнёр, и заявка пройдёт - отказывать не за что.
            raise WeexTradeError(
                f"Пара {symbol_of(spec.symbol)} закрыта для брокерских счетов на BingX"
            )
        if closing and not spec.api_close:
            raise WeexTradeError(
                f"Закрытие {symbol_of(spec.symbol)} по API на BingX сейчас запрещено"
            )
        if not closing and not spec.api_open:
            raise WeexTradeError(
                f"Открытие {symbol_of(spec.symbol)} по API на BingX сейчас запрещено"
            )

    async def _check_size(self, spec: Instrument, quantity: float, price: float | None) -> None:
        """Оба минимума биржи: в монетах и в деньгах.

        Проверяем до постановки и только на входе. Отказ по минимуму приходит
        кодом и без цифр, и ученик видит «заявка отклонена» там, где правда -
        «объём мал».
        """
        if spec.min_qty > 0 and quantity < spec.min_qty:
            raise WeexTradeError(
                f"Объём {_num(quantity)} меньше минимального на BingX ({_num(spec.min_qty)})"
            )
        if spec.min_notional <= 0:
            return
        mark = price if price and price > 0 else await self.last_price(symbol_of(spec.symbol))
        if not mark or mark <= 0:
            # Цену не узнали - молчим: отказать по непроверенному условию хуже,
            # чем дать бирже сказать своё слово.
            return
        value = quantity * mark
        if value < spec.min_notional:
            raise WeexTradeError(
                f"Сумма заявки {_num(value)} USDT меньше минимальной на BingX "
                f"({_num(spec.min_notional)} USDT)"
            )

    @staticmethod
    def _protection(kind: str, trigger: str) -> str:
        """Стоп или цель, приложенные ко входу: строка с JSON внутри.

        Именно строка - так эту пару полей ждёт биржа. Исполнение по рынку:
        защита обязана сработать, а не встать лимиткой у цены, которую рынок
        уже прошёл.
        """
        return json.dumps(
            {"type": kind, "stopPrice": _f(trigger), "workingType": "MARK_PRICE"},
            separators=(",", ":"),
        )

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
        hedge = await self._hedge()
        closing = (side == "SELL" and position_side == "LONG") or (
            side == "BUY" and position_side == "SHORT"
        )
        await self._check_tradable(spec, closing=closing)

        size = floor_to_step(_f(quantity), spec.step)
        if not (closing or reduce_only):
            # Минимумы проверяем только на входе. На выходе они не наши: если
            # от позиции остался хвост меньше минимума, закрыть его всё равно
            # надо, и последнее слово тут за биржей - отказать самим значит
            # оставить ученика с позицией, которую он просил закрыть.
            await self._check_size(spec, size, _f(price) if price else None)

        params: dict[str, Any] = {
            "symbol": spec.symbol,
            "side": side,
            "type": "LIMIT" if order_type == "LIMIT" else "MARKET",
            "quantity": _num(size),
        }
        if order_type == "LIMIT":
            if price is None:
                raise WeexTradeError("Лимитному ордеру нужна цена")
            params["price"] = price
            params["timeInForce"] = time_in_force or "GTC"
        elif time_in_force:
            params["timeInForce"] = time_in_force

        if hedge and position_side in ("LONG", "SHORT"):
            params["positionSide"] = position_side
        else:
            # В одностороннем режиме сторона позиции у BingX называется BOTH, а
            # продажа сверх лонга разворачивает позицию, а не закрывает её:
            # закрытие обязано быть сокращающим.
            params["positionSide"] = "BOTH"
            if closing or reduce_only:
                params["reduceOnly"] = "true"

        mark = client_id(client_order_id)
        if mark:
            # Своя метка живёт только у LIMIT и MARKET - здесь как раз они.
            params["clientOrderID"] = mark

        # Защита уходит тем же ордером: между двумя запросами позиция стояла бы
        # без стопа.
        if sl_trigger:
            params["stopLoss"] = self._protection("STOP_MARKET", sl_trigger)
        if tp_trigger:
            params["takeProfit"] = self._protection("TAKE_PROFIT_MARKET", tp_trigger)

        self._guard_double(
            (spec.symbol, side, params.get("positionSide"), params["type"], params["quantity"], price)
        )
        logger.info(
            "BingX ордер %s %s %s %s", spec.symbol, side, params.get("positionSide"), params["quantity"]
        )
        data = await self._request("POST", ENDPOINTS["order"], params=params)
        row = data.get("order") if isinstance(data, dict) and isinstance(data.get("order"), dict) else data
        row = row if isinstance(row, dict) else {}
        return {
            "orderId": str(row.get("orderId") or ""),
            "clientOrderId": client_id(row.get("clientOrderID") or row.get("clientOrderId") or mark),
        }

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

        Своей ручки для условных заявок у BingX нет - это та же ручка заявки с
        типом `STOP_MARKET` или `TAKE_PROFIT_MARKET`. Метку (`client_algo_id`)
        биржа у таких заявок не принимает вовсе: она приходит и уходит впустую,
        и опознавать заявку потом придётся номером, который биржа вернёт.
        """
        spec = await self._spec(symbol)
        await self._check_tradable(spec, closing=True)
        size = floor_to_step(_f(quantity), spec.step)
        if spec.min_qty > 0 and size < spec.min_qty:
            raise WeexTradeError(
                f"Объём {_num(size)} меньше минимального на BingX ({_num(spec.min_qty)})"
            )

        long = position_side == "LONG"
        name = str(plan_type or "").upper()
        stop = "STOP" in name or "LOSS" in name
        kind = "STOP_MARKET" if stop else "TAKE_PROFIT_MARKET"
        working = str(trigger_price_type or "MARK_PRICE").upper()
        if working not in ("MARK_PRICE", "CONTRACT_PRICE", "INDEX_PRICE"):
            working = "MARK_PRICE" if "MARK" in working else "CONTRACT_PRICE"

        params: dict[str, Any] = {
            "symbol": spec.symbol,
            "side": "SELL" if long else "BUY",
            "type": kind,
            "quantity": _num(size),
            "stopPrice": trigger_price,
            "workingType": working,
        }
        if await self._hedge():
            params["positionSide"] = "LONG" if long else "SHORT"
        else:
            # Односторонний режим: защита обязана быть сокращающей, иначе
            # сработавший стоп развернёт позицию вместо того, чтобы закрыть её.
            params["positionSide"] = "BOTH"
            params["reduceOnly"] = "true"

        self._guard_double((spec.symbol, params["side"], kind, params["quantity"], trigger_price))
        data = await self._request("POST", ENDPOINTS["order"], params=params)
        row = data.get("order") if isinstance(data, dict) and isinstance(data.get("order"), dict) else data
        row = row if isinstance(row, dict) else {}
        order_id = str(row.get("orderId") or "")
        # Номер - единственное, чем эту заявку потом можно найти: метки у неё
        # нет (ТЗ BingX, §3.2). Возвращаем его и как `orderId`, и как `algoId`,
        # чтобы сопровождение читало все биржи одним кодом.
        return {"orderId": order_id, "algoId": order_id, "clientAlgoId": ""}

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

        Ручки «изменить на месте» у условных заявок BingX нет. Порядок именно
        такой: сначала новая, потом снятие старой. Наоборот - это окно, в
        котором позиция стоит без защиты, и рынок этим окном пользуется; лишний
        же стоп живёт мгновение и снимается следом.
        """
        current = next(
            (o for o in await self.algo_orders(symbol) if str(order_id) == str(o.get("orderId"))),
            None,
        )
        if current is None:
            raise WeexTradeError(f"Заявки {order_id} нет среди условных на BingX")

        placed = await self.place_tp_sl(
            symbol=symbol,
            plan_type=str(current.get("planType") or "STOP_LOSS"),
            trigger_price=trigger_price,
            quantity=str(current.get("quantity") or "0"),
            position_side=str(current.get("positionSide") or "LONG"),
            execute_price=execute_price or "0",
            trigger_price_type=trigger_price_type or "MARK_PRICE",
        )
        try:
            await self.cancel_order(symbol, str(order_id))
        except WeexTradeError as exc:
            # Новая уже стоит: молчать нельзя - на позиции две заявки, и
            # разбирать это будет сопровождение при следующем переносе.
            logger.warning("Прежняя условная заявка %s на BingX не снята: %s", order_id, exc)
        return placed

    async def get_order(self, symbol: str, order_id: str) -> dict[str, Any]:
        params: dict[str, Any] = {"symbol": symbol_id(symbol)}
        if str(order_id).isdigit():
            params["orderId"] = str(order_id)
        else:
            params["clientOrderID"] = client_id(order_id)
        data = await self._request("GET", ENDPOINTS["order"], params=params)
        row = data.get("order") if isinstance(data, dict) and isinstance(data.get("order"), dict) else data
        return order_row(row) if isinstance(row, dict) and row else {}

    async def _pending(self, symbol: str) -> list[dict[str, Any]]:
        """Висящие заявки пары - как их отдала биржа, одним списком."""
        data = await self._request(
            "GET", ENDPOINTS["open_orders"], params={"symbol": symbol_id(symbol)}
        )
        return _rows(data, "orders")

    async def open_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Обычные заявки: вход лимиткой и всё, что не условное."""
        return [order_row(row) for row in await self._pending(symbol) if not is_plan(row)]

    async def algo_orders(self, symbol: str) -> list[dict[str, Any]]:
        """Условные заявки: стоп и цели.

        Тот же список биржи, что и у `open_orders`, но другой его половиной:
        отдельной ручки для условных заявок у BingX нет.
        """
        return [plan_row(row) for row in await self._pending(symbol) if is_plan(row)]

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        params: dict[str, Any] = {"symbol": symbol_id(symbol)}
        if str(order_id).isdigit():
            params["orderId"] = str(order_id)
        else:
            params["clientOrderID"] = client_id(order_id)
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
                logger.warning("Условная заявка %s на BingX не снята: %s", order_id, exc)
        return removed

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Исполнения, свежие первыми, в полях WEEX.

        Окно обязательно - биржа без него не отвечает, - и меру объёма надо
        назвать самим: `tradingUnit=COIN` значит монеты, ровно то, чем считает
        весь остальной код. Комиссия приходит со знаком минус (удержание); в
        журнал идёт её величина.
        """
        now = int(time.time() * 1000)
        params: dict[str, Any] = {
            "tradingUnit": "COIN",
            "startTs": str(now - FILLS_WINDOW_MS),
            "endTs": str(now),
        }
        if symbol:
            params["symbol"] = symbol_id(symbol)
        data = await self._request("GET", ENDPOINTS["fills"], params=params)
        rows = _rows(data, "fill_orders")

        out: list[dict[str, Any]] = []
        for row in rows:
            name = str(row.get("symbol") or symbol_id(symbol or "")).upper()
            side = str(row.get("positionSide") or "").upper()
            fee = _f(row.get("commission"))
            out.append(
                {
                    "symbol": symbol_of(name),
                    "orderId": str(row.get("orderId") or ""),
                    "clientOrderId": client_id(row.get("clientOrderID") or row.get("clientOrderId")),
                    "side": str(row.get("side") or "").upper(),
                    "positionSide": side if side in ("LONG", "SHORT") else "",
                    "price": row.get("price") or "",
                    "qty": _num(abs(_f(row.get("volume") or row.get("qty")))),
                    "commission": _num(abs(fee)),
                    "realizedPnl": row.get("profit") or row.get("realisedProfit") or "0",
                    "time": fill_time(row),
                }
            )
        out.sort(key=lambda one: one["time"], reverse=True)
        return out[:limit]

