"""Публичные рыночные данные OKX: поток книги и ленты.

Второй источник стакана после Binance. Нужен затем, что ученик, торгующий на
OKX, обязан смотреть книгу OKX: плиты, спред и лента там свои, а заявка
исполняется по ним, а не по чужим (ТЗ мультибиржи, §4.4).

Устройство отличается от Binance в одном месте, и это место определяет весь
остальной код:

    Binance   снимок книги берётся по REST, поток даёт только изменения;
    OKX       снимок приходит первым сообщением самого канала (``action``
              равно ``snapshot``), дальше идут изменения (``update``).

Поэтому здесь нет ни бюджета веса запросов на снимки, ни буферов событий на
время запроса: рассинхронизация чинится переподпиской канала, а не походом в
REST. REST остаётся только для суточной сводки - одним запросом на все свопы.

Второе отличие, на котором легко потерять сто крат: **объём в книге OKX
считается в контрактах**, а не в монетах. У BTC-USDT-SWAP контракт - 0.01 BTC.
Метрики стакана считают деньги как цену на объём, поэтому всё, что приходит,
переводится в монеты по ``ctVal`` из справочника инструментов
(`core/okx/futures.py`) до того, как попадёт в книгу.

Целостность книги биржа подтверждает контрольной суммой: crc32 от двадцати
пяти лучших уровней в каждом обновлении. Не сошлась - книга разошлась с
биржей, и её надо собирать заново; молча продолжать нельзя, трейдер будет
видеть плиту, которой нет.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

import aiohttp

from core.throttle import Budget, take as take_budget

logger = logging.getLogger("nmnh.scalping.okx")

REST_BASE = "https://www.okx.com"
WS_PUBLIC = "wss://ws.okx.com:8443/ws/v5/public"

# Биржа закрывает соединение, если тридцать секунд в нём тихо. Свой пинг шлём
# заметно раньше: сетевая задержка не должна съедать запас.
PING_INTERVAL = 20.0

# Пауза между попытками подключения растёт до потолка: лежащую биржу незачем
# долбить каждые полсекунды.
RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Управляющих сообщений биржа принимает ограниченное число в секунду.
CONTROL_RATE_DELAY = 0.2

# Очередь к истории сделок: пятнадцать запросов за две секунды из двадцати,
# что даёт биржа, - остаток на случай, если адрес занят чем-то ещё.
HISTORY_BUDGET = (Budget(15, 2.0), Budget(15, 2.0))

# Каналы книги: полная книга (400 уровней) с обновлениями каждые 100 мс.
BOOKS_CHANNEL = "books"
TRADES_CHANNEL = "trades"


class OkxPublicRest:
    """Открытые ручки OKX: суточная сводка и свечи. Ключей не требуют."""

    def __init__(
        self,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = REST_BASE,
    ):
        self._session_factory = session_factory
        self.base_url = base_url

    async def _get(self, path: str, params: dict[str, Any]) -> list:
        return (await self._fetch(path, params)) or []

    async def _fetch(self, path: str, params: dict[str, Any]) -> list | None:
        """Ответ ручки. `None` - биржа не ответила или отказала, а не «пусто».

        Разница важна там, где листают страницы: пустая страница значит, что
        сделки кончились, а отказ по частоте - что до конца не дошли.
        """
        session = await self._session_factory()
        try:
            async with session.get(
                f"{self.base_url}{path}",
                params={k: v for k, v in params.items() if v not in (None, "")},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                if response.status != 200:
                    logger.warning("OKX %s вернула %s", path, response.status)
                    return None
                payload = await response.json(content_type=None)
        except Exception as exc:  # noqa: BLE001 - сеть; вызывающий решит, что делать
            logger.warning("OKX %s недоступна: %s", path, exc)
            return None
        if not isinstance(payload, dict) or str(payload.get("code") or "0") != "0":
            return None
        rows = payload.get("data")
        return rows if isinstance(rows, list) else []

    async def tickers(self) -> list[dict]:
        """Суточная сводка по всем свопам одним запросом."""
        rows = await self._get("/api/v5/market/tickers", {"instType": "SWAP"})
        return [row for row in rows if isinstance(row, dict)]

    async def candles(self, inst: str, bar: str = "1m", limit: int = 300) -> list[list]:
        """История свечей: от новых к старым, как отдаёт биржа."""
        rows = await self._get(
            "/api/v5/market/candles",
            {"instId": inst, "bar": bar, "limit": min(limit, 300)},
        )
        return [row for row in rows if isinstance(row, list)]

    async def history_trades(
        self, inst: str, after: str | int | None = None, by_time: bool = False, limit: int = 100
    ) -> list[dict] | None:
        """Сделки от новых к старым - раньше `after`.

        `by_time` - `after` это время в миллисекундах, иначе номер сделки. По
        времени удобно встать сразу в конец нужной свечи, а дальше идти номерами:
        в одну миллисекунду попадает десяток сделок, и шаг по времени терял бы
        их на каждой границе страниц.
        """
        # Предел открытой ручки - двадцать запросов за две секунды на адрес.
        # Несколько терминалов листают свечи разом, и без очереди отказ по
        # частоте приходил посреди листания.
        await take_budget("okx-market", "history-trades", HISTORY_BUDGET, split=False)
        rows = await self._fetch(
            "/api/v5/market/history-trades",
            {
                "instId": inst,
                "type": "2" if by_time else "1",
                "after": after,
                "limit": min(limit, 100),
            },
        )
        if rows is None:
            return None
        return [row for row in rows if isinstance(row, dict)]


class OkxStreamClient:
    """Одно публичное соединение и подписки поверх него.

    Подписки хранятся у клиента, а не в адресе: OKX принимает их сообщениями, и
    при переподключении весь набор отправляется заново одним пакетом.
    """

    def __init__(
        self,
        on_message: Callable[[str, str, str, dict], None],
        url: str = WS_PUBLIC,
    ):
        # Обработчику передаём канал, инструмент, вид сообщения и сами данные:
        # разбирать конверт биржи дважды незачем.
        self._on_message = on_message
        self.url = url
        self._args: set[tuple[str, str]] = set()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._ping: asyncio.Task | None = None
        self._lock = asyncio.Lock()
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
            self._task = asyncio.create_task(self._run(), name="okx-stream")

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
        ping, self._ping = self._ping, None
        if ping:
            ping.cancel()
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
        if new:
            await self._control("subscribe", new)

    async def unsubscribe(self, args: set[tuple[str, str]]) -> None:
        async with self._lock:
            gone = args & self._args
            self._args -= args
        if gone:
            await self._control("unsubscribe", gone)

    async def _control(self, op: str, args: set[tuple[str, str]]) -> None:
        """Отправить подписку, если соединение живо.

        Не живо - ничего страшного: набор хранится у нас и уедет целиком при
        следующем подключении.
        """
        ws = self._ws
        if ws is None or ws.closed:
            return
        payload = [{"channel": channel, "instId": inst} for channel, inst in sorted(args)]
        try:
            await ws.send_json({"op": op, "args": payload})
            await asyncio.sleep(CONTROL_RATE_DELAY)
        except Exception as exc:  # noqa: BLE001
            logger.warning("OKX: не удалось отправить %s: %s", op, exc)

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
                logger.warning("Поток OKX оборвался: %s", exc)
                lived = True
            # Соединение было и оборвалось - всё, что собрано, устарело. Пока
            # подписок нет, соединения нет тоже, и сбрасывать нечего: иначе
            # холостой круг ожидания тёр бы книги каждую секунду.
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
            logger.exception("Сбой сброса книг OKX")

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
            logger.info("Поток OKX подключён, подписок: %d", len(initial))
            await ws.send_json(
                {
                    "op": "subscribe",
                    "args": [{"channel": c, "instId": i} for c, i in sorted(initial)],
                }
            )
            self._ping = asyncio.create_task(self._keepalive(ws), name="okx-ping")
            # Пока сокет поднимался, набор мог измениться - досылаем разницу.
            async with self._lock:
                extra = self._args - initial
            if extra:
                await self._control("subscribe", extra)

            async for msg in ws:
                if msg.type is not aiohttp.WSMsgType.TEXT:
                    continue
                self._dispatch(msg.data)
        await self._close_socket()
        return True

    async def _keepalive(self, ws) -> None:
        """Свой пинг словом ``ping``: биржа ждёт именно его, а не кадр протокола."""
        try:
            while not ws.closed:
                await asyncio.sleep(PING_INTERVAL)
                await ws.send_str("ping")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - соединение закрылось, разберётся _run
            return

    def _dispatch(self, raw: str) -> None:
        if raw == "pong":
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return
        if payload.get("event"):
            # Ответ на подписку событий не несёт, но об отказе надо знать: без
            # него канал молчит, и это выглядит как пустой рынок.
            if payload.get("event") == "error":
                logger.warning("OKX отказала в подписке: %s", payload.get("msg"))
            return

        arg = payload.get("arg") or {}
        channel = str(arg.get("channel") or "")
        inst = str(arg.get("instId") or "")
        rows = payload.get("data")
        if not channel or not inst or not isinstance(rows, list):
            return
        action = str(payload.get("action") or "")
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                self._on_message(channel, inst, action, row)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Ошибка обработки события OKX %s", channel)
