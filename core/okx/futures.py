"""Торговый клиент фьючерсов OKX - вторая биржа терминала.

Сопровождение сделок, перенос уровней и журнал написаны по ответам WEEX и
читают их поля: `size`, `cumOpenValue`, `planType`, `clientAlgoId`,
`realizedPnl`, `commission`. Переписывать эту логику под вторую биржу значит
заново пройти все ошибки, на которых её уже учили, - а она и так стоит денег
ученика. Поэтому клиент OKX говорит тем же языком: на вход берёт то же, что
`WeexFutures`, а ответы биржи переводит в поля WEEX. Для остального кода это
просто ещё один клиент.

Что при этом переводится и где легко ошибиться:

* **Объём.** OKX считает свопы в контрактах, а не в монетах: у BTC-USDT-SWAP
  контракт - 0.01 BTC. Всё, что уходит на биржу, делится на размер контракта
  и округляется вниз до шага лота; всё, что приходит, умножается обратно.
  Перепутать - значит поставить стоп на объём в сто раз больше позиции.
* **Инструмент.** `BTCUSDT` на OKX называется `BTC-USDT-SWAP`.
* **Сторона.** В режиме «лонг и шорт» сторона позиции идёт в `posSide`, в
  одностороннем - её нет, и закрытие обязано быть сокращающим, иначе оно
  развернёт позицию.
* **Метки.** `clOrdId` и `algoClOrdId` принимают только буквы и цифры, до 32
  знаков. Всё прочее из нашего идентификатора вычищается; сравнивать свои
  заявки нужно в том же очищенном виде (`backend/trading/watcher.py`,
  `client_matches`).
* **Брокер.** Метка брокера у OKX не приписывается к идентификатору, а живёт в
  отдельном поле `tag` (до 16 букв и цифр) - в каждой заявке и условной заявке.

Ошибки - тем же `WeexTradeError`: по нему весь торговый код решает, повторять
запрос или отказывать трейдеру, и второй класс исключений означал бы
пропущенный `except` там, где на кону стоп.

Ордер при сбое сети не повторяется - по той же причине, что и у WEEX:
потерянный ответ на POST это неизвестность, а повтор открывает вторую позицию.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from core.throttle import take as take_budget
from core.weex.futures import (
    DEFAULT_FILTERS,
    POSITION_SIDES,
    SIDES,
    Credentials,
    WeexTradeError,
    floor_to_step,
)

logger = logging.getLogger("nmnh.okx.futures")

EXCHANGE = "okx"
BASE_URL = "https://www.okx.com"

ENDPOINTS = {
    "balance": "/api/v5/account/balance",
    "positions": "/api/v5/account/positions",
    "config": "/api/v5/account/config",
    "leverage": "/api/v5/account/set-leverage",
    "fee": "/api/v5/account/trade-fee",
    "instruments": "/api/v5/public/instruments",
    "ticker": "/api/v5/market/ticker",
    "order": "/api/v5/trade/order",
    "cancel_order": "/api/v5/trade/cancel-order",
    "open_orders": "/api/v5/trade/orders-pending",
    "fills": "/api/v5/trade/fills",
    "algo_order": "/api/v5/trade/order-algo",
    "cancel_algos": "/api/v5/trade/cancel-algos",
    "amend_algos": "/api/v5/trade/amend-algos",
    "algo_orders": "/api/v5/trade/orders-algo-pending",
}

# Пределы идентификаторов по правилам OKX: только буквы и цифры.
CLIENT_ID_LIMIT = 32
TAG_LIMIT = 16

# Ставка тейкера по умолчанию для USDT-свопов нулевого уровня. Настоящая ставка
# счёта спрашивается у биржи (`taker_fee`), эта - на случай молчания.
DEFAULT_TAKER_FEE = 0.0005

# Коды, при которых запрос можно повторить: перегрузка, лимит частоты, таймаут
# на стороне биржи. Отказ по существу повторять бессмысленно.
# 50102 - «запрос устарел по времени»: часы сервера ушли, повтор с новой
# отметкой проходит.
RETRYABLE_CODES = {"50001", "50004", "50011", "50013", "50026", "50061", "50102"}

# Сколько живёт справочник инструментов в памяти процесса. Состав меняется
# редко, а запрос тяжёлый - но новый листинг не должен ждать перезапуска.
INSTRUMENTS_TTL = 3600.0

# Режим позиций счёта трейдер меняет раз в жизни, а спрашивать его на каждый
# проход сопровождения - лишний запрос на каждого ученика.
MODE_TTL = 600.0

# Сколько страниц исполнений собираем за раз: по сто строк на страницу.
FILLS_PAGE = 100
FILLS_MAX_PAGES = 5

_NOT_ALNUM = re.compile(r"[^A-Za-z0-9]")


def client_id(value: str | None) -> str:
    """Идентификатор заявки в том виде, в каком его примет OKX."""
    return _NOT_ALNUM.sub("", str(value or ""))[:CLIENT_ID_LIMIT]


def broker_tag(code: str | None) -> str:
    """Код брокера для поля `tag`. Пусто - мы на OKX ещё не брокер."""
    return _NOT_ALNUM.sub("", str(code or ""))[:TAG_LIMIT]


def inst_id(symbol: str) -> str:
    """`BTCUSDT` -> `BTC-USDT-SWAP`. Уже записанный по-окексовски не трогаем."""
    text = str(symbol or "").upper().strip()
    if text.endswith("-SWAP"):
        return text
    if text.endswith("USDT") and len(text) > 4:
        return f"{text[:-4]}-USDT-SWAP"
    return text


def symbol_of(instrument: str) -> str:
    """`BTC-USDT-SWAP` -> `BTCUSDT`: так инструмент знает терминал."""
    parts = str(instrument or "").upper().split("-")
    return f"{parts[0]}{parts[1]}" if len(parts) >= 2 else str(instrument or "").upper()


def timestamp() -> str:
    """Время запроса: ISO 8601 в UTC с миллисекундами и буквой Z."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def signed_url(base_url: str, request_path: str) -> URL:
    """Адрес запроса ровно в том виде, в каком он подписан.

    `encoded=True` здесь обязателен. Без него библиотека адресов перекодирует
    строку запроса по-своему - `%2C` она возвращает запятой, - а подпись
    считается по пути со строкой запроса. Биржа тогда считает её от другого
    текста и отвечает «Invalid Sign». Виднее всего это на списке условных
    заявок: `ordType=conditional,oco` - как раз тот случай.
    """
    return URL(f"{base_url}{request_path}", encoded=True)


