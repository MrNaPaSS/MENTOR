"""Доступ к публичным данным фьючерсов Binance: REST-снимки и поток обновлений.

Ключи не нужны — оба канала открыты. Разделение ролей между ними жёсткое и
продиктовано лимитами биржи:

    REST   — редкие тяжёлые запросы: снимок стакана при подписке и суточная
             сводка по всем инструментам раз в несколько секунд;
    поток  — всё, что меняется часто. Он не расходует лимит запросов вовсе,
             поэтому опрашивать стакан по REST нельзя: скринер на 30 монет
             плюс открытый стакан выбрали бы весь лимит за минуту.

Замеры весов (заголовок ``x-mbx-used-weight-1m``, лимит 2400/мин):
``depth`` — 2/5/10/20 для 50/100/500/1000 уровней, ``ticker/24hr`` целиком — 40.
"""

from __future__ import annotations

import asyncio
import time
import json
import logging
from typing import Any, Awaitable, Callable

import aiohttp

logger = logging.getLogger("nmnh.scalping.binance")

REST_BASE = "https://fapi.binance.com"
WS_BASE = "wss://fstream.binance.com/stream"

# Биржа рвёт соединение раз в сутки штатно, плюс бывают сетевые обрывы.
# Пауза между попытками растёт до потолка, чтобы не долбить биржу при аварии.
RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Управляющих сообщений биржа принимает не больше 10 в секунду.
CONTROL_RATE_DELAY = 0.15

# Пауза после отказа по лимиту. Растёт вдвое, пока биржа не ответит нормально:
# 418 — это бан адреса, и каждый запрос во время бана продлевает его.
BAN_BACKOFF_MIN = 30.0
BAN_BACKOFF_MAX = 600.0


class BinanceRest:
    """REST-запросы к публичному API фьючерсов.

    С одной оговоркой, которая здесь важнее всего остального: биржа отвечает
    418, когда адрес забанен за превышение лимита. Бан продлевается каждым
    новым запросом, поэтому во время бана мы не ходим на биржу вовсе — иначе
    минутный запрет превращается в суточный.
    """

    def __init__(self, session_factory: Callable[[], Awaitable[aiohttp.ClientSession]]):
        self._session_factory = session_factory
        # До какого момента запросы не отправляются.
        self._blocked_until = 0.0
        self._penalty = BAN_BACKOFF_MIN

    @property
    def blocked(self) -> bool:
        return time.monotonic() < self._blocked_until

    @property
    def blocked_for(self) -> float:
        return max(0.0, self._blocked_until - time.monotonic())

    def _block(self, seconds: float) -> None:
        self._blocked_until = time.monotonic() + seconds
        logger.warning("Биржа закрыта для запросов на %.0f с", seconds)

    async def _get(self, path: str, params: dict | None = None) -> Any:
        if self.blocked:
            return None

        session = await self._session_factory()
        try:
            async with session.get(f"{REST_BASE}{path}", params=params) as r:
                if r.status in (418, 429):
                    # 429 — предупреждение, 418 — уже бан. И то, и другое значит
                    # «замолчи»: пауза берётся из ответа, а если её там нет —
                    # растёт сама, вдвое с каждым разом.
                    after = r.headers.get("Retry-After")
                    try:
                        pause = float(after) if after else self._penalty
                    except ValueError:
                        pause = self._penalty
                    self._penalty = min(self._penalty * 2, BAN_BACKOFF_MAX)
                    self._block(max(pause, BAN_BACKOFF_MIN))
                    return None
                if r.status != 200:
                    logger.warning("Binance %s вернул %s", path, r.status)
                    return None
                # Ответили нормально — счётчик наказания сбрасываем.
                self._penalty = BAN_BACKOFF_MIN
                return await r.json(content_type=None)
        except Exception as exc:  # noqa: BLE001 — сеть; вызывающий решает, что делать
            logger.warning("Binance %s недоступен: %s", path, exc)
            return None

    async def depth(self, symbol: str, limit: int = 1000) -> dict | None:
        """Снимок стакана. Берётся один раз на подписку, дальше — поток."""
        data = await self._get("/fapi/v1/depth", {"symbol": symbol.upper(), "limit": limit})
        return data if isinstance(data, dict) else None

    async def klines(self, symbol: str, interval: str = "1m", limit: int = 240) -> list[list]:
        """Свечи для графика рядом со стаканом.

        Берутся у того же источника, что и стакан: график обязан совпадать с
        книгой до тика, иначе трейдер видит на нём одну цену, а в стакане другую.
        Поток свечей на нашем эндпоинте молчит, поэтому только REST — вес 1 при
        лимите до сотни, 2 до пятисот.
        """
        data = await self._get(
            "/fapi/v1/klines",
            {"symbol": symbol.upper(), "interval": interval, "limit": min(limit, 500)},
        )
        return data if isinstance(data, list) else []

    async def tickers_24h(self) -> list[dict]:
        """Суточная сводка по всем инструментам одним запросом."""
        data = await self._get("/fapi/v1/ticker/24hr")
        return data if isinstance(data, list) else []


