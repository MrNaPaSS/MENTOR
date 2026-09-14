"""Приватный поток MEXC: позиции, заявки и счёт.

Зачем он нужен, лучше всего видно из цифр опроса. Терминал спрашивает сервер
раз в три-четыре секунды, а после взятой цели - каждые семь десятых; сервер на
каждый такой вопрос ходил на биржу, и сопровождение обходит те же счета своим
кругом. На сотне учеников это десятки запросов в секунду с одного адреса.

Устроен как поток BingX, но проще в одном и сложнее в другом:

* **вход - сообщением в сам сокет**, а не ключом из отдельной ручки:
  `{"method":"login","param":{"apiKey":…,"signature":…,"reqTime":…}}`. Подпись
  считается от `apiKey + время` тем же способом, что у запросов. Успех -
  `rs.login`, отказ - `rs.error`;
* **соединение то же, что у открытых каналов** - `wss://contract.mexc.com/edge`;
* **своё сердцебиение.** Раз в 10-20 секунд шлём `{"method":"ping"}`; если
  клиент молчит минуту, биржа рвёт соединение. Ответ - `{"channel":"pong"}`.

И одно по существу, как на BingX: **снимка позиций канал не даёт**. Приходят
только изменения, а собранный по ним список молча разошёлся бы с биржей -
пустой список после подключения сопровождение приняло бы за закрытую сделку.
Поэтому снимок берётся запросом при каждом подключении, и до него поток себя
живым не считает: пока `ready` ложно, позиции спрашиваются у биржи, как раньше.

После каждого исполнения снимок берётся заново. Событие позиции приходит и
само, но исполнение - то единственное место, где ошибка в размере позиции
стоит денег: на нём считается лестница целей и объём стопа.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.mexc.market import _f, _i, sign, symbol_of
from core.weex.futures import Credentials

logger = logging.getLogger("nmnh.mexc.stream")

# Адрес потока. Он же несёт открытые каналы - биржа не разводит их по разным
# сокетам, вход отличает только сообщение `login`.
WS_URL = "wss://contract.mexc.com/edge"

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Сердцебиение: биржа рвёт соединение, если клиент молчит минуту. Шлём вдвое
# чаще края - сетевой сбой не должен стоить соединения.
PING_INTERVAL = 15.0

# Сколько ждём входа и первого снимка позиций. Не дождались - поток бесполезен:
# он не знает, что на счёте, и молчание выглядело бы как счёт без позиций.
LOGIN_TIMEOUT = 10.0
SNAPSHOT_TIMEOUT = 10.0

CHANNEL_LOGIN = "rs.login"
CHANNEL_ERROR = "rs.error"
CHANNEL_ORDER = "push.personal.order"
CHANNEL_POSITION = "push.personal.position"
CHANNEL_ASSET = "push.personal.asset"
# Защита позиции идёт своими каналами, и их два: один про запись защиты
# целиком, другой про её стоп-заявку. Имена сняты с живого счёта - в них
# приходят и постановка, и перенос, и срабатывание.
CHANNEL_STOP_PLAN = "push.personal.stop.planorder"
CHANNEL_STOP_ORDER = "push.personal.stop.order"

# Состояние заявки, после которого состояние позиции точно изменилось:
# 3 - исполнена. Частичное исполнение биржа шлёт тем же каналом состоянием 2,
# но с ненулевым `dealVol`.
STATE_FILLED = 3


def login_message(creds: Credentials, now_ms: int | None = None) -> dict[str, Any]:
    """Сообщение входа. Подпись - от `apiKey + время`, тем же правилом, что у ручек."""
    reqtime = str(now_ms if now_ms is not None else int(time.time() * 1000))
    return {
        "method": "login",
        "param": {
            "apiKey": creds.api_key,
            "reqTime": reqtime,
            "signature": sign(creds.secret_key, creds.api_key, reqtime, ""),
        },
    }


def order_event(row: dict[str, Any]) -> dict[str, Any]:
    """Событие заявки в читаемых именах. Пустая пара - событие не наше."""
    return {
        "symbol": symbol_of(str(row.get("symbol") or "")),
        "orderId": str(row.get("orderId") or row.get("id") or ""),
        # Наша метка приходит в потоке тем же именем, что уходила: свою заявку
        # поток называет нашим именем - то, чего нет на BingX.
        "clientOrderId": str(row.get("externalOid") or ""),
        "state": _i(row.get("state")),
        "side": _i(row.get("side")),
        "dealVol": row.get("dealVol") or "0",
    }


class MexcPrivateStream:
    """Одно соединение одного счёта: вход, снимок позиций и события.

    Состояние держится по паре «пара и сторона»: в двустороннем режиме у одной
    пары две позиции разом, и сложить их в одну строку значит потерять одну.
    """

    def __init__(
        self,
        creds: Credentials,
        snapshot: Callable[[], Awaitable[list[dict]]],
        *,
        on_positions: Callable[[list[dict]], None] | None = None,
        on_orders: Callable[[str], None] | None = None,
        on_down: Callable[[], None] | None = None,
        ws_url: str | None = None,
    ):
        self.creds = creds
        # Снимок позиций даёт торговый клиент: адрес, подпись и перевод полей у
        # него уже есть, и второй такой же код здесь разошёлся бы с ним.
        self._snapshot = snapshot
        self._on_positions = on_positions
        self._on_orders = on_orders
        self._on_down = on_down
        self.url = ws_url or os.getenv("MEXC_WS_PRIVATE", "").strip() or WS_URL

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._beat: asyncio.Task | None = None
        self._resync: asyncio.Task | None = None
        self._logged_in: asyncio.Event | None = None
        self._ready = False
        # Позиции по ключу «пара и сторона», уже в полях WEEX.
        self._positions: dict[tuple[str, str], dict] = {}
        self.alive_at = 0.0

    # ── состояние ───────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        """Соединение живо, вход принят и снимок позиций получен."""
        return bool(self._ws) and not self._ws.closed and self._ready

    def positions(self) -> list[dict]:
        return list(self._positions.values())

    # ── жизненный цикл ──────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="mexc-private")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._close()

    async def _close(self) -> None:
        for name in ("_beat", "_resync"):
            job = getattr(self, name)
            setattr(self, name, None)
            if job:
                job.cancel()
        self._ready = False
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._session and not self._session.closed:
            await self._session.close()
        self._ws = None
        self._session = None

    def _down(self) -> None:
        """Соединения нет: состоянию верить нельзя, читаем биржу как раньше."""
        self._positions.clear()
        self._ready = False
        self.alive_at = 0.0
        if self._on_down:
            try:
                self._on_down()
            except Exception:  # noqa: BLE001
                logger.exception("Сбой обработчика обрыва приватного потока MEXC")

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            try:
                await self._connect_once()
                delay = RECONNECT_MIN
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Приватный поток MEXC оборвался: %s", exc)
            self._down()
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def _connect_once(self) -> None:
        session = await self._http()
        self._logged_in = asyncio.Event()
        async with session.ws_connect(self.url, heartbeat=None, max_msg_size=0) as ws:
            self._ws = ws
            await ws.send_json(login_message(self.creds))
            self._beat = asyncio.create_task(self._heartbeat(ws), name="mexc-private-ping")
            reader = asyncio.create_task(self._read(ws), name="mexc-private-read")
            try:
                # Снимок берём только после того, как биржа приняла вход: до
                # него события не придут, и «живой» поток был бы обманом.
                await asyncio.wait_for(self._logged_in.wait(), timeout=LOGIN_TIMEOUT)
                logger.info("Приватный поток MEXC подключён")
                await self._take_snapshot()
                await reader
            finally:
                reader.cancel()
        await self._close()

    async def _read(self, ws) -> None:
        async for msg in ws:
            if msg.type is aiohttp.WSMsgType.TEXT:
                self._dispatch(msg.data)
            elif msg.type is aiohttp.WSMsgType.BINARY:
                self._dispatch(msg.data.decode("utf-8", "replace"))

    async def _heartbeat(self, ws) -> None:
        """Своё сердцебиение: молчание дольше минуты биржа считает обрывом."""
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

    async def _take_snapshot(self) -> None:
        """Снимок позиций запросом: канал его не даёт, а без него верить нечему."""
        try:
            rows = await asyncio.wait_for(self._snapshot(), timeout=SNAPSHOT_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Снимок позиций MEXC не получен: %s", exc)
            self._ready = False
            return
        self._positions = {
            (str(row.get("symbol") or ""), str(row.get("positionSide") or "")): row
            for row in rows or []
            if isinstance(row, dict)
        }
        self._ready = True
        self.alive_at = time.monotonic()
        if self._on_positions:
            self._on_positions(self.positions())

    def _resnapshot(self) -> None:
        """Перечитать позиции после исполнения - но не чаще одного раза разом."""
        if self._resync and not self._resync.done():
            return
        self._resync = asyncio.create_task(self._take_snapshot(), name="mexc-private-snapshot")

    # ── разбор сообщений ────────────────────────────────────────────────────

    def _dispatch(self, raw: str) -> None:
        # Любое сообщение - подтверждение, что соединение живо.
        self.alive_at = time.monotonic()
        if not raw:
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        channel = str(payload.get("channel") or "")
        if channel == CHANNEL_LOGIN:
            if self._logged_in:
                self._logged_in.set()
            return
        if channel == CHANNEL_ERROR:
            # Отказ входа - не повод молчать: без него поток выглядит живым,
            # но событий по счёту не приносит вовсе.
            logger.warning("MEXC отклонила вход в приватный поток: %s", payload.get("data"))
            return
        if channel == CHANNEL_POSITION:
            self._apply_position(payload.get("data"))
        elif channel == CHANNEL_ORDER:
            self._apply_order(payload.get("data"))
        elif channel in (CHANNEL_STOP_PLAN, CHANNEL_STOP_ORDER):
            self._apply_stop(payload.get("data"))
        # Канал счёта (push.personal.asset) читаем как подтверждение жизни:
        # баланс терминал берёт запросом, и второй его источник разошёлся бы с
        # первым.

    def _apply_position(self, row: Any) -> None:
        """Позиция изменилась. Нулевой объём - позиция закрыта.

        Перевод контрактов в монеты делает снимок, а не это событие: размер
        контракта знает торговый клиент, и считать его здесь вторым кодом
        значило бы завести второй источник правды. Поэтому событие только
        помечает состояние устаревшим и просит снимок заново - лишний запрос
        дешевле позиции, показанной в сотню раз больше настоящей.
        """
        if not self._ready or not isinstance(row, dict):
            return
        self._resnapshot()

    def _apply_stop(self, row: Any) -> None:
        """Защита изменилась: поставлена, перенесена или сработала.

        Сработавший стоп закрывает позицию, и узнать об этом из обхода значило
        бы ждать до пяти секунд - те самые секунды, в которые ученик смотрит на
        экран и не понимает, где его сделка. Поэтому снимок просим сразу, а
        сопровождение будим звонком, как на заявке.
        """
        if not isinstance(row, dict):
            return
        symbol = symbol_of(str(row.get("symbol") or ""))
        if not symbol:
            return
        self._resnapshot()
        if self._on_orders:
            try:
                self._on_orders(symbol)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Сбой обработчика события защиты MEXC")

    def _apply_order(self, row: Any) -> None:
        """Заявка изменилась: будим сопровождение, при исполнении - снимок."""
        if not isinstance(row, dict):
            return
        event = order_event(row)
        symbol = event["symbol"]
        if not symbol:
            return

        if event["state"] == STATE_FILLED or _f(event["dealVol"]) > 0:
            # Позиция изменилась - и это то место, где ошибка в её размере
            # стоит денег: по нему считается лестница целей и объём стопа.
            self._resnapshot()

        if self._on_orders:
            try:
                self._on_orders(symbol)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Сбой обработчика события заявки MEXC")
