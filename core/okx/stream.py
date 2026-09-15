"""Приватный поток OKX: позиции, заявки и условные заявки счёта.

Зачем он нужен, лучше всего видно из цифр опроса. Терминал спрашивает сервер
раз в три-четыре секунды, а после взятой цели - каждые семь десятых; сервер на
каждый такой вопрос ходил на биржу. Сопровождение обходит счета своим кругом.
На сотне учеников это десятки запросов в секунду с одного адреса, и биржа
начинает резать - ровно тогда, когда надо переставить стоп (ТЗ мультибиржи,
§10.2).

Поток меняет направление: биржа сама говорит, что изменилось, и делает это в
момент события, а не через секунды. Из этого следуют два выигрыша:

* **позиции больше не опрашиваются.** Канал ``positions`` присылает снимок при
  подписке и полную строку позиции при каждом изменении. Пока соединение живо,
  ответ на вопрос «какие позиции у счёта» лежит в памяти;
* **сопровождение просыпается мгновенно.** Исполнилась цель - событие канала
  ``orders`` приходит сразу, и стоп в безубыток переставляется в ту же
  секунду, а не на следующем обходе.

Что здесь намеренно **не** делается: заявки и условные заявки не считаются
полным состоянием счёта. Снимка при подписке эти каналы не дают - только
изменения, - и собранный по ним список молча разошёлся бы с биржей. Поэтому
события заявок работают как звонок: сбрасывают память чтений и будят
сопровождение, а список по-прежнему спрашивается у биржи.

Подпись входа отличается от подписи REST-запроса: время в секундах эпохи, путь
постоянный (``/users/self/verify``), метод ``GET``, тела нет.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.okx.futures import Credentials, position_row, symbol_of

logger = logging.getLogger("nmnh.okx.stream")

WS_PRIVATE = "wss://ws.okx.com:8443/ws/v5/private"
# Демо-счёт живёт на своём адресе и требует признака в самом адресе: без него
# биржа пускает, но присылает данные боевого счёта - то есть ничего.
WS_PRIVATE_DEMO = "wss://wspap.okx.com:8443/ws/v5/private?brokerId=9999"

# Биржа рвёт молчащее соединение через тридцать секунд. Свой пинг - заметно
# раньше: сетевая задержка не должна съедать запас.
PING_INTERVAL = 20.0
# Сколько поток может молчать и считаться живым: три пропущенных ответа на ping.
STALE_AFTER = PING_INTERVAL * 3

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Сколько ждём ответа на вход. Не ответила - соединение бесполезно: каналы без
# входа биржа не откроет.
LOGIN_TIMEOUT = 10.0

# Каналы счёта. Позиции держим состоянием, заявки - звонком.
#
# Условных заявок здесь нет намеренно. Канал `orders-algo` живёт не на этом
# адресе, а на деловом (`/ws/v5/business`), и подписка на него с приватного
# отвергается: «wrong URL or channel: orders-algo, instType: SWAP doesn't
# exist» - проверено живым счётом. Просить его отсюда значит на каждом
# соединении получать отказ и писать его в журнал как сбой входа.
#
# Потери состояния в этом нет: снимка эти каналы всё равно не дают, и список
# условных заявок терминал берёт запросом. Понадобится мгновенное событие о
# срабатывании стопа - это второе соединение на деловой адрес, отдельной
# работой.
CHANNELS = ("positions", "orders")


def login_sign(secret: str, stamp: str) -> str:
    """Подпись входа: время, метод, постоянный путь. Тела в запросе нет."""
    message = f"{stamp}GET/users/self/verify"
    digest = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


class OkxPrivateStream:
    """Одно соединение одного счёта: вход, подписки и состояние позиций.

    Состояние держится по паре «инструмент и сторона»: в режиме «лонг и шорт»
    у одного инструмента две позиции разом, и сложить их в одну строку значит
    потерять одну из них.
    """

    def __init__(
        self,
        creds: Credentials,
        specs: Callable[[], Awaitable[dict[str, Any]]],
        *,
        on_positions: Callable[[list[dict]], None] | None = None,
        on_orders: Callable[[str], None] | None = None,
        on_down: Callable[[], None] | None = None,
        demo: bool = False,
        url: str | None = None,
    ):
        self.creds = creds
        self._specs = specs
        self._on_positions = on_positions
        self._on_orders = on_orders
        self._on_down = on_down
        self.url = url or (WS_PRIVATE_DEMO if demo else WS_PRIVATE)

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._ping: asyncio.Task | None = None
        self._logged_in = asyncio.Event()
        # Позиции по ключу «инструмент и сторона», уже в полях WEEX.
        self._positions: dict[tuple[str, str], dict] = {}
        # Когда поток последний раз подтверждал, что жив. По этому времени
        # решается, можно ли верить состоянию вместо запроса на биржу.
        self.alive_at = 0.0

    # ── состояние ───────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        """Вход выполнен, снимок позиций получен, соединение живо и отвечает.

        «Отвечает» - значит присылало что-то недавно: на наш ping биржа отвечает
        pong раз в PING_INTERVAL. Сокет, тихо оборвавшийся по дороге, открытым
        себя считает ещё долго, и по нему сопровождение видело застывшие
        позиции - ни взятой цели, ни закрытия. Молчит дольше STALE_AFTER -
        потоку не верим, и позиции спрашиваются у биржи напрямую.
        """
        return (
            bool(self._ws)
            and not self._ws.closed
            and self._logged_in.is_set()
            and time.monotonic() - self.alive_at < STALE_AFTER
        )

    def positions(self) -> list[dict]:
        return list(self._positions.values())

    # ── жизненный цикл ──────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="okx-private")

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
        ping, self._ping = self._ping, None
        if ping:
            ping.cancel()
        self._logged_in.clear()
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._session and not self._session.closed:
            await self._session.close()
        self._ws = None
        self._session = None

    def _down(self) -> None:
        """Соединения нет: состоянию верить нельзя, читаем биржу как раньше."""
        self._positions.clear()
        self.alive_at = 0.0
        if self._on_down:
            try:
                self._on_down()
            except Exception:  # noqa: BLE001
                logger.exception("Сбой обработчика обрыва приватного потока OKX")

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            try:
                await self._connect_once()
                delay = RECONNECT_MIN
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Приватный поток OKX оборвался: %s", exc)
            self._down()
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    async def _connect_once(self) -> None:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        async with self._session.ws_connect(self.url, heartbeat=None, max_msg_size=0) as ws:
            self._ws = ws
            stamp = str(int(time.time()))
            await ws.send_json(
                {
                    "op": "login",
                    "args": [
                        {
                            "apiKey": self.creds.api_key,
                            "passphrase": self.creds.passphrase,
                            "timestamp": stamp,
                            "sign": login_sign(self.creds.secret_key, stamp),
                        }
                    ],
                }
            )
            self._ping = asyncio.create_task(self._keepalive(ws), name="okx-private-ping")
            # Сторож входа: биржа может принять соединение и промолчать. Без
            # входа каналы не откроются, и молчащий сокет выглядел бы как счёт
            # без позиций - хуже, чем честный обрыв и опрос биржи как раньше.
            watchdog = asyncio.create_task(self._await_login(ws), name="okx-private-login")
            async for msg in ws:
                if msg.type is not aiohttp.WSMsgType.TEXT:
                    continue
                await self._dispatch(ws, msg.data)
        watchdog.cancel()
        await self._close()

    async def _await_login(self, ws) -> None:
        """Не вошли за отведённое время - рвём соединение и пробуем заново."""
        try:
            await asyncio.wait_for(self._logged_in.wait(), timeout=LOGIN_TIMEOUT)
        except asyncio.TimeoutError:
            logger.warning("OKX не подтвердила вход в приватный поток за %.0f с", LOGIN_TIMEOUT)
            await ws.close()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - разрывом займётся _run
            return

    async def _keepalive(self, ws) -> None:
        try:
            while not ws.closed:
                await asyncio.sleep(PING_INTERVAL)
                await ws.send_str("ping")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - разрывом займётся _run
            return

    async def _subscribe(self, ws) -> None:
        await ws.send_json(
            {
                "op": "subscribe",
                "args": [{"channel": channel, "instType": "SWAP"} for channel in CHANNELS],
            }
        )

    # ── разбор сообщений ────────────────────────────────────────────────────

    async def _dispatch(self, ws, raw: str) -> None:
        # Любое сообщение - подтверждение, что соединение живо.
        self.alive_at = time.monotonic()
        if raw == "pong":
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        event = payload.get("event")
        if event == "login":
            self._logged_in.set()
            await self._subscribe(ws)
            return
        if event == "error":
            # Отказ во входе - это не «тихо переподключиться»: без него каналы
            # молчат, и молчание выглядит как счёт без позиций.
            logger.warning("OKX не пустила в приватный поток: %s", payload.get("msg"))
            await ws.close()
            return
        if event:
            return

        channel = str((payload.get("arg") or {}).get("channel") or "")
        rows = payload.get("data")
        if not isinstance(rows, list):
            return

        if channel == "positions":
            await self._apply_positions(rows)
        elif channel in ("orders", "orders-algo"):  # алго - если придёт с делового адреса
            self._ring(rows)

    async def _apply_positions(self, rows: list) -> None:
        """Снимок и обновления позиций. Нулевой объём - позиция закрыта."""
        specs = await self._specs()
        changed = False
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("instId") or "").upper()
            side = str(row.get("posSide") or "").lower()
            if side not in ("long", "short"):
                side = "long" if _f(row.get("pos")) >= 0 else "short"
            key = (name, side)
            position = position_row(row, specs.get(name))
            if position is None:
                # Позиции больше нет - убираем, а не оставляем нулевую строку:
                # сопровождение читает размер и приняло бы её за открытую.
                changed = self._positions.pop(key, None) is not None or changed
                continue
            self._positions[key] = position
            changed = True
        if changed and self._on_positions:
            self._on_positions(self.positions())

    def _ring(self, rows: list) -> None:
        """Заявка изменилась - будим того, кто ведёт сделку на этом инструменте."""
        if not self._on_orders:
            return
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = symbol_of(str(row.get("instId") or ""))
            try:
                self._on_orders(symbol)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Сбой обработчика события заявки OKX")


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