class StreamClient:
    """Одно соединение с комбинированным потоком и подписки поверх него.

    Держим ровно один сокет на процесс: биржа разрешает до 1024 потоков в
    соединении, а лимит на число соединений с одного адреса куда жёстче.
    Подписки меняются на лету — при переключении монеты пересоединяться не надо.
    """

    def __init__(self, on_message: Callable[[str, dict], None]):
        self._on_message = on_message
        self._streams: set[str] = set()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._task: asyncio.Task | None = None
        self._session: aiohttp.ClientSession | None = None
        self._lock = asyncio.Lock()
        self._connected = asyncio.Event()

    @property
    def streams(self) -> frozenset[str]:
        return frozenset(self._streams)

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="binance-stream")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None
        self._ws = None

    async def subscribe(self, streams: set[str]) -> None:
        """Добавить потоки. Уже подписанные повторно не запрашиваем."""
        async with self._lock:
            new = streams - self._streams
            self._streams |= streams
        if new:
            await self._control("SUBSCRIBE", new)

    async def unsubscribe(self, streams: set[str]) -> None:
        async with self._lock:
            gone = streams & self._streams
            self._streams -= streams
        if gone:
            await self._control("UNSUBSCRIBE", gone)

    async def _control(self, method: str, streams: set[str]) -> None:
        """Отправить управляющее сообщение, если соединение уже живо.

        Если сокет ещё не поднят, ничего делать не нужно: подписки хранятся в
        `self._streams` и уедут в URL при следующем подключении.
        """
        ws = self._ws
        if ws is None or ws.closed:
            return
        try:
            await ws.send_json({"method": method, "params": sorted(streams), "id": 1})
            await asyncio.sleep(CONTROL_RATE_DELAY)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Не удалось отправить %s: %s", method, exc)

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            try:
                await self._connect_once()
                delay = RECONNECT_MIN  # соединение жило — сбрасываем задержку
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Поток Binance оборвался: %s", exc)
            self._connected.clear()
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    async def _connect_once(self) -> None:
        async with self._lock:
            initial = sorted(self._streams)
        if not initial:
            # Подписок пока нет — ждём, иначе биржа закроет пустое соединение.
            await asyncio.sleep(1.0)
            return

        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        url = f"{WS_BASE}?streams={'/'.join(initial)}"
        async with self._session.ws_connect(url, heartbeat=30, max_msg_size=0) as ws:
            self._ws = ws
            self._connected.set()
            logger.info("Поток Binance подключён, потоков: %d", len(initial))

            # Пока сокет поднимался, набор мог измениться — досылаем разницу.
            async with self._lock:
                extra = self._streams - set(initial)
            if extra:
                await self._control("SUBSCRIBE", extra)

            async for msg in ws:
                if msg.type is not aiohttp.WSMsgType.TEXT:
                    continue
                self._dispatch(msg.data)
        self._ws = None

    def _dispatch(self, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        stream = payload.get("stream")
        data = payload.get("data")
        if not stream or not isinstance(data, dict):
            return  # служебный ответ на SUBSCRIBE — событий не несёт
        try:
            self._on_message(stream, data)
        except Exception:  # noqa: BLE001 — сбой обработчика не должен рвать поток
            logger.exception("Ошибка обработки события %s", stream)