def sign(secret: str, stamp: str, method: str, request_path: str, body: str) -> str:
    """Подпись запроса: HMAC-SHA256 от времени, метода, пути и тела, в Base64.

    Путь - вместе со строкой запроса, ровно в том виде, в каком он уходит в
    URL: у GET параметры считаются частью пути, а не тела.
    """
    message = f"{stamp}{method.upper()}{request_path}{body}"
    digest = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _num(value: float) -> str:
    """Число строкой, без экспоненты и двоичного хвоста."""
    return f"{round(value, 10):.10f}".rstrip("0").rstrip(".") or "0"


def _digits_only(value: str) -> bool:
    return bool(value) and value.isdigit()


@dataclass(frozen=True)
class Instrument:
    """Свойства свопа, без которых нельзя перевести монеты в контракты."""

    inst_id: str
    ct_val: float
    lot_sz: float
    min_sz: float
    tick_sz: float
    max_leverage: float
    max_limit_sz: float

    def to_contracts(self, coins: float) -> float:
        """Монеты в контракты - вниз до шага лота: больше риска, чем просили, нельзя."""
        if not (coins > 0) or not (self.ct_val > 0):
            return 0.0
        return floor_to_step(coins / self.ct_val, self.lot_sz or 1.0)

    def to_coins(self, contracts: float) -> float:
        return round(abs(contracts) * self.ct_val, 10)

    def filters(self, taker_fee: float = DEFAULT_TAKER_FEE) -> dict[str, float]:
        """Шаги инструмента в монетах - в том же виде, что у WEEX."""
        step = round(self.lot_sz * self.ct_val, 12) or DEFAULT_FILTERS["step"]
        return {
            "step": step,
            "tick": self.tick_sz or DEFAULT_FILTERS["tick"],
            "min_qty": round(self.min_sz * self.ct_val, 12) or step,
            "max_leverage": self.max_leverage or DEFAULT_FILTERS["max_leverage"],
            "taker_fee": taker_fee,
            "max_qty": round(self.max_limit_sz * self.ct_val, 12),
            "max_position": 0.0,
        }


# Состояние инструмента, при котором на нём можно торговать. Остальные:
# `suspend` - торги остановлены, `preopen` - контракт объявлен, но ещё не
# открыт, `test` - тестовая пара, сделки по ней не принимаются вовсе.
TRADABLE_STATE = "live"


