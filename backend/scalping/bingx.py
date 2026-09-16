"""Публичные рыночные данные BingX: поток книги и ленты.

Третий источник стакана после Binance и OKX. Нужен затем же: ученик, торгующий
на BingX, обязан смотреть книгу BingX - плиты, спред и лента там свои, а заявка
исполняется по ним, а не по чужим (ТЗ мультибиржи, §4.4).

Устройство ближе к OKX, чем к Binance: снимок приходит первым сообщением
самого канала, а не отдельным запросом. Но три вещи здесь свои, и без каждой
поток не работает вовсе:

* **сообщения сжаты (gzip).** Это не открытый JSON, как у Binance и OKX;
* **биржа шлёт текстовый `Ping`**, на который надо ответить `Pong`, иначе
  соединение закроют;
* **подписка - отдельным сообщением на каждый канал**, со своим номером
  (`{"id": ..., "reqType": "sub", "dataType": "BTC-USDT@incrDepth"}`), а не
  пачкой, как у OKX.

Частота обновления книги - **200 мс у BTC-USDT и ETH-USDT и 800 мс у
остальных**, вдвое реже Binance. Это свойство биржи, а не наш недостаток, и в
интерфейсе врать об этом не надо (ТЗ BingX, §3.3).

Пределы соединения: до 200 подписок на сокет и до 60 сокетов с адреса. Первый
предел здесь считается, второй - забота того, кто заводит сборщики.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
from typing import Any, Awaitable, Callable

import aiohttp

logger = logging.getLogger("nmnh.scalping.bingx")

REST_BASE = "https://open-api.bingx.com"
WS_PUBLIC = "wss://open-api-swap.bingx.com/swap-market"

# Пауза между попытками подключения растёт до потолка: лежащую биржу незачем
# долбить каждые полсекунды.
RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Управляющих сообщений биржа принимает ограниченное число в секунду.
CONTROL_RATE_DELAY = 0.2

# Предел подписок на одно соединение. Больше - биржа отвечает кодом 80403 и
# молча не открывает канал, что выглядит как пустой рынок.
MAX_SUBSCRIPTIONS = 200

# Каналы: книга с инкрементами (1000 уровней) и лента сделок.
DEPTH_CHANNEL = "incrDepth"
TRADES_CHANNEL = "trade"


def data_type(symbol: str, channel: str) -> str:
    """Имя канала биржи: `BTC-USDT@incrDepth`."""
    return f"{symbol}@{channel}"


def split_type(value: str) -> tuple[str, str]:
    """`BTC-USDT@incrDepth` -> пара и канал. Неизвестное - две пустые строки."""
    text = str(value or "")
    if "@" not in text:
        return "", ""
    inst, channel = text.split("@", 1)
    return inst.upper(), channel.split("@")[0]


def unpack(data: Any) -> str:
    """Сообщение потока в текст: биржа шлёт их сжатыми."""
    if isinstance(data, str):
        return data
    try:
        return gzip.decompress(data).decode("utf-8", "replace")
    except (OSError, EOFError, ValueError, TypeError):
        # Управляющие сообщения приходят и без сжатия.
        try:
            return bytes(data).decode("utf-8", "replace")
        except (TypeError, ValueError):
            return ""


class BingxPublicRest:
    """Открытые ручки BingX: суточная сводка, свечи и глубина. Ключей не требуют."""

    def __init__(
        self,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = REST_BASE,
    ):
        self._session_factory = session_factory
        self.base_url = base_url

    async def _get(self, path: str, params: dict[str, Any]) -> Any:
        session = await self._session_factory()
        try:
            async with session.get(
                f"{self.base_url}{path}",
                params={k: v for k, v in params.items() if v not in (None, "")},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                if response.status != 200:
                    logger.warning("BingX %s вернула %s", path, response.status)
                    return None
                payload = await response.json(content_type=None)
        except Exception as exc:  # noqa: BLE001 - сеть; вызывающий решит, что делать
            logger.warning("BingX %s недоступна: %s", path, exc)
            return None
        if not isinstance(payload, dict) or str(payload.get("code") or "0") != "0":
            return None
        return payload.get("data")

    async def tickers(self) -> list[dict]:
        """Суточная сводка по всем парам одним запросом."""
        data = await self._get("/openApi/swap/v2/quote/ticker", {})
        rows = data if isinstance(data, list) else []
        return [row for row in rows if isinstance(row, dict)]

    async def candles(self, symbol: str, interval: str = "1m", limit: int = 300) -> list[dict]:
        """История свечей. Биржа отдаёт их словарями, от новых к старым."""
        data = await self._get(
            "/openApi/swap/v3/quote/klines",
            {"symbol": symbol, "interval": interval, "limit": min(limit, 1000)},
        )
        rows = data if isinstance(data, list) else []
        return [row for row in rows if isinstance(row, dict)]

    async def trades(self, symbol: str, limit: int = 1000) -> list[dict]:
        """Последние сделки пары, от старых к новым в ответе биржи.

        Листания вглубь у открытой ручки нет: тысяча последних сделок это
        около двух минут по BTC и куда больше по остальным парам. Этого хватает
        на текущую свечу, ради которой их и берут (кластерная свеча).
        """
        data = await self._get(
            "/openApi/swap/v2/quote/trades", {"symbol": symbol, "limit": min(limit, 1000)}
        )
        rows = data if isinstance(data, list) else []
        return [row for row in rows if isinstance(row, dict)]

    async def depth(self, symbol: str, limit: int = 1000) -> dict:
        """Глубина книги запросом. Нужна пробнику для сверки с потоком."""
        data = await self._get(
            "/openApi/swap/v2/quote/depth", {"symbol": symbol, "limit": limit}
        )
        return data if isinstance(data, dict) else {}


class BingxStreamClient:
    """Одно публичное соединение и подписки поверх него.

    Подписки хранятся у клиента: при переподключении весь набор отправляется
    заново, по сообщению на канал - пачками биржа их не принимает.
    """

    def __init__(
        self,
        on_message: Callable[[str, str, dict], None],
        url: str = WS_PUBLIC,
    ):
        # Обработчику передаём пару, канал и данные: разбирать конверт биржи
        # дважды незачем.
        self._on_message = on_message
        self.url = url
        self._args: set[tuple[str, str]] = set()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._seq = 0
        # Кого известить, когда соединение оборвалось: книги, собранные до
        # разрыва, показывать нельзя.
        self.on_reset: Callable[[], None] | None = None

    @property
    def args(self) -> frozenset[tuple[str, str]]:
        return frozenset(self._args)

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="bingx-stream")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._close_socket()

    async def _close_socket(self) -> None:
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._session and not self._session.closed:
            await self._session.close()
        self._ws = None
        self._session = None

    async def subscribe(self, args: set[tuple[str, str]]) -> None:
        async with self._lock:
            new = args - self._args
            self._args |= args
            total = len(self._args)
        if total > MAX_SUBSCRIPTIONS:
            # Сверх предела биржа молча не откроет канал, и это выглядит как
            # пустой рынок. Сказать об этом надо здесь, а не гадать потом.
            logger.warning(
                "BingX: подписок %d при пределе %d на соединение", total, MAX_SUBSCRIPTIONS
            )
        if new:
            await self._control("sub", new)

    async def unsubscribe(self, args: set[tuple[str, str]]) -> None:
        async with self._lock:
            gone = args & self._args
            self._args -= args
        if gone:
            await self._control("unsub", gone)

    async def _control(self, kind: str, args: set[tuple[str, str]]) -> None:
        """Отправить подписки, если соединение живо.

        Не живо - ничего страшного: набор хранится у нас и уедет целиком при
        следующем подключении.
        """
        ws = self._ws
        if ws is None or ws.closed:
            return
        for inst, channel in sorted(args):
            self._seq += 1
            try:
                await ws.send_json(
                    {
                        "id": f"{kind}-{self._seq}",
                        "reqType": kind,
                        "dataType": data_type(inst, channel),
                    }
                )
                await asyncio.sleep(CONTROL_RATE_DELAY)
            except Exception as exc:  # noqa: BLE001
                logger.warning("BingX: не удалось отправить %s: %s", kind, exc)
                return

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            lived = False
            try:
                lived = await self._connect_once()
                delay = RECONNECT_MIN
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Поток BingX оборвался: %s", exc)
                lived = True
            # Соединение было и оборвалось - всё, что собрано, устарело. Пока
            # подписок нет, соединения нет тоже, и сбрасывать нечего.
            if lived:
                self._reset()
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    def _reset(self) -> None:
        if not self.on_reset:
            return
        try:
            self.on_reset()
        except Exception:  # noqa: BLE001
            logger.exception("Сбой сброса книг BingX")

    async def _connect_once(self) -> bool:
        """Прожить одно соединение. `False` - подписок нет, соединения не было."""
        async with self._lock:
            initial = set(self._args)
        if not initial:
            # Подписок нет - соединение держать незачем: биржа закроет его сама.
            await asyncio.sleep(1.0)
            return False

        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        async with self._session.ws_connect(self.url, heartbeat=None, max_msg_size=0) as ws:
            self._ws = ws
            logger.info("Поток BingX подключён, подписок: %d", len(initial))
            await self._control("sub", initial)
            # Пока сокет поднимался, набор мог измениться - досылаем разницу.
            async with self._lock:
                extra = self._args - initial
            if extra:
                await self._control("sub", extra)

            async for msg in ws:
                if msg.type not in (aiohttp.WSMsgType.BINARY, aiohttp.WSMsgType.TEXT):
                    continue
                text = unpack(msg.data)
                if await self._heartbeat(ws, text):
                    continue
                self._dispatch(text)
        await self._close_socket()
        return True

    async def _heartbeat(self, ws, text: str) -> bool:
        """Ответить на `Ping`. Без ответа биржа закрывает соединение."""
        if text.strip().lower() != "ping":
            return False
        try:
            await ws.send_str("Pong")
        except Exception as exc:  # noqa: BLE001 - разрывом займётся _run
            logger.debug("BingX: Pong не ушёл: %s", exc)
        return True

    def _dispatch(self, raw: str) -> None:
        if not raw:
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        name = str(payload.get("dataType") or "")
        if not name:
            # Ответ на подписку данных не несёт, но об отказе надо знать: без
            # него канал молчит, и это выглядит как пустой рынок.
            code = str(payload.get("code") or "0")
            if code not in ("0", ""):
                logger.warning("BingX отказала в подписке: %s", payload.get("msg") or code)
            return

        inst, channel = split_type(name)
        rows = payload.get("data")
        if not inst or not channel or rows is None:
            return
        items = rows if isinstance(rows, list) else [rows]
        for row in items:
            if not isinstance(row, dict):
                continue
            try:
                self._on_message(inst, channel, row)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Ошибка обработки события BingX %s", channel)
