"""Словарь MEXC: имена, подпись, справочник пар и перевод ответов.

Всё, что отвечает на вопрос «как биржа называет то, что мы и так знаем»:
инструмент (`BTCUSDT` против `BTC_USDT`), объём в контрактах вместо монет,
сторона и действие одним числом, поля позиции и заявки, подпись запроса и
разбор конверта ответа. Торговых решений здесь нет - они в
`core/mexc/futures.py`, и этот раздел нужен ему целиком.

Отдельным файлом, потому что у этого кода три пользователя: торговый клиент,
приватный поток (`core/mexc/stream.py`) и сборщик книги
(`backend/scalping/mexc_collector.py`). Перевод контрактов в монеты обязан быть
у них общим: разойдись они - книга покажет один объём, позиция другой, и
заметит это ученик, а не мы.

Числа и имена полей проверены запросами к живой бирже 14 сентября 2026
(`docs/tz/mexc-tz.md`, §3), а не взяты из пересказа документации.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import aiohttp
from yarl import URL

from core.weex.futures import DEFAULT_FILTERS, WeexTradeError, floor_to_step

logger = logging.getLogger("nmnh.mexc.market")

EXCHANGE = "mexc"
# Новый домен биржи (с 19 января 2026). Старый `contract.mexc.com` отвечает
# тем же и остаётся запасным - он же несёт поток.
BASE_URL = "https://api.mexc.com"
LEGACY_URL = "https://contract.mexc.com"

# Учебного контура у MEXC нет вовсе: ни песочницы, ни учебных денег, как VST у
# BingX. Проверка адаптера идёт на живом счёте малым объёмом - один контракт
# BTC стоит копейки маржи (ТЗ MEXC, §5).

ENDPOINTS = {
    # Открытые ручки.
    "ping": "/api/v1/contract/ping",
    "detail": "/api/v1/contract/detail",
    "ticker": "/api/v1/contract/ticker",
    "depth": "/api/v1/contract/depth",
    "depth_commits": "/api/v1/contract/depth_commits",
    "kline": "/api/v1/contract/kline",
    # Счёт.
    "assets": "/api/v1/private/account/assets",
    "asset": "/api/v1/private/account/asset",
    "positions": "/api/v1/private/position/open_positions",
    "leverage": "/api/v1/private/position/change_leverage",
    # Плечо, стоящее сейчас: заявка на открытие обязана нести его в теле,
    # а изменить его биржа даёт не всегда - значит надо уметь прочитать.
    "leverage_info": "/api/v1/private/position/leverage",
    "position_mode": "/api/v1/private/position/position_mode",
    # Заявки.
    "order": "/api/v1/private/order/create",
    # Прежнее написание той же ручки. Биржа держит оба, но какое из них живёт
    # на этом счёте, выясняется только отказом - поэтому оно запасное, а не
    # вычеркнутое (ТЗ MEXC, §3).
    "order_legacy": "/api/v1/private/order/submit",
    "cancel": "/api/v1/private/order/cancel",
    "cancel_external": "/api/v1/private/order/cancel_with_external",
    "cancel_all": "/api/v1/private/order/cancel_all",
    "open_orders": "/api/v1/private/order/list/open_orders",
    "order_get": "/api/v1/private/order/get",
    "order_external": "/api/v1/private/order/external",
    "deals": "/api/v1/private/order/list/order_deals",
    # Защита позиции - своя ручка, не общая с заявками. Это важнее, чем
    # кажется: обычной заявкой с ценой защиты биржа закрывает позицию по рынку
    # сразу (проверено живым счётом), а здесь заводит именно стоп и цель.
    "stop_place": "/api/v1/private/stoporder/place",
    "stop_orders": "/api/v1/private/stoporder/list/orders",
    "stop_cancel": "/api/v1/private/stoporder/cancel",
    "stop_change": "/api/v1/private/stoporder/change_price",
}

# Окно годности запроса. Биржа даёт десять секунд и разрешает расширить до
# шестидесяти. Просим с запасом: часы этой машины расходились с биржей на
# 4.3 секунды - то есть половина окна по умолчанию уже съедена (ТЗ §3).
RECV_WINDOW = 30000

# Насколько часы этой машины расходятся с часами биржи, миллисекунды. Не
# мелочь и не забота администратора: сверх окна биржа отклоняет запрос целиком,
# а расхождение в секунды набегает на любой машине само.
_SKEW_MS = 0.0
_SKEW_AT = 0.0
SKEW_TTL = 300.0

# Метка заявки. У MEXC она есть и у неё свои ручки поиска и отмены - это то,
# чего не хватало на BingX. Биржа принимает строку; держим её в том же наборе
# знаков, что и на других биржах, чтобы сверка шла одним кодом.
CLIENT_ID_LIMIT = 32
_NOT_ALLOWED = re.compile(r"[^a-zA-Z0-9_-]")

# Ставка тейкера по умолчанию: справочник биржи называет 0.02% на фьючерсах.
DEFAULT_TAKER_FEE = 0.0002

# Коды, при которых запрос можно повторить: частота и разошедшееся время.
# Отказ по существу («баланса не хватает») повторять бессмысленно.
RETRYABLE_CODES = {"510", "8813", "8814"}
# Отказ по метке времени. Лечится сверкой часов и повтором - заявка при таком
# отказе до биржи не дошла.
CLOCK_CODES = {"602", "603", "8817"}

INSTRUMENTS_TTL = 3600.0
MODE_TTL = 600.0

# Заявок биржа принимает четыре за две секунды. Свой бюджет считает
# `core/throttle.py`; здесь - только правило, по которому он подобран.
ORDER_LIMIT = (4, 2.0)

# Исполнения биржа отдаёт окном. Неделя - столько живёт самая долгая сделка
# терминала.
DEALS_WINDOW_MS = 7 * 24 * 3600 * 1000

MARGIN_COIN = "USDT"

# Состояние пары в справочнике: 0 - торгуется. Остальные (1 доставка,
# 2 расчёт завершён, 3 снята, 4 пауза) означают, что заявку не поставить.
TRADABLE_STATE = 0

# Сторона и действие у MEXC - одно число. Ни у одной из трёх подключённых бирж
# такого нет: там сторона и `reduceOnly` разведены. Перепутать здесь значит
# открыть вторую позицию там, где закрывали первую, - поэтому перевод живёт
# отдельной парой функций и проверен тестами на все четыре случая.
OPEN_LONG = 1
CLOSE_SHORT = 2
OPEN_SHORT = 3
CLOSE_LONG = 4

# Тип заявки: 1 лимит, 5 рынок. Остальные (2 post only, 3 IOC, 4 FOK,
# 6 «по текущей цене») терминалу не нужны.
ORDER_LIMIT_TYPE = 1
ORDER_MARKET_TYPE = 5

# Способ маржи: 1 изолированная, 2 кросс.
OPEN_ISOLATED = 1
OPEN_CROSS = 2

# Режим позиций: 1 двусторонний (лонг и шорт разом), 2 односторонний.
MODE_HEDGE = 1
MODE_ONE_WAY = 2

# Состояние заявки: 1 не размещена, 2 висит, 3 исполнена, 4 снята, 5 недействительна.
ORDER_STATES = {
    1: "NEW",
    2: "NEW",
    3: "FILLED",
    4: "CANCELED",
    5: "REJECTED",
}

# Сторона позиции у биржи: 1 лонг, 2 шорт.
POSITION_LONG = 1
POSITION_SHORT = 2

# Состояние позиции: 1 держится, 2 держится системой, 3 закрыта.
POSITION_OPEN_STATES = (1, 2)


def client_id(value: str | None) -> str:
    """Метка заявки в том виде, в каком её примет и вернёт биржа.

    Регистр MEXC сохраняет, в отличие от BingX, - но набор знаков сужаем сами:
    метка ездит в адресе ручки поиска (`/order/external/{symbol}/{oid}`), и
    косая черта или пробел там сломали бы сам адрес.
    """
    return _NOT_ALLOWED.sub("", str(value or ""))[:CLIENT_ID_LIMIT]


def symbol_id(symbol: str) -> str:
    """`BTCUSDT` -> `BTC_USDT`. Записанный через подчёркивание не трогаем.

    Четвёртое написание пары в нашем коде после `BTCUSDT`, `BTC-USDT-SWAP` и
    `BTC-USDT`.
    """
    text = str(symbol or "").upper().strip()
    if "_" in text:
        return text
    if "-" in text:
        return text.replace("-", "_")
    if text.endswith("USDT") and len(text) > 4:
        return f"{text[:-4]}_USDT"
    return text


def symbol_of(instrument: str) -> str:
    """`BTC_USDT` -> `BTCUSDT`: так инструмент знает терминал."""
    return str(instrument or "").upper().replace("_", "")


def sides_of(code: Any) -> tuple[str, str]:
    """Число биржи -> наша пара «сторона, сторона позиции».

    Обратный перевод к `side_code`. Нужен потоку и разбору заявок: в событии
    приходит то же число, и прочитать его надо тем же правилом, каким писали.
    """
    value = _i(code)
    if value == OPEN_LONG:
        return "BUY", "LONG"
    if value == CLOSE_SHORT:
        return "BUY", "SHORT"
    if value == OPEN_SHORT:
        return "SELL", "SHORT"
    if value == CLOSE_LONG:
        return "SELL", "LONG"
    return "", ""


def side_code(side: str, position_side: str) -> int:
    """Наша пара «сторона, сторона позиции» -> число биржи.

    Правило биржи дословно: 1 открыть лонг, 2 закрыть шорт, 3 открыть шорт,
    4 закрыть лонг. Покупка при лонге - вход, покупка при шорте - выход; для
    продажи наоборот.
    """
    buy = str(side or "").upper() == "BUY"
    long = str(position_side or "").upper() != "SHORT"
    if buy:
        return OPEN_LONG if long else CLOSE_SHORT
    return CLOSE_LONG if long else OPEN_SHORT


def sign(secret: str, api_key: str, timestamp: str, params: str) -> str:
    """Подпись запроса: HMAC-SHA256 от `apiKey + timestamp + параметры`.

    Строка параметров у GET и DELETE - отсортированные по ключу параметры в
    виде строки запроса; у POST - тело JSON ровно в том виде, в каком оно
    уходит. Пересобранное по-другому тело - это другая подпись, и биржа
    ответит отказом, в котором про тело не будет ни слова.
    """
    payload = f"{api_key}{timestamp}{params}"
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def signing_string(params: dict[str, Any]) -> str:
    """Параметры GET в том порядке, в каком их подписывает биржа: по ключу."""
    rows = {k: v for k, v in params.items() if v not in (None, "")}
    return "&".join(f"{key}={rows[key]}" for key in sorted(rows))


def body_string(payload: dict[str, Any] | list) -> str:
    """Тело POST одной строкой. Подписывается и уходит ровно она.

    Без пробелов: биржа считает подпись от байтов тела, и лишний пробел после
    запятой - это другая подпись.
    """
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def query_string(params: dict[str, Any]) -> str:
    """Строка параметров для открытых ручек: подписи там нет, порядок не важен."""
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
    """Узнать, на сколько наши часы расходятся с биржей. Возвращает смещение, мс.

    Считаем по середине запроса: половина времени ответа приходится на дорогу
    туда, половина обратно, и середина - самая честная точка сравнения. Окно
    годности у MEXC вдвое уже, чем у BingX, поэтому цена неточности здесь выше.
    """
    global _SKEW_MS, _SKEW_AT
    if not force and _SKEW_AT and time.monotonic() - _SKEW_AT < SKEW_TTL:
        return _SKEW_MS
    before = time.time() * 1000
    try:
        data = await public_get(session, ENDPOINTS["ping"], {}, base_url)
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.debug("Время MEXC не получено: %s", exc)
        return _SKEW_MS
    after = time.time() * 1000
    server = _f(data.get("data") if isinstance(data, dict) else data)
    if server <= 0:
        return _SKEW_MS
    _SKEW_MS = server - (before + after) / 2
    _SKEW_AT = time.monotonic()
    if abs(_SKEW_MS) > 1000:
        logger.info("Часы разошлись с MEXC на %.0f мс - подписываем запросы с поправкой", _SKEW_MS)
    return _SKEW_MS


def clock_skew() -> float:
    """Последнее известное расхождение часов, миллисекунды. Нужно пробнику."""
    return _SKEW_MS


def is_clock_error(exc: WeexTradeError) -> bool:
    """Отказ по метке времени: часы разошлись с биржей."""
    text = str(exc).lower()
    return str(exc.code) in CLOCK_CODES or "time" in text and "window" in text


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value: Any) -> int:
    """Целое из ответа биржи - без потери точности на длинных числах.

    Через `float` здесь идти нельзя. Номера заявок и позиций у MEXC
    восемнадцатизначные, а в double умещается пятнадцать знаков: из сотни
    подряд идущих номеров девяносто девять возвращались искажёнными, кратными
    64. Биржа на такой номер честно отвечает «order not exist», и всё, что
    адресуется номером, промахивалось мимо цели: снятие лимитки, снятие и
    перенос защиты, постановка целей на позицию (`positionId`).
    """
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    text = str(value).strip()
    try:
        return int(text)
    except (TypeError, ValueError):
        pass
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def _num(value: float) -> str:
    """Число строкой, без экспоненты и двоичного хвоста."""
    return f"{round(value, 10):.10f}".rstrip("0").rstrip(".") or "0"


@dataclass(frozen=True)
class Instrument:
    """Свойства пары: всё, без чего нельзя перевести монеты в контракты.

    Объём у MEXC считается **в контрактах**, и контракт у каждой пары свой: у
    `BTC_USDT` это 0.0001 BTC. Терминал же везде считает монетами - значит
    перевод обязателен, и промах в нём в сто раз меняет размер позиции. Это
    самая дорогая ошибка адаптера (ТЗ §7), поэтому она заперта здесь, в двух
    функциях, а не размазана по клиенту.
    """

    symbol: str
    contract_size: float
    vol_unit: float
    min_vol: float
    max_vol: float
    price_unit: float
    max_leverage: float
    taker: float
    maker: float
    state: int

    @property
    def tradable(self) -> bool:
        return self.state == TRADABLE_STATE

    @property
    def step(self) -> float:
        """Шаг объёма в монетах: шаг контрактов, умноженный на их размер."""
        return round((self.vol_unit or 1.0) * self.contract_size, 12)

    def to_contracts(self, coins: float) -> float:
        """Монеты в контракты - вниз до шага: больше риска, чем просили, нельзя."""
        if not (coins > 0) or not (self.contract_size > 0):
            return 0.0
        return floor_to_step(coins / self.contract_size, self.vol_unit or 1.0)

    def to_coins(self, contracts: float) -> float:
        return round(abs(_f(contracts)) * self.contract_size, 10)

    def filters(self, taker_fee: float | None = None) -> dict[str, float]:
        """Шаги инструмента в монетах - в том же виде, что у WEEX."""
        step = self.step or DEFAULT_FILTERS["step"]
        return {
            "step": step,
            "tick": self.price_unit or DEFAULT_FILTERS["tick"],
            "min_qty": self.to_coins(self.min_vol) or step,
            "max_leverage": self.max_leverage or DEFAULT_FILTERS["max_leverage"],
            "taker_fee": taker_fee if taker_fee else (self.taker or DEFAULT_TAKER_FEE),
            "max_qty": self.to_coins(self.max_vol),
            "max_position": 0.0,
        }


def parse_instrument(row: dict[str, Any]) -> Instrument | None:
    """Строка справочника MEXC -> свойства пары. Не USDT-фьючерс - не наш.

    Нерабочую пару в справочник не берём, и по той же причине выбрасываем пары
    «зоны оценки» (Assessment Zone): по API они недоступны с 28 марта 2025 - ни
    котировок, ни заявок, - а в списке монет выглядели бы обычными. Ученик
    узнавал бы правду отказом биржи (ТЗ §3 и §7).
    """
    name = str(row.get("symbol") or "").upper()
    if not name.endswith("_USDT"):
        return None
    state = _i(row.get("state")) if row.get("state") not in (None, "") else TRADABLE_STATE
    if state != TRADABLE_STATE:
        return None
    if is_assessment(row):
        return None
    size = _f(row.get("contractSize"))
    if size <= 0:
        # Без размера контракта объём не перевести вовсе, а гадать здесь нельзя:
        # ошибка в сто раз - это ошибка в сто раз.
        return None
    return Instrument(
        symbol=name,
        contract_size=size,
        vol_unit=_f(row.get("volUnit")) or 1.0,
        min_vol=_f(row.get("minVol")) or _f(row.get("volUnit")) or 1.0,
        max_vol=_f(row.get("maxVol")),
        price_unit=_f(row.get("priceUnit")),
        max_leverage=_f(row.get("maxLeverage")),
        taker=_f(row.get("takerFeeRate")),
        maker=_f(row.get("makerFeeRate")),
        state=state,
    )


def is_assessment(row: dict[str, Any]) -> bool:
    """Пара «зоны оценки»: торгуется на бирже, но не по API.

    Биржа помечает такие по-разному в разных выпусках справочника, поэтому
    смотрим все известные признаки разом: пропустить такую пару дешевле, чем
    показать ученику монету, на которую нельзя поставить заявку.
    """
    for key in ("isZeroFeeSymbol", "conceptPlate", "zone", "riskLimitType"):
        value = row.get(key)
        if isinstance(value, str) and "assessment" in value.lower():
            return True
        if isinstance(value, list) and any(
            isinstance(one, str) and "assessment" in one.lower() for one in value
        ):
            return True
    return bool(row.get("isAssessmentZone")) or bool(row.get("assessmentZone"))


def position_row(row: dict[str, Any], spec: Instrument | None) -> dict[str, Any] | None:
    """Позиция MEXC в полях WEEX. Пусто - позиции нет или пара не наша.

    Отдельной функцией, а не внутри запроса: тем же переводом пользуется
    приватный поток, и разойтись этим двум местам нельзя - сопровождение
    читает результат как одно и то же.

    Объём биржа называет в контрактах (`holdVol`), терминал считает монетами:
    перевод обязателен здесь же, иначе позиция в интерфейсе окажется в сотни
    раз больше настоящей.
    """
    name = str(row.get("symbol") or "").upper()
    if not name or spec is None:
        return None
    state = _i(row.get("state"))
    contracts = _f(row.get("holdVol"))
    if contracts <= 0 or (state and state not in POSITION_OPEN_STATES):
        return None
    side = "LONG" if _i(row.get("positionType")) == POSITION_LONG else "SHORT"
    size = spec.to_coins(contracts)
    # Средняя цена открытия, а не удержания. `holdAvgPrice`, судя по поведению
    # живого счёта, сдвигается забранной прибылью: после первой цели лонга
    # она опускалась, и безубыток, посчитанный от неё, вставал ровно на вход
    # вместо входа с комиссией. `openAvgPrice` - сама цена набора позиции.
    avg = _f(row.get("openAvgPrice") or row.get("holdAvgPrice"))
    return {
        "symbol": symbol_of(name),
        "instId": name,
        "side": side,
        "positionSide": side,
        "size": _num(size),
        # Номер позиции у MEXC нужен и плечу, и закрытию: биржа адресует
        # позицию им, а не парой «символ и сторона».
        "positionId": str(row.get("positionId") or ""),
        "leverage": row.get("leverage") or "",
        # Цены пометки в ответе позиции биржа не даёт - оставляем пустой строкой,
        # а не нулём: ноль сопровождение приняло бы за настоящую цену.
        "markPrice": row.get("markPrice") or "",
        # Плавающий результат - только если биржа его назвала. Подставлять
        # `realised` нельзя: это уже забранное, и у свежей позиции оно равно
        # комиссии входа - терминал показывал «-0.02» при плюсе на бирже. Пусто
        # - и терминал посчитает результат сам, от цены.
        "unrealizePnl": row.get("unrealised") or "",
        "liquidatePrice": row.get("liquidatePrice") or "",
        "marginSize": row.get("im") or row.get("oim") or "",
        "averageOpenPrice": _num(avg) if avg > 0 else "",
        "cumOpenSize": _num(size),
        "cumOpenValue": _num(avg * size),
        "openType": _i(row.get("openType")) or OPEN_ISOLATED,
    }


def order_row(row: dict[str, Any], spec: Instrument | None = None) -> dict[str, Any]:
    """Обычная заявка MEXC в полях WEEX. Объём - в монетах."""
    name = str(row.get("symbol") or "").upper()
    side, position_side = sides_of(row.get("side"))
    vol = _f(row.get("vol"))
    done = _f(row.get("dealVol"))
    return {
        "orderId": str(row.get("orderId") or row.get("id") or ""),
        "clientOrderId": client_id(row.get("externalOid")),
        "symbol": symbol_of(name),
        "side": side,
        "positionSide": position_side,
        "type": "LIMIT" if _i(row.get("orderType")) != ORDER_MARKET_TYPE else "MARKET",
        "price": row.get("price") or "",
        "origQty": _num(spec.to_coins(vol) if spec else vol),
        "executedQty": _num(spec.to_coins(done) if spec else done),
        "avgPrice": row.get("dealAvgPrice") or "",
        "status": ORDER_STATES.get(_i(row.get("state")), "NEW"),
    }


def plan_row(row: dict[str, Any], spec: Instrument | None = None) -> dict[str, Any]:
    """Условная заявка MEXC в виде условной заявки WEEX.

    У защиты MEXC есть обе цены разом - `stopLossPrice` и `takeProfitPrice` в
    одной строке, - потому что биржа держит их одной заявкой на позицию. Наш
    код читает стоп и цель порознь, поэтому строка раскладывается на две
    (`plan_rows` ниже), а здесь - перевод одной половины.
    """
    name = str(row.get("symbol") or "").upper()
    side = "LONG" if _i(row.get("positionType")) == POSITION_LONG else "SHORT"
    stop = _f(row.get("stopLossPrice")) > 0
    vol = _f(row.get("vol"))
    return {
        "orderId": str(row.get("id") or row.get("stopPlanOrderId") or ""),
        # Метки у защиты MEXC нет: она привязана к позиции, а не к нашему
        # идентификатору. Опознаётся номером, как на BingX.
        "clientAlgoId": "",
        "clientOrderId": "",
        "symbol": symbol_of(name),
        "positionSide": side,
        "side": "SELL" if side == "LONG" else "BUY",
        "planType": "STOP_LOSS" if stop else "TAKE_PROFIT",
        "type": "STOP_MARKET" if stop else "TAKE_PROFIT_MARKET",
        "triggerPrice": row.get("stopLossPrice") if stop else row.get("takeProfitPrice") or "",
        "quantity": _num(spec.to_coins(vol) if spec else vol),
        "state": str(row.get("state") or ""),
        # Номер позиции: по нему защита переносится и снимается.
        "positionId": str(row.get("positionId") or ""),
    }


def plan_rows(row: dict[str, Any], spec: Instrument | None = None) -> list[dict[str, Any]]:
    """Строка защиты MEXC -> одна или две условные заявки в полях WEEX.

    Биржа держит стоп и цель одной записью с двумя ценами. Терминал же считает
    их разными заявками: цель бывает не одна, а стоп переносится отдельно.
    Раскладываем по ценам - пустая цена значит, что этой половины нет.
    """
    out: list[dict[str, Any]] = []
    if _f(row.get("stopLossPrice")) > 0:
        out.append(plan_row({**row, "takeProfitPrice": ""}, spec))
    if _f(row.get("takeProfitPrice")) > 0:
        out.append(plan_row({**row, "stopLossPrice": ""}, spec))
    return out


_INSTRUMENTS: dict[str, Instrument] = {}
_INSTRUMENTS_AT = 0.0
_MODES: dict[str, tuple[bool, float]] = {}


def clear_caches() -> None:
    """Забыть справочник и режимы счетов. Нужно тестам и пробнику."""
    global _INSTRUMENTS_AT
    _INSTRUMENTS.clear()
    _INSTRUMENTS_AT = 0.0
    _MODES.clear()


def unwrap(payload: Any, status: int) -> Any:
    """Разобрать конверт ответа: `{"success": true, "code": 0, "data": ...}`."""
    if not isinstance(payload, dict):
        if status >= 400:
            raise WeexTradeError(
                f"MEXC вернула {status}", code=status, retryable=status == 429 or status >= 500
            )
        return payload

    code = str(payload.get("code") if payload.get("code") is not None else "0")
    success = payload.get("success")
    if code not in ("0", "") or success is False:
        message = str(payload.get("message") or payload.get("msg") or "MEXC отклонила запрос")
        raise WeexTradeError(
            message,
            code=code,
            retryable=code in RETRYABLE_CODES or status == 429 or status >= 500,
        )
    if status >= 400:
        raise WeexTradeError(
            f"MEXC вернула {status}", code=status, retryable=status == 429 or status >= 500
        )
    data = payload.get("data")
    return data if data is not None else payload


def check_cancelled(data: Any, what: str = "Заявка") -> None:
    """Проверить, что биржа и вправду сняла заявку.

    Отмена у MEXC пакетная, и отвечает она на неё дважды: общим кодом конверта
    и разбором по каждой заявке - `{"orderId": 1, "errorCode": 0}`. Конверт при
    этом приходит успешным, даже когда снять не удалось ни одной: причина
    лежит внутри, в `errorCode`.

    Пока разбора не было, снятая «успешно» заявка оставалась висеть, и об этом
    не знал никто: терминал считал её снятой, а на бирже она ждала своей цены.
    """
    for row in rows_of(data):
        if "errorCode" not in row:
            continue
        code = row.get("errorCode")
        try:
            failed = int(code) != 0
        except (TypeError, ValueError):
            failed = bool(code)
        if not failed:
            continue
        message = str(row.get("errorMsg") or "").strip() or f"код {code}"
        number = str(row.get("orderId") or row.get("stopPlanOrderId") or "")
        raise WeexTradeError(
            f"{what} {number} на MEXC не снята: {message}".replace("  ", " "),
            code=code,
        )


def rows_of(data: Any, key: str = "") -> list[dict]:
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


async def public_get(session, path: str, params: dict[str, Any], base_url: str = BASE_URL) -> Any:
    """Открытая ручка без подписи: справочник, цена, книга, время.

    Конверт здесь не разбирается до конца намеренно: `ping` кладёт время прямо
    в `data`, а `unwrap` нужен и ему, и справочнику - разбор делает вызывающий.
    """
    query = query_string(params)
    url = request_url(base_url, path, query)
    async with session.request("GET", url, timeout=aiohttp.ClientTimeout(total=15)) as response:
        text = await response.text()
        status = response.status
    try:
        payload = json.loads(text) if text else {}
    except ValueError as exc:
        raise WeexTradeError(f"MEXC ответила не JSON ({status})", retryable=status >= 500) from exc
    if isinstance(payload, dict) and path == ENDPOINTS["ping"]:
        # Время нужно целиком с конвертом: `unwrap` вернул бы одно число, а
        # сверка часов хочет знать и об отказе.
        unwrap(payload, status)
        return payload
    return unwrap(payload, status)


async def load_instruments(session, base_url: str = BASE_URL) -> dict[str, Instrument]:
    """Справочник USDT-фьючерсов, из памяти процесса, пока он свежий."""
    global _INSTRUMENTS_AT
    if _INSTRUMENTS and time.monotonic() - _INSTRUMENTS_AT < INSTRUMENTS_TTL:
        return _INSTRUMENTS
    data = await public_get(session, ENDPOINTS["detail"], {}, base_url)
    fresh = {
        spec.symbol: spec
        for spec in (parse_instrument(row) for row in rows_of(data))
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
        logger.warning("Справочник MEXC не получен: %s", exc)
        return DEFAULT_FILTERS
    spec = specs.get(symbol_id(symbol))
    return spec.filters() if spec else DEFAULT_FILTERS


async def public_price(session, symbol: str) -> float | None:
    """Последняя цена пары без ключей."""
    try:
        data = await public_get(session, ENDPOINTS["ticker"], {"symbol": symbol_id(symbol)})
    except (WeexTradeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
        logger.warning("Цена %s на MEXC не получена: %s", symbol, exc)
        return None
    row = data[0] if isinstance(data, list) and data else data
    price = _f(row.get("lastPrice")) if isinstance(row, dict) else 0.0
    return price if price > 0 else None