def parse_instrument(row: dict[str, Any]) -> Instrument | None:
    """Строка справочника OKX -> свойства свопа. Не USDT-своп - не наш.

    Нерабочий инструмент в справочник не берём. Он там встречается: биржа
    выкладывает новый контракт заранее в состоянии `preopen`, а остановленный
    оставляет в `suspend`. Для нас это одно и то же - сделку не поставить, - а
    в списке монет такой инструмент выглядел бы обычным, и ученик узнавал бы
    правду только отказом биржи.
    """
    name = str(row.get("instId") or "").upper()
    if not name.endswith("-USDT-SWAP"):
        return None
    state = str(row.get("state") or "").strip().lower()
    # Пустое состояние - ответ биржи без этого поля: раньше его не было, и
    # отбрасывать по нему весь справочник нельзя.
    if state and state != TRADABLE_STATE:
        return None
    ct_val = _f(row.get("ctVal"))
    if ct_val <= 0:
        return None
    return Instrument(
        inst_id=name,
        ct_val=ct_val,
        lot_sz=_f(row.get("lotSz")) or 1.0,
        min_sz=_f(row.get("minSz")) or _f(row.get("lotSz")) or 1.0,
        tick_sz=_f(row.get("tickSz")),
        max_leverage=_f(row.get("lever")),
        max_limit_sz=_f(row.get("maxLmtSz")),
    )


def position_row(row: dict[str, Any], spec: Instrument | None) -> dict[str, Any] | None:
    """Позиция OKX в полях WEEX. Пусто - позиции нет или инструмент не наш.

    Отдельной функцией, а не внутри запроса: тем же переводом пользуется
    приватный поток позиций (`core/okx/stream.py`), и разойтись этим двум
    местам нельзя - сопровождение читает результат как одно и то же.
    """
    contracts = _f(row.get("pos"))
    name = str(row.get("instId") or "").upper()
    if contracts == 0 or spec is None:
        return None
    side = str(row.get("posSide") or "").lower()
    if side not in ("long", "short"):
        side = "long" if contracts > 0 else "short"
    size = spec.to_coins(contracts)
    avg = _f(row.get("avgPx"))
    position = {
        "symbol": symbol_of(name),
        "instId": name,
        "side": side.upper(),
        "positionSide": side.upper(),
        "size": _num(size),
        "leverage": row.get("lever") or "",
        "markPrice": row.get("markPx") or "",
        "unrealizePnl": row.get("upl") or "0",
        "liquidatePrice": row.get("liqPx") or "",
        "marginSize": row.get("margin") or row.get("imr") or "",
        "averageOpenPrice": row.get("avgPx") or "",
        # Средняя цена входа у сопровождения - стоимость на объём.
        "cumOpenSize": _num(size),
        "cumOpenValue": _num(avg * size),
    }
    # Безубыток OKX считает сама, с комиссией: терминал обязан быть зеркалом
    # биржи, а не спорить с ней своей формулой.
    if _f(row.get("bePx")) > 0:
        position["breakEvenPrice"] = row.get("bePx")
    return position


_INSTRUMENTS: dict[str, Instrument] = {}
_INSTRUMENTS_AT = 0.0
_MODES: dict[str, tuple[str, float]] = {}


def _unwrap(payload: Any, status: int) -> Any:
    """Разобрать конверт ответа: `{"code": "0", "msg": "", "data": [...]}`.

    Пакетные ручки отвечают кодом «1» или «2» и называют причину в строке
    каждой заявки (`sCode`, `sMsg`). Сообщение берём оттуда: общее «операция
    не удалась» трейдеру ничего не объясняет.
    """
    if not isinstance(payload, dict):
        if status >= 400:
            raise WeexTradeError(
                f"OKX вернула {status}", code=status, retryable=status == 429 or status >= 500
            )
        return payload

    rows = payload.get("data")
    code = str(payload.get("code") if payload.get("code") is not None else "0")
    failed = next(
        (
            row
            for row in rows or []
            if isinstance(row, dict) and str(row.get("sCode") or "0") not in ("0", "")
        ),
        None,
    ) if isinstance(rows, list) else None

    if code != "0" or failed is not None:
        item_code = str(failed.get("sCode")) if failed else ""
        message = (failed.get("sMsg") if failed else "") or payload.get("msg") or "OKX отклонила запрос"
        use = item_code or code
        raise WeexTradeError(
            str(message),
            code=use,
            retryable=use in RETRYABLE_CODES or status == 429 or status >= 500,
        )
    if status >= 400:
        raise WeexTradeError(
            f"OKX вернула {status}", code=status, retryable=status == 429 or status >= 500
        )
    return rows if rows is not None else payload


