"""Приватный поток Binance: позиции и заявки счёта.

Зачем он нужен, лучше всего видно из цифр опроса. Терминал спрашивает сервер
раз в три-четыре секунды, а после взятой цели - каждые семь десятых; сервер на
каждый такой вопрос ходил на биржу. У Binance это особенно дорого: вес запроса
позиций - пять единиц из 2400 в минуту на адрес, и на сотне учеников бюджет
уходит на то, что поток отдаёт даром.

Устроен как поток BingX - тот же механизм ключа, - но проще в двух местах:

* **сообщения открытым текстом**, а не сжатые;
* **сердцебиение ведёт библиотека**: Binance шлёт служебный кадр `ping`, и
  `aiohttp` отвечает на него сам. Отвечать руками, как на BingX, не нужно.

Отличий по существу два, и оба стоят внимания:

* **снимка позиций канал не даёт.** Приходят только изменения, и собранный по
  ним список молча разошёлся бы с биржей - пустой список после подключения
  сопровождение приняло бы за закрытую сделку. Поэтому снимок берётся запросом
  при каждом подключении, и до него поток себя живым не считает;
* **ключ может протухнуть на ходу.** Биржа присылает об этом отдельное событие
  (`listenKeyExpired`), и это не ошибка сети: соединение живо, но событий по
  счёту в нём больше нет. Молчащий поток опаснее оборвавшегося - оборвавшийся
  честно вернёт нас к опросу, - поэтому такое событие мы считаем обрывом.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.binance.market import (
    BASE_URL,
    ENDPOINTS,
    TESTNET_URL,
    _f,
    position_row,
    symbol_of,
)
from core.weex.futures import Credentials

logger = logging.getLogger("nmnh.binance.stream")

# Адрес приватного потока. Ключ идёт в пути - так у Binance устроены все
# пользовательские потоки.
WS_PRIVATE = "wss://fstream.binance.com/ws"
# Учебный контур: адрес из документации биржи, рядом с `demo-fapi`.
WS_PRIVATE_TESTNET = "wss://demo-fstream.binance.com/ws"

# Ключ живёт час. Продлеваем вдвое чаще: сетевой сбой не должен стоить
# соединения.
KEY_RENEW = 1800.0

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Сколько ждём первого снимка позиций. Не пришёл - поток бесполезен: он не
# знает, что на счёте, и молчание выглядело бы как счёт без позиций.
SNAPSHOT_TIMEOUT = 10.0

EVENT_ORDER = "ORDER_TRADE_UPDATE"
EVENT_ACCOUNT = "ACCOUNT_UPDATE"
EVENT_KEY_GONE = "listenKeyExpired"

# Статусы заявки, после которых состояние позиции точно изменилось.
FILL_STATES = ("FILLED", "PARTIALLY_FILLED")


def ws_url(testnet: bool, listen_key: str, base: str | None = None) -> str:
    """Адрес подключения с ключом в пути."""
    root = base or os.getenv("BINANCE_WS_PRIVATE", "").strip() or (
        WS_PRIVATE_TESTNET if testnet else WS_PRIVATE
    )
    return f"{root.rstrip('/')}/{listen_key}"


def account_positions(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Позиции из события счёта, в тех же полях, что отдаёт справочная ручка.

    Поля в потоке короткие: `s` пара, `pa` объём, `ep` цена входа, `up`
    незафиксированный итог, `ps` сторона, `bep` безубыток. Переводим их в имена
    REST-ответа и отдаём общему переводчику (`position_row`) - разойтись этим
    двум местам нельзя.
    """
    account = event.get("a") if isinstance(event.get("a"), dict) else {}
    rows = account.get("P") if isinstance(account, dict) else None
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "symbol": row.get("s") or "",
                "positionAmt": row.get("pa") or "0",
                "entryPrice": row.get("ep") or "0",
                "breakEvenPrice": row.get("bep") or "",
                "unRealizedProfit": row.get("up") or "0",
                "positionSide": str(row.get("ps") or "").upper(),
                "isolatedWallet": row.get("iw") or "",
            }
        )
    return out


