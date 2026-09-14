"""Публичные рыночные данные MEXC: поток книги и ленты.

Четвёртый источник стакана после Binance, OKX и BingX. Нужен затем же: ученик,
торгующий на MEXC, обязан смотреть книгу MEXC - плиты, спред и лента там свои,
а заявка исполняется по ним, а не по чужим (ТЗ мультибиржи, §4.4).

Чем устройство отличается от трёх уже собранных:

* **снимок книги берётся запросом**, как у Binance, а не приходит первым
  сообщением канала, как у OKX и BingX. У снимка есть номер (`version`), и
  дальше поток продолжает эту же нумерацию;
* **сообщения открытым текстом** - распаковывать нечего;
* **сердцебиение своё**: раз в 10-20 секунд шлём `{"method":"ping"}`, биржа
  отвечает `{"channel":"pong"}`. Если молчать минуту, соединение закроют;
* **подписка - сообщением на канал**, со своим телом:
  `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}`.

Объём уровней биржа называет **в контрактах**. В книгу он обязан попасть в
монетах - иначе метрики посчитают чужие деньги, - и перевод делает сборщик
(`backend/scalping/mexc_collector.py`), знающий размер контракта каждой пары.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

import aiohttp

logger = logging.getLogger("nmnh.scalping.mexc")

REST_BASE = "https://contract.mexc.com"
WS_PUBLIC = "wss://contract.mexc.com/edge"

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Управляющих сообщений биржа принимает ограниченное число в секунду.
CONTROL_RATE_DELAY = 0.2

# Сердцебиение: молчание дольше минуты биржа считает обрывом.
PING_INTERVAL = 15.0

# Каналы: книга инкрементами и лента сделок.
DEPTH_CHANNEL = "depth"
TRADES_CHANNEL = "deal"

# Названия свечей у MEXC. Своих написаний биржа держится строго: `1m` она не
# понимает вовсе.
BARS = {
    "1m": "Min1",
    "5m": "Min5",
    "15m": "Min15",
    "30m": "Min30",
    "1h": "Min60",
    "4h": "Hour4",
    "8h": "Hour8",
    "1d": "Day1",
    "1w": "Week1",
    "1M": "Month1",
}


def sub_message(channel: str, symbol: str, kind: str = "sub") -> dict[str, Any]:
    """Сообщение подписки: `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}`."""
    return {"method": f"{kind}.{channel}", "param": {"symbol": symbol}}


def channel_of(value: str) -> str:
    """`push.depth` -> `depth`. Чужое или пустое - пустая строка."""
    text = str(value or "")
    if not text.startswith("push."):
        return ""
    return text[len("push.") :]


class MexcPublicRest:
    """Открытые ручки MEXC: сводка, свечи и глубина. Ключей не требуют."""

    def __init__(
        self,
        session_factory: Callable[[], Awaitable[aiohttp.ClientSession]],
        base_url: str = REST_BASE,
    ):
        self._session_factory = session_factory
        self.base_url = base_url

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        session = await self._session_factory()
        try:
            async with session.get(
                f"{self.base_url}{path}",
                params={k: v for k, v in (params or {}).items() if v not in (None, "")},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                if response.status != 200:
                    logger.warning("MEXC %s вернула %s", path, response.status)
                    return None
                payload = await response.json(content_type=None)
        except Exception as exc:  # noqa: BLE001 - сеть; вызывающий решит, что делать
            logger.warning("MEXC %s недоступна: %s", path, exc)
            return None
        if not isinstance(payload, dict) or str(payload.get("code") or "0") != "0":
            return None
        return payload.get("data")

    async def tickers(self) -> list[dict]:
        """Суточная сводка по всем парам одним запросом."""
        data = await self._get("/api/v1/contract/ticker")
        rows = data if isinstance(data, list) else []
        return [row for row in rows if isinstance(row, dict)]

    async def candles(self, symbol: str, interval: str = "Min1", limit: int = 300) -> list[dict]:
        """История свечей.

        MEXC отдаёт их не строками, а столбцами: отдельный список времён,
        отдельный - цен открытия и так далее. Складываем в строки здесь, чтобы
        остальной код читал свечи всех бирж одинаково.
        """
        data = await self._get(f"/api/v1/contract/kline/{symbol}", {"interval": interval})
        if not isinstance(data, dict):
            return []
        times = data.get("time") or []
        rows: list[dict] = []
        for index, moment in enumerate(times):
            try:
                rows.append(
                    {
                        # Время биржа даёт в секундах, а терминал считает
                        # миллисекундами.
                        "time": int(moment) * 1000,
                        "open": data["open"][index],
                        "high": data["high"][index],
                        "low": data["low"][index],
                        "close": data["close"][index],
                        # Объём - в контрактах; `amount` - тот же объём в
                        # деньгах, и его переводить не надо.
                        "volume": data["vol"][index],
                        "amount": (data.get("amount") or [0] * len(times))[index],
                    }
                )
            except (KeyError, IndexError, TypeError, ValueError):
                continue
        return rows[-limit:] if limit else rows

    async def depth(self, symbol: str, limit: int = 1000) -> dict:
        """Снимок книги. У него есть `version` - с него начинается цепочка."""
        data = await self._get(f"/api/v1/contract/depth/{symbol}", {"limit": limit})
        return data if isinstance(data, dict) else {}

    async def depth_commits(self, symbol: str, limit: int = 1000) -> list[dict]:
        """Последние изменения книги по возрастанию версии.

        Ими догоняют разрыв нумерации: пересобирать книгу снимком дороже и
        медленнее, а ученик в это время смотрит на подпись «стакан собирается».
        """
        data = await self._get(f"/api/v1/contract/depth_commits/{symbol}/{limit}")
        rows = data if isinstance(data, list) else []
        return [row for row in rows if isinstance(row, dict)]


class MexcStreamClient:
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
        self._beat: asyncio.Task | None = None
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
            self._task = asyncio.create_task(self._run(), name="mexc-stream")

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
        beat, self._beat = self._beat, None
        if beat:
            beat.cancel()
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
        for symbol, channel in sorted(args):
            try:
                await ws.send_json(sub_message(channel, symbol, kind))
                await asyncio.sleep(CONTROL_RATE_DELAY)
            except Exception as exc:  # noqa: BLE001
                logger.warning("MEXC: не удалось отправить %s: %s", kind, exc)
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
                logger.warning("Поток MEXC оборвался: %s", exc)
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
            logger.exception("Сбой сброса книг MEXC")

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
            logger.info("Поток MEXC подключён, подписок: %d", len(initial))
            self._beat = asyncio.create_task(self._heartbeat(ws), name="mexc-stream-ping")
            await self._control("sub", initial)
            # Пока сокет поднимался, набор мог измениться - досылаем разницу.
            async with self._lock:
                extra = self._args - initial
            if extra:
                await self._control("sub", extra)

            async for msg in ws:
                if msg.type is aiohttp.WSMsgType.TEXT:
                    self._dispatch(msg.data)
                elif msg.type is aiohttp.WSMsgType.BINARY:
                    self._dispatch(msg.data.decode("utf-8", "replace"))
        await self._close_socket()
        return True

    async def _heartbeat(self, ws) -> None:
        """Своё сердцебиение. Без него биржа закрывает молчащее соединение."""
        try:
            while True:
                await asyncio.sleep(PING_INTERVAL)
                if ws.closed:
                    return
                await ws.send_json({"method": "ping"})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - разрывом займётся _run
            logger.debug("MEXC: ping не ушёл: %s", exc)

    def _dispatch(self, raw: str) -> None:
        if not raw:
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        channel = str(payload.get("channel") or "")
        if channel in ("pong", "rs.sub.depth", "rs.sub.deal"):
            return
        if channel == "rs.error":
            # Отказ в подписке: без него канал молчит, и это выглядит как
            # пустой рынок.
            logger.warning("MEXC отказала в подписке: %s", payload.get("data"))
            return

        name = channel_of(channel)
        symbol = str(payload.get("symbol") or "").upper()
        row = payload.get("data")
        if not name or not symbol or not isinstance(row, dict):
            return
        try:
            self._on_message(symbol, name, row)
        except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
            logger.exception("Ошибка обработки события MEXC %s", name)
