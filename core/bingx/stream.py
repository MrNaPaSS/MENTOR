"""Приватный поток BingX: позиции и заявки счёта.

Зачем он нужен, лучше всего видно из цифр опроса. Терминал спрашивает сервер
раз в три-четыре секунды, а после взятой цели - каждые семь десятых; сервер на
каждый такой вопрос ходил на биржу, и сопровождение обходит те же счета своим
кругом. На сотне учеников это десятки запросов в секунду с одного адреса, а
BingX считает частоту и по счёту, и по адресу - и режет ровно тогда, когда надо
переставить стоп.

Устроен как поток OKX (`core/okx/stream.py`), с тремя отличиями, каждое из
которых обязательно, иначе поток не работает вовсе:

* **вход по ключу, а не подписью в сокете.** Ключ (`listenKey`) берётся ручкой,
  живёт час и продлевается `PUT` раз в полчаса; при закрытии - `DELETE`;
* **сообщения сжаты (gzip).** Это не открытый JSON, как у Binance и OKX;
* **биржа шлёт текстовый `Ping`**, на который надо ответить `Pong`, иначе
  соединение закроют.

И одно отличие по существу: **снимка позиций канал не даёт**. У OKX канал
позиций присылает состояние при подписке, здесь же приходят только изменения.
Собранный по одним изменениям список молча разошёлся бы с биржей - и пустой
список после подключения сопровождение приняло бы за закрытую позицию. Поэтому
снимок берётся запросом при каждом подключении, и до него поток себя живым не
считает: пока `ready` ложно, позиции спрашиваются у биржи, как раньше.

После каждого исполнения снимок берётся заново. Событие счёта приходит и само,
но исполнение - то единственное место, где ошибка в размере позиции стоит
денег: на нём считается лестница целей и объём стопа.

Отдельно здесь живёт `o.ti` - номер условной заявки, связанной с исполненной.
У стопов и целей BingX своего идентификатора нет (ТЗ BingX, §3.2), и эта связь
- второй способ узнать свою защиту, кроме номера, записанного при постановке.
Пока связь не проверена на демо, она только копится и отдаётся наружу
(`linked`), решений по ней не принимается.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable

import aiohttp

from core.bingx.market import (
    BASE_URL,
    DEMO_URL,
    ENDPOINTS,
    client_id,
    position_row,
    symbol_of,
)
from core.weex.futures import Credentials

logger = logging.getLogger("nmnh.bingx.stream")

# Адрес приватного потока. Ключ идёт **параметром**: с ключом в пути биржа
# отвечает 403 на обоих контурах (проверено на живом демо-счёте 14 сентября
# 2026). Второе написание оставлено запасным - на случай, если биржа однажды
# передумает; лишняя попытка стоит доли секунды, а молчащий поток означает
# возврат к опросу.
WS_PRIVATE = "wss://open-api-swap.bingx.com/swap-market"
WS_PRIVATE_DEMO = "wss://vst-open-api-ws.bingx.com/swap-market"

# Ключ живёт час. Продлеваем вдвое чаще: сетевой сбой не должен стоить
# соединения.
KEY_TTL = 3600.0
KEY_RENEW = 1800.0

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Сколько ждём первого снимка позиций. Не пришёл - поток бесполезен: он не
# знает, что на счёте, и молчание выглядело бы как счёт без позиций.
SNAPSHOT_TIMEOUT = 10.0

EVENT_ORDER = "ORDER_TRADE_UPDATE"
EVENT_ACCOUNT = "ACCOUNT_UPDATE"

# Статусы заявки, после которых состояние позиции точно изменилось.
FILL_STATES = ("FILLED", "PARTIALLY_FILLED")


def urls(demo: bool, listen_key: str, base: str | None = None) -> tuple[str, ...]:
    """Адреса подключения по порядку предпочтения, с ключом в каждом."""
    root = base or os.getenv("BINGX_WS_PRIVATE", "").strip() or (
        WS_PRIVATE_DEMO if demo else WS_PRIVATE
    )
    root = root.rstrip("/")
    return (f"{root}?listenKey={listen_key}", f"{root}/{listen_key}")


def account_positions(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Позиции из события счёта, в тех же полях, что отдаёт справочная ручка.

    Поля в потоке короткие: `s` пара, `pa` объём, `ep` цена входа, `up`
    незафиксированный итог, `ps` сторона. Переводим их в имена REST-ответа и
    отдаём общему переводчику (`position_row`) - разойтись этим двум местам
    нельзя, сопровождение читает результат как одно и то же.
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
                "avgPrice": row.get("ep") or "0",
                "unrealizedProfit": row.get("up") or "0",
                "positionSide": str(row.get("ps") or "").upper(),
                "initialMargin": row.get("iw") or "",
            }
        )
    return out


def order_event(event: dict[str, Any]) -> dict[str, Any]:
    """Событие заявки в читаемых именах. Пустая пара - событие не наше."""
    order = event.get("o") if isinstance(event.get("o"), dict) else {}
    return {
        "symbol": symbol_of(str(order.get("s") or "")),
        "orderId": str(order.get("i") or ""),
        "clientOrderId": client_id(order.get("c")),
        "type": str(order.get("o") or "").upper(),
        "status": str(order.get("X") or "").upper(),
        "side": str(order.get("S") or "").upper(),
        "positionSide": str(order.get("ps") or "").upper(),
        # Номер связанной условной заявки - та самая связь, которой у нас нет
        # другого способа получить.
        "linkedOrderId": str(order.get("ti") or ""),
    }


class BingxPrivateStream:
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
        demo: bool = False,
        base_url: str | None = None,
        ws_url: str | None = None,
    ):
        self.creds = creds
        # Снимок позиций даёт торговый клиент: адрес, подпись и перевод полей у
        # него уже есть, и второй такой же код здесь разошёлся бы с ним.
        self._snapshot = snapshot
        self._on_positions = on_positions
        self._on_orders = on_orders
        self._on_down = on_down
        self.demo = demo
        self.base_url = base_url or (DEMO_URL if demo else BASE_URL)
        self._ws_url = ws_url

        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._task: asyncio.Task | None = None
        self._renew: asyncio.Task | None = None
        self._resync: asyncio.Task | None = None
        self._listen_key = ""
        self._ready = False
        # Позиции по ключу «пара и сторона», уже в полях WEEX.
        self._positions: dict[tuple[str, str], dict] = {}
        # Связь «наша заявка - её условная заявка», из поля `o.ti`.
        self._links: dict[str, set[str]] = {}
        # Когда поток последний раз подтверждал, что жив.
        self.alive_at = 0.0

    # ── состояние ───────────────────────────────────────────────────────────

    @property
    def ready(self) -> bool:
        """Соединение живо и снимок позиций получен.

        До снимка поток живым себя не считает намеренно: пустой список позиций
        сопровождение приняло бы за закрытую сделку.
        """
        return bool(self._ws) and not self._ws.closed and self._ready

    def positions(self) -> list[dict]:
        return list(self._positions.values())

    def linked(self, client_order_id: str | None) -> set[str]:
        """Условные заявки, связанные с нашей заявкой, по данным потока."""
        return set(self._links.get(client_id(client_order_id), set()))

    # ── жизненный цикл ──────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="bingx-private")

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
        self._links.clear()
        self._ready = False
        self.alive_at = 0.0
        if self._on_down:
            try:
                self._on_down()
            except Exception:  # noqa: BLE001
                logger.exception("Сбой обработчика обрыва приватного потока BingX")

    async def _run(self) -> None:
        delay = RECONNECT_MIN
        while True:
            try:
                await self._connect_once()
                delay = RECONNECT_MIN
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Приватный поток BingX оборвался: %s", exc)
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
        params = {"listenKey": self._listen_key} if self._listen_key else None
        async with session.request(
            method,
            url,
            params=params,
            headers={"X-BX-APIKEY": self.creds.api_key},
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
        data = payload.get("data") if isinstance(payload, dict) else None
        row = data if isinstance(data, dict) else (payload if isinstance(payload, dict) else {})
        key = str(row.get("listenKey") or "")
        if not key:
            raise RuntimeError(f"биржа не выдала ключ потока: {str(payload)[:120]}")
        return key

    async def _drop_key(self) -> None:
        """Закрыть ключ за собой: брошенные ключи биржа считает соединениями."""
        try:
            await self._key_request("DELETE")
        except Exception as exc:  # noqa: BLE001 - ключ истечёт сам через час
            logger.debug("Ключ приватного потока BingX не закрыт: %s", exc)
        self._listen_key = ""

    async def _keepalive(self) -> None:
        """Продление ключа раз в полчаса: он живёт час, и час - это немного."""
        try:
            while True:
                await asyncio.sleep(KEY_RENEW)
                await self._key_request("PUT")
                logger.debug("Ключ приватного потока BingX продлён")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - разрывом займётся _run
            logger.warning("Ключ приватного потока BingX не продлён: %s", exc)

    # ── соединение ──────────────────────────────────────────────────────────

    async def _connect_once(self) -> None:
        self._listen_key = await self._new_key()
        session = await self._http()
        candidates = urls(self.demo, self._listen_key, self._ws_url)

        last: Exception | None = None
        for url in candidates:
            try:
                await self._live(session, url)
                return
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                # Биржа называет два написания адреса, и лишнее - не ошибка
                # настройки, а вопрос контура: пробуем второе, прежде чем
                # объявлять поток мёртвым.
                logger.debug("BingX: адрес потока %s не ответил (%s)", url, exc)
                last = exc
        if last is not None:
            raise last

    async def _live(self, session: aiohttp.ClientSession, url: str) -> None:
        async with session.ws_connect(url, heartbeat=None, max_msg_size=0) as ws:
            self._ws = ws
            logger.info("Приватный поток BingX подключён")
            self._renew = asyncio.create_task(self._keepalive(), name="bingx-private-key")
            await self._take_snapshot()
            async for msg in ws:
                if msg.type is aiohttp.WSMsgType.BINARY:
                    await self._dispatch(ws, _unpack(msg.data))
                elif msg.type is aiohttp.WSMsgType.TEXT:
                    await self._dispatch(ws, msg.data)
        await self._close()

    async def _take_snapshot(self) -> None:
        """Снимок позиций запросом: канал его не даёт, а без него верить нечему."""
        try:
            rows = await asyncio.wait_for(self._snapshot(), timeout=SNAPSHOT_TIMEOUT)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Снимок позиций BingX не получен: %s", exc)
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
        self._resync = asyncio.create_task(self._take_snapshot(), name="bingx-private-snapshot")

    # ── разбор сообщений ────────────────────────────────────────────────────

    async def _dispatch(self, ws, raw: str) -> None:
        # Любое сообщение - подтверждение, что соединение живо.
        self.alive_at = time.monotonic()
        if not raw:
            return
        if raw.strip().lower() == "ping":
            # Ответ обязателен: без него биржа закрывает соединение.
            await ws.send_str("Pong")
            return
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return

        event = str(payload.get("e") or payload.get("dataType") or "")
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
                    [(symbol_of(name), side)]
                    if side in ("LONG", "SHORT")
                    else [(symbol_of(name), "LONG"), (symbol_of(name), "SHORT")]
                )
                for key in keys:
                    changed = self._positions.pop(key, None) is not None or changed
                continue
            self._positions[(position["symbol"], position["positionSide"])] = position
            changed = True
        if changed and self._on_positions:
            self._on_positions(self.positions())

    def _apply_order(self, payload: dict) -> None:
        """Заявка изменилась: запоминаем связь, будим сопровождение."""
        event = order_event(payload)
        symbol = event["symbol"]
        if not symbol:
            return

        linked = event["linkedOrderId"]
        mark = event["clientOrderId"]
        if linked and mark:
            self._links.setdefault(mark, set()).add(linked)

        if event["status"] in FILL_STATES:
            # Позиция изменилась - и это то место, где ошибка в её размере
            # стоит денег: по нему считается лестница целей и объём стопа.
            self._resnapshot()

        if self._on_orders:
            try:
                self._on_orders(symbol)
            except Exception:  # noqa: BLE001 - сбой обработчика не рвёт поток
                logger.exception("Сбой обработчика события заявки BingX")


def _unpack(data: bytes) -> str:
    """Распаковать сообщение: BingX шлёт их сжатыми, а не открытым текстом."""
    try:
        return gzip.decompress(data).decode("utf-8", "replace")
    except (OSError, EOFError, ValueError):
        # Не сжато - бывает на управляющих сообщениях.
        return data.decode("utf-8", "replace")