def order_event(event: dict[str, Any]) -> dict[str, Any]:
    """Событие заявки в читаемых именах. Пустая пара - событие не наше."""
    order = event.get("o") if isinstance(event.get("o"), dict) else {}
    return {
        "symbol": symbol_of(str(order.get("s") or "")),
        "orderId": str(order.get("i") or ""),
        # Метку брокера здесь не снимаем: сопровождение получает событие только
        # как повод перечитать биржу, а идентификаторы сверяет по ответу ручки,
        # где перевод уже сделан (`core/binance/market.py`).
        "clientOrderId": str(order.get("c") or ""),
        "type": str(order.get("o") or "").upper(),
        "status": str(order.get("X") or "").upper(),
        "side": str(order.get("S") or "").upper(),
        "positionSide": str(order.get("ps") or "").upper(),
        "filled": _f(order.get("z")),
    }


class BinancePrivateStream:
    """Одно соединение одного счёта: ключ, снимок позиций и события.

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
        testnet: bool = False,
        base_url: str | None = None,
        ws_base: str | None = None,
    ):
        self.creds = creds
        # Снимок позиций даёт торговый клиент: адрес, подпись и перевод полей у
        # него уже есть, и второй такой же код здесь разошёлся бы с ним.
        self._snapshot = snapshot
        self._on_positions = on_positions
        self._on_orders = on_orders
        self._on_down = on_down
        self.testnet = testnet
        self.base_url = base_url or (TESTNET_URL if testnet else BASE_URL)
        self._ws_base = ws_base

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._renew: asyncio.Task | None = None
        self._resync: asyncio.Task | None = None
        self._listen_key = ""
        self._ready = False
        # Позиции по ключу «пара и сторона», уже в полях WEEX.
        self._positions: dict[tuple[str, str], dict] = {}
        self.alive_at = 0.0

    # ── состояние ───────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        """Соединение живо и снимок позиций получен."""
        return bool(self._ws) and not self._ws.closed and self._ready

    def positions(self) -> list[dict]:
        return list(self._positions.values())

    # ── жизненный цикл ──────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="binance-private")

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
        for name in ("_renew", "_resync"):
            job = getattr(self, name)
            setattr(self, name, None)
            if job:
                job.cancel()
        self._ready = False
        if self._ws and not self._ws.closed:
            await self._ws.close()
        if self._listen_key:
            await self._drop_key()
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
                logger.exception("Сбой обработчика обрыва приватного потока Binance")

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            try:
                await self._connect_once()
                delay = RECONNECT_MIN
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Приватный поток Binance оборвался: %s", exc)
            self._down()
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)

    # ── ключ потока ─────────────────────────────────────────────────────────

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def _key_request(self, method: str) -> Any:
        """Ручка ключа: создание, продление и закрытие - одним адресом."""
        session = await self._http()
        url = f"{self.base_url}{ENDPOINTS['listen_key']}"
        async with session.request(
            method,
            url,
            headers={"X-MBX-APIKEY": self.creds.api_key},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as response:
            text = await response.text()
            status = response.status
        if status >= 400:
            raise RuntimeError(f"ключ потока: биржа вернула {status} ({text[:120]})")
        try:
            return json.loads(text) if text else {}
        except ValueError:
            return {}

    async def _new_key(self) -> str:
        payload = await self._key_request("POST")
        row = payload if isinstance(payload, dict) else {}
        key = str(row.get("listenKey") or "")
        if not key:
            raise RuntimeError(f"биржа не выдала ключ потока: {str(payload)[:120]}")
        return key

    async def _drop_key(self) -> None:
        """Закрыть ключ за собой: брошенные ключи биржа считает соединениями."""
        try:
            await self._key_request("DELETE")
        except Exception as exc:  # noqa: BLE001 - ключ истечёт сам через час
            logger.debug("Ключ приватного потока Binance не закрыт: %s", exc)
        self._listen_key = ""

    async def _keepalive(self) -> None:
        """Продление ключа раз в полчаса: он живёт час, и час - это немного."""
        try:
            while True:
                await asyncio.sleep(KEY_RENEW)
                await self._key_request("PUT")
                logger.debug("Ключ приватного потока Binance продлён")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - разрывом займётся _run
            logger.warning("Ключ приватного потока Binance не продлён: %s", exc)

    # ── соединение ──────────────────────────────────────────────────────────

    async def _connect_once(self) -> None:
        self._listen_key = await self._new_key()
        session = await self._http()
        url = ws_url(self.testnet, self._listen_key, self._ws_base)
        # `heartbeat` здесь не нужен: служебный `ping` шлёт биржа, а отвечает
        # на него библиотека.
        async with session.ws_connect(url, max_msg_size=0) as ws:
            self._ws = ws
            logger.info("Приватный поток Binance подключён")
            self._renew = asyncio.create_task(self._keepalive(), name="binance-private-key")
            await self._take_snapshot()
            async for msg in ws:
                if msg.type is aiohttp.WSMsgType.TEXT:
                    self._dispatch(msg.data)
                elif msg.type is aiohttp.WSMsgType.BINARY:
                    self._dispatch(msg.data.decode("utf-8", "replace"))
        await self._close()

    async def _take_snapshot(self) -> None:
        """Снимок позиций запросом: канал его не даёт, а без него верить нечему."""
        try:
            rows = await asyncio.wait_for(self._snapshot(), timeout=SNAPSHOT_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Снимок позиций Binance не получен: %s", exc)
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
        self._resync = asyncio.create_task(self._take_snapshot(), name="binance-private-snapshot")

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

        event = str(payload.get("e") or "")
        if event == EVENT_KEY_GONE:
            # Соединение живо, но событий в нём больше не будет. Молчащий поток
            # опаснее оборвавшегося: сопровождение считало бы позиции
            # неизменными. Рвём сами - `_run` возьмёт новый ключ и новый снимок.
            logger.info("Binance: ключ приватного потока истёк - переподключаемся")
            self._ready = False
            if self._ws and not self._ws.closed:
                asyncio.create_task(self._ws.close(), name="binance-private-reconnect")
            return
        if event == EVENT_ACCOUNT:
            self._apply_account(payload)
        elif event == EVENT_ORDER:
            self._apply_order(payload)

    def _apply_account(self, payload: dict) -> None:
        """Изменения позиций из события счёта. Нулевой объём - позиция закрыта."""
        if not self._ready:
            # Снимка ещё нет: применять изменения не к чему, а собранный по
            # одним изменениям список разошёлся бы с биржей.
            return
        changed = False
        for row in account_positions(payload):
            name = str(row.get("symbol") or "").upper()
            position = position_row(row)
            if position is None:
                side = str(row.get("positionSide") or "").upper()
                keys = (
                    [(name, side)]
                    if side in ("LONG", "SHORT")
                    else [(name, "LONG"), (name, "SHORT")]
                )
                for key in keys:
                    changed = self._positions.pop(key, None) is not None or changed
                continue
            self._positions[(position["symbol"], position["positionSide"])] = position
            changed = True
        if changed and self._on_positions:
            self._on_positions(self.positions())

    def _apply_order(self, payload: dict) -> None:
        """Заявка изменилась: при исполнении - снимок, всегда - будим сопровождение."""
        event = order_event(payload)
        symbol = event["symbol"]
        if not symbol:
            return

        if event["status"] in FILL_STATES:
            # Позиция изменилась - и это то место, где ошибка в её размере
            # стоит денег: по нему считается лестница целей и объём стопа.
            self._resnapshot()

        if self._on_orders:
            try:
                self._on_orders(symbol)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Сбой обработчика события заявки Binance")