async def _public_get(session, path: str, params: dict[str, Any], base_url: str = BASE_URL) -> Any:
    """Открытая ручка без подписи: справочник и цена."""
    query = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    url = signed_url(base_url, path + (f"?{query}" if query else ""))
    async with session.request("GET", url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        text = await resp.text()
        status = resp.status
    try:
        payload = json.loads(text) if text else {}
    except ValueError as exc:
        raise WeexTradeError(f"OKX ответила не JSON ({status})", retryable=status >= 500) from exc
    return _unwrap(payload, status)


async def load_instruments(session, base_url: str = BASE_URL) -> dict[str, Instrument]:
    """Справочник USDT-свопов, из памяти процесса, пока он свежий."""
    global _INSTRUMENTS_AT
    if _INSTRUMENTS and time.monotonic() - _INSTRUMENTS_AT < INSTRUMENTS_TTL:
        return _INSTRUMENTS
    rows = await _public_get(session, ENDPOINTS["instruments"], {"instType": "SWAP"}, base_url)
    fresh = {spec.inst_id: spec for spec in (parse_instrument(r) for r in rows or []) if spec}
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
        logger.warning("Справочник OKX не получен: %s", exc)
        return DEFAULT_FILTERS
    spec = specs.get(inst_id(symbol))
    return spec.filters() if spec else DEFAULT_FILTERS


async def public_price(session, symbol: str) -> float | None:
    """Последняя цена свопа без ключей."""
    try:
        rows = await _public_get(session, ENDPOINTS["ticker"], {"instId": inst_id(symbol)})
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.warning("Цена %s на OKX не получена: %s", symbol, exc)
        return None
    price = _f((rows or [{}])[0].get("last")) if isinstance(rows, list) and rows else 0.0
    return price if price > 0 else None


class OkxFutures:
    """Торговые операции одного пользователя на OKX.

    Сессия приходит снаружи, как у `WeexFutures`: соединения живут дольше
    запроса, и заводить их по числу учеников нельзя.
    """

    exchange = EXCHANGE

    # Стоп, приложенный ко входу (`attachAlgoOrds`), OKX выставляет только
    # после **полного** исполнения заявки. Частично исполнившаяся лимитка -
    # это позиция без стопа, и ставить его обязано сопровождение
    # (backend/trading/watcher.py, `_ensure_stop`).
    stop_waits_full_fill = True

    def __init__(
        self,
        creds: Credentials,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = BASE_URL,
        timeout: float = 15.0,
        broker_code: str | None = None,
        demo: bool | None = None,
    ):
        self.creds = creds
        self._session_factory = session_factory
        self.base_url = base_url
        self.timeout = timeout
        # Код брокера - из окружения по умолчанию, как и у WEEX: его получат все
        # места, где создаётся клиент. Пусто - заявки уходят без него.
        self.tag = broker_tag(
            broker_code if broker_code is not None else os.getenv("OKX_BROKER_CODE", "")
        )
        # Демо-счёт OKX: те же ручки, но деньги учебные. Проверять адаптер на
        # живом счёте ученика нельзя.
        self.demo = (
            demo
            if demo is not None
            else os.getenv("OKX_DEMO", "").strip().lower() in ("1", "true", "yes")
        )
        self._fee: float | None = None

    # ── запрос ──────────────────────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: Any = None,
    ) -> Any:
        query = urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")})
        request_path = path + (f"?{query}" if query else "")
        # Тело подписывается ровно тем текстом, что уходит: пересборка с другими
        # пробелами - другая подпись.
        body = json.dumps(data, separators=(",", ":"), ensure_ascii=False) if data is not None else ""
        stamp = timestamp()
        headers = {
            "OK-ACCESS-KEY": self.creds.api_key,
            "OK-ACCESS-SIGN": sign(self.creds.secret_key, stamp, method, request_path, body),
            "OK-ACCESS-TIMESTAMP": stamp,
            "OK-ACCESS-PASSPHRASE": self.creds.passphrase,
            "Content-Type": "application/json",
        }
        if self.demo:
            headers["x-simulated-trading"] = "1"

        # Бюджет запросов биржи: сверх него ждём очереди, а не ловим отказ
        # (core/throttle.py).
        await take_budget(EXCHANGE, self.creds.api_key)

        session = await self._session_factory()
        try:
            async with session.request(
                method,
                signed_url(self.base_url, request_path),
                data=body.encode("utf-8") if body else None,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.timeout),
            ) as response:
                text = await response.text()
                status = response.status
        except aiohttp.ClientError as exc:
            raise WeexTradeError(f"Сеть недоступна: {exc}", retryable=True) from exc
        except (TimeoutError, asyncio.TimeoutError) as exc:
            raise WeexTradeError("OKX не ответила вовремя", retryable=True) from exc

        try:
            payload = json.loads(text) if text else {}
        except ValueError as exc:
            raise WeexTradeError(f"OKX ответила не JSON ({status})", retryable=status >= 500) from exc
        return _unwrap(payload, status)

    # ── справочник и режим счёта ────────────────────────────────────────────

    async def _specs(self) -> dict[str, Instrument]:
        return await load_instruments(await self._session_factory(), self.base_url)

    async def _spec(self, symbol: str) -> Instrument:
        spec = (await self._specs()).get(inst_id(symbol))
        if spec is None:
            raise WeexTradeError(f"Инструмента {symbol} нет среди USDT-свопов OKX")
        return spec

    async def position_mode(self) -> str:
        """`long_short_mode` или `net_mode`. Кэш по ключу, на несколько минут."""
        cached = _MODES.get(self.creds.api_key)
        if cached and time.monotonic() - cached[1] < MODE_TTL:
            return cached[0]
        rows = await self._request("GET", ENDPOINTS["config"])
        mode = str((rows or [{}])[0].get("posMode") or "net_mode") if rows else "net_mode"
        _MODES[self.creds.api_key] = (mode, time.monotonic())
        return mode

    async def _hedge(self) -> bool:
        return (await self.position_mode()) == "long_short_mode"

    async def account_uid(self) -> str:
        """Номер счёта на бирже. По нему счёт сверяется с подтверждёнными академией.

        Спрашиваем саму биржу, а не ученика: назвать чужой номер ученик может и
        по ошибке, а ребейт с него уйдёт другому человеку.
        """
        rows = await self._request("GET", ENDPOINTS["config"])
        row = (rows or [{}])[0] if isinstance(rows, list) and rows else {}
        return str(row.get("uid") or "")

    async def can_trade(self) -> bool | None:
        """Есть ли у ключа право торговать. `None` - биржа не сказала.

        OKX выдаёт право торговли не всякому ключу: пока на счёте меньше ста
        долларов, ключ создаётся **только на чтение**. Наша проверка при
        подключении спрашивает баланс, а чтение как раз разрешено - счёт
        подключался успешно, и отказ приходил позже, в момент заявки, где
        объяснить его уже некому.

        Права биржа называет в конфигурации счёта, полем `perm`:
        `read_only,trade` или одно `read_only`.
        """
        rows = await self._request("GET", ENDPOINTS["config"])
        row = (rows or [{}])[0] if isinstance(rows, list) and rows else {}
        perm = str(row.get("perm") or "")
        if not perm:
            # Поля нет - молчание биржи не повод отказывать в подключении.
            return None
        return "trade" in {part.strip().lower() for part in perm.split(",")}

    async def taker_fee(self) -> float:
        """Ставка тейкера этого счёта. OKX отдаёт её со знаком минус - это удержание."""
        if self._fee is not None:
            return self._fee
        try:
            rows = await self._request("GET", ENDPOINTS["fee"], params={"instType": "SWAP"})
            row = (rows or [{}])[0] if rows else {}
            rate = abs(_f(row.get("takerU") or row.get("taker")))
            self._fee = rate if 0 < rate < 0.01 else DEFAULT_TAKER_FEE
        except WeexTradeError as exc:
            logger.debug("Ставка комиссии OKX не получена: %s", exc)
            self._fee = DEFAULT_TAKER_FEE
        return self._fee

    async def symbol_filters(self, symbol: str) -> dict[str, float]:
        try:
            spec = await self._spec(symbol)
        except WeexTradeError as exc:
            logger.warning("Шаги %s на OKX не получены: %s", symbol, exc)
            return DEFAULT_FILTERS
        return spec.filters(await self.taker_fee())

    async def last_price(self, symbol: str) -> float | None:
        return await public_price(await self._session_factory(), symbol)

    # ── аккаунт ─────────────────────────────────────────────────────────────

    async def balance(self, margin_coin: str = "USDT") -> list[dict[str, Any]]:
        rows = await self._request("GET", ENDPOINTS["balance"], params={"ccy": margin_coin})
        account = (rows or [{}])[0] if isinstance(rows, list) and rows else {}
        out = []
        for item in account.get("details") or []:
            if str(item.get("ccy") or "").upper() != margin_coin.upper():
                continue
            out.append(
                {
                    "marginCoin": margin_coin.upper(),
                    # Сколько можно пустить в сделку: у единого счёта это
                    # availEq, у простого - availBal.
                    "availableBalance": item.get("availEq") or item.get("availBal") or item.get("cashBal") or "0",
                    "equity": item.get("eq") or "0",
                }
            )
        if not out and account:
            out.append(
                {"marginCoin": margin_coin.upper(), "availableBalance": "0", "equity": account.get("totalEq") or "0"}
            )
        return out

    async def positions(self) -> list[dict[str, Any]]:
        rows = await self._request("GET", ENDPOINTS["positions"], params={"instType": "SWAP"})
        specs = await self._specs()
        out: list[dict[str, Any]] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            position = position_row(row, specs.get(str(row.get("instId") or "").upper()))
            if position is not None:
                out.append(position)
        return out

    async def set_leverage(self, symbol: str, leverage: int, margin_coin: str = "USDT") -> Any:
        """Плечо по монете в кросс-режиме: в нём терминал и ставит заявки."""
        return await self._request(
            "POST",
            ENDPOINTS["leverage"],
            data={"instId": inst_id(symbol), "lever": str(int(leverage)), "mgnMode": "cross"},
        )

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
    ) -> dict[str, Any]:
        """Поставить ордер. Не повторяется при сбое: повтор - вторая позиция."""
        if side not in SIDES:
            raise WeexTradeError(f"Неизвестная сторона: {side}")
        if position_side not in POSITION_SIDES:
            raise WeexTradeError(f"Неизвестная сторона позиции: {position_side}")

        spec = await self._spec(symbol)
        contracts = spec.to_contracts(_f(quantity))
        if contracts < spec.min_sz:
            raise WeexTradeError(
                f"Объём {quantity} меньше минимального на OKX ({_num(spec.to_coins(spec.min_sz))})"
            )
        hedge = await self._hedge()

        data: dict[str, Any] = {
            "instId": spec.inst_id,
            "tdMode": "cross",
            "side": side.lower(),
            "ordType": "limit" if order_type == "LIMIT" else "market",
            "sz": _num(contracts),
        }
        if order_type == "LIMIT":
            if price is None:
                raise WeexTradeError("Лимитному ордеру нужна цена")
            data["px"] = price

        closing = (side == "SELL" and position_side == "LONG") or (
            side == "BUY" and position_side == "SHORT"
        )
        if hedge and position_side in ("LONG", "SHORT"):
            data["posSide"] = position_side.lower()
        elif not hedge and (closing or reduce_only):
            # В одностороннем режиме стороны позиции нет, и продажа сверх лонга
            # открывает шорт. Закрытие обязано быть сокращающим.
            data["reduceOnly"] = True

        mark = client_id(client_order_id)
        if mark:
            data["clOrdId"] = mark
        if self.tag:
            data["tag"] = self.tag

        # Стоп уходит тем же ордером: между двумя запросами позиция стояла бы
        # без защиты. После исполнения OKX заводит его условной заявкой сама.
        attached: dict[str, Any] = {}
        if sl_trigger:
            attached.update(slTriggerPx=sl_trigger, slOrdPx="-1", slTriggerPxType="mark")
        if tp_trigger:
            attached.update(tpTriggerPx=tp_trigger, tpOrdPx="-1", tpTriggerPxType="mark")
        if attached:
            data["attachAlgoOrds"] = [attached]

        logger.info("OKX ордер %s %s %s %s конт.", spec.inst_id, side, position_side, data["sz"])
        rows = await self._request("POST", ENDPOINTS["order"], data=data)
        first = (rows or [{}])[0] if isinstance(rows, list) and rows else {}
        return {"orderId": str(first.get("ordId") or ""), "clientOrderId": str(first.get("clOrdId") or "")}

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
        """Условная заявка защиты: стоп или цель, исполнение по рынку."""
        spec = await self._spec(symbol)
        contracts = spec.to_contracts(_f(quantity))
        if contracts < spec.min_sz:
            raise WeexTradeError(
                f"Объём {quantity} меньше минимального на OKX ({_num(spec.to_coins(spec.min_sz))})"
            )
        hedge = await self._hedge()
        long = position_side == "LONG"

        data: dict[str, Any] = {
            "instId": spec.inst_id,
            "tdMode": "cross",
            "side": "sell" if long else "buy",
            "ordType": "conditional",
            "sz": _num(contracts),
            # Заявка привязана к позиции: закрылась позиция целиком - биржа
            # снимает её сама. Иначе цели и стоп оставались бы висеть на пустом
            # объёме и открыли бы позицию заново, стоило цене до них дойти.
            "cxlOnClosePos": True,
        }
        if hedge:
            data["posSide"] = "long" if long else "short"
        else:
            # Действует только в одностороннем режиме; в режиме «лонг и шорт»
            # сторону закрытия задаёт posSide, и биржа поле не читает.
            data["reduceOnly"] = True

        kind = {"MARK_PRICE": "mark", "LAST_PRICE": "last", "INDEX_PRICE": "index"}.get(
            str(trigger_price_type or "").upper(), "mark"
        )
        order_px = "-1" if _f(execute_price) <= 0 else str(execute_price)
        name = str(plan_type or "").upper()
        if "STOP" in name or "LOSS" in name:
            data.update(slTriggerPx=trigger_price, slOrdPx=order_px, slTriggerPxType=kind)
        else:
            data.update(tpTriggerPx=trigger_price, tpOrdPx=order_px, tpTriggerPxType=kind)

        mark = client_id(client_algo_id)
        if mark:
            data["algoClOrdId"] = mark
        if self.tag:
            data["tag"] = self.tag

        rows = await self._request("POST", ENDPOINTS["algo_order"], data=data)
        first = (rows or [{}])[0] if isinstance(rows, list) and rows else {}
        algo = str(first.get("algoId") or "")
        return {"orderId": algo, "algoId": algo, "clientAlgoId": str(first.get("algoClOrdId") or mark)}

    async def modify_tp_sl(
        self,
        *,
        symbol: str,
        order_id: str,
        trigger_price: str,
        execute_price: str | None = None,
        trigger_price_type: str | None = None,
    ) -> Any:
        """Передвинуть условную заявку на месте. Вид узнаём по ней самой."""
        current = next(
            (o for o in await self.algo_orders(symbol) if str(order_id) in {o.get("orderId"), o.get("clientAlgoId")}),
            None,
        )
        stop = current is None or "STOP" in str(current.get("planType") or "")
        data: dict[str, Any] = {"instId": inst_id(symbol)}
        data["algoId" if _digits_only(str(order_id)) else "algoClOrdId"] = str(order_id)
        data["newSlTriggerPx" if stop else "newTpTriggerPx"] = trigger_price
        return await self._request("POST", ENDPOINTS["amend_algos"], data=data)

    def _order_row(self, row: dict[str, Any], specs: dict[str, Instrument]) -> dict[str, Any]:
        name = str(row.get("instId") or "").upper()
        spec = specs.get(name)
        ct = spec.ct_val if spec else 1.0
        side = str(row.get("posSide") or "").lower()
        return {
            "orderId": str(row.get("ordId") or ""),
            "clientOrderId": str(row.get("clOrdId") or ""),
            "symbol": symbol_of(name),
            "side": str(row.get("side") or "").upper(),
            "positionSide": side.upper() if side in ("long", "short") else "",
            "type": str(row.get("ordType") or "").upper(),
            "price": row.get("px") or "",
            "origQty": _num(abs(_f(row.get("sz"))) * ct),
            "executedQty": _num(abs(_f(row.get("accFillSz"))) * ct),
            "avgPrice": row.get("avgPx") or "",
            "status": str(row.get("state") or "").upper(),
        }

    async def get_order(self, symbol: str, order_id: str) -> dict[str, Any]:
        key = "ordId" if _digits_only(str(order_id)) else "clOrdId"
        rows = await self._request(
            "GET", ENDPOINTS["order"], params={"instId": inst_id(symbol), key: str(order_id)}
        )
        if not rows:
            return {}
        return self._order_row(rows[0], await self._specs())

    async def open_orders(self, symbol: str) -> list[dict[str, Any]]:
        rows = await self._request(
            "GET",
            ENDPOINTS["open_orders"],
            params={"instType": "SWAP", "instId": inst_id(symbol)},
        )
        specs = await self._specs()
        return [self._order_row(r, specs) for r in rows or [] if isinstance(r, dict)]

    def _algo_rows(self, row: dict[str, Any], specs: dict[str, Instrument]) -> list[dict[str, Any]]:
        """Условная заявка OKX в виде WEEX: стоп и цель - отдельными строками."""
        name = str(row.get("instId") or "").upper()
        spec = specs.get(name)
        ct = spec.ct_val if spec else 1.0
        side = str(row.get("posSide") or "").lower()
        if side not in ("long", "short"):
            # Односторонний режим: защиту лонга ставят продажей.
            side = "long" if str(row.get("side") or "").lower() == "sell" else "short"
        size = abs(_f(row.get("sz") or row.get("actualSz")))
        base = {
            "orderId": str(row.get("algoId") or ""),
            "algoId": str(row.get("algoId") or ""),
            "clientAlgoId": str(row.get("algoClOrdId") or ""),
            "symbol": symbol_of(name),
            "positionSide": side.upper(),
            "side": str(row.get("side") or "").upper(),
            "quantity": _num(size * ct) if size > 0 else "",
            "state": row.get("state") or "",
        }
        out = []
        if _f(row.get("slTriggerPx")) > 0:
            out.append({**base, "planType": "STOP_LOSS", "triggerPrice": row.get("slTriggerPx")})
        if _f(row.get("tpTriggerPx")) > 0:
            out.append({**base, "planType": "TAKE_PROFIT", "triggerPrice": row.get("tpTriggerPx")})
        return out

    async def algo_orders(self, symbol: str) -> list[dict[str, Any]]:
        rows = await self._request(
            "GET",
            ENDPOINTS["algo_orders"],
            params={"ordType": "conditional,oco", "instType": "SWAP", "instId": inst_id(symbol)},
        )
        specs = await self._specs()
        out: list[dict[str, Any]] = []
        for row in rows or []:
            if isinstance(row, dict):
                out.extend(self._algo_rows(row, specs))
        return out

    async def cancel_order(self, symbol: str, order_id: str) -> Any:
        key = "ordId" if _digits_only(str(order_id)) else "clOrdId"
        value = str(order_id) if key == "ordId" else client_id(order_id)
        return await self._request(
            "POST", ENDPOINTS["cancel_order"], data={"instId": inst_id(symbol), key: value}
        )

    async def cancel_algo_order(self, symbol: str, order_id: str) -> Any:
        """Снять одну условную заявку - по номеру биржи или по нашей метке."""
        key = "algoId" if _digits_only(str(order_id)) else "algoClOrdId"
        value = str(order_id) if key == "algoId" else client_id(order_id)
        return await self._request(
            "POST", ENDPOINTS["cancel_algos"], data=[{"instId": inst_id(symbol), key: value}]
        )

    async def cancel_all_algo(self, symbol: str) -> int:
        """Снять условные заявки инструмента, пачками по десять - предел ручки."""
        ids = sorted({o["algoId"] for o in await self.algo_orders(symbol) if o.get("algoId")})
        name = inst_id(symbol)
        for start in range(0, len(ids), 10):
            batch = [{"instId": name, "algoId": one} for one in ids[start:start + 10]]
            await self._request("POST", ENDPOINTS["cancel_algos"], data=batch)
        return len(ids)

    async def user_trades(self, symbol: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Исполнения, свежие первыми, в полях WEEX.

        OKX отдаёт по сто строк за раз - листаем назад по `billId`, пока не
        наберём просимое. Комиссия приходит со знаком минус (удержание); в
        журнал идёт её величина. Возврат мейкеру (плюс) комиссией не считаем.
        """
        specs = await self._specs()
        out: list[dict[str, Any]] = []
        after = ""
        for _ in range(FILLS_MAX_PAGES):
            want = min(FILLS_PAGE, max(1, limit - len(out)))
            params: dict[str, Any] = {"instType": "SWAP", "limit": str(want), "after": after}
            if symbol:
                params["instId"] = inst_id(symbol)
            rows = await self._request("GET", ENDPOINTS["fills"], params=params)
            page = [r for r in rows or [] if isinstance(r, dict)]
            for row in page:
                name = str(row.get("instId") or "").upper()
                spec = specs.get(name)
                ct = spec.ct_val if spec else 1.0
                side = str(row.get("posSide") or "").lower()
                fee = _f(row.get("fee"))
                out.append(
                    {
                        "symbol": symbol_of(name),
                        "orderId": str(row.get("ordId") or ""),
                        "clientOrderId": str(row.get("clOrdId") or ""),
                        "side": str(row.get("side") or "").upper(),
                        "positionSide": side.upper() if side in ("long", "short") else "",
                        "price": row.get("fillPx") or "",
                        "qty": _num(abs(_f(row.get("fillSz"))) * ct),
                        "commission": _num(max(0.0, -fee)),
                        "realizedPnl": row.get("fillPnl") or "0",
                        "time": int(_f(row.get("ts"))),
                    }
                )
            if len(out) >= limit or len(page) < want:
                break
            after = str(page[-1].get("billId") or "")
            if not after:
                break
        return out[:limit]
