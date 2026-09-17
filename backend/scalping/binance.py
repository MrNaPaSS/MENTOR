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
import os
import time
from collections import deque
import json
import logging
from typing import Any, Awaitable, Callable

import aiohttp

from backend.trading import health

logger = logging.getLogger("nmnh.scalping.binance")

REST_BASE = "https://fapi.binance.com"
WS_BASE = "wss://fstream.binance.com/stream"

# Биржа рвёт соединение раз в сутки штатно, плюс бывают сетевые обрывы.
# Пауза между попытками растёт до потолка, чтобы не долбить биржу при аварии.
RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

# Управляющих сообщений биржа принимает не больше 10 в секунду.
CONTROL_RATE_DELAY = 0.15

# Сколько тишины считаем смертью соединения.
#
# Раньше живость сторожил сам aiohttp: свой ping раз в 30 секунд и обрыв, если
# pong не пришёл за половину этого срока. На столе соединение жило 40 секунд и
# рвалось кодом 1006 - сто восемьдесят раз за день, - а в журнале рядом стояло
# «Cannot write to closing transport»: ping уходил в сокет, который уже
# закрывался. Каждый такой обрыв ломал книги всех монет разом и выбирал бюджет
# веса на пересборку.
#
# Своя проверка честнее: поток жив, пока по нему идут сообщения. Биржа шлёт
# свой ping раз в три минуты, и aiohttp отвечает на него сам - соединение не
# простаивает даже на спящей монете.
#
# Сроки разные: стаканы полусотни монет сыплют по нескольку сообщений в
# секунду, и полминуты тишины там значит обрыв. Лента одной тихой монеты ночью
# молчит и дольше, и рвать её по той же мерке значит переподключаться на
# ровном месте.
STALL_DEPTH = 30.0
STALL_TAPE = 120.0

# На сколько соединений раскладывается лента.
#
# Восемь: на полусотне монет это по шесть-семь на соединение, то есть сотни
# сообщений в секунду вместо двух тысяч. Мельче делить смысла мало - дальше
# упрёмся в одну монету: лента BTC сама по себе это около пятисот сообщений в
# секунду, и надвое её не разложить. Если рвать будет и на этом, останется
# сжатая лента (см. TAPE_STREAM в collector.py).
TAPE_SOCKETS = 8

# На сколько соединений раскладываются стаканы.
#
# Их поток легче ленты вдесятеро, и рвутся они куда реже: в живом замере два
# обрыва за девять минут против шести за две с половиной у неразложенной ленты.
# Но цена обрыва здесь выше - дыра в книгах всех монет соединения разом, и
# каждая идёт за снимком. Четыре соединения делят эту цену вчетверо.
DEPTH_SOCKETS = 4

# Пауза после отказа по лимиту. Растёт вдвое, пока биржа не ответит нормально:
# 418 — это бан адреса, и каждый запрос во время бана продлевает его.
BAN_BACKOFF_MIN = 30.0
BAN_BACKOFF_MAX = 600.0

# Бюджет веса запросов. Биржа даёт 2400 единиц в минуту на адрес; берём три
# четверти и держимся их сами, не дожидаясь предупреждения. Реагировать на 429
# поздно: за ним приходит 418, а это уже бан адреса на десятки минут.
#
# Половины не хватало: обрыв потока делает недействительными все книги разом, и
# пересборка полусотни монет выбирала остаток до дна - скринер оставался
# пустым на полминуты (живой стол, 16 сентября).
WEIGHT_BUDGET = 1800
WEIGHT_WINDOW = 60.0

# Доля бюджета процессу сайта, когда рыночные данные вынесены отдельно
# (`NMNH_MARKET=1`).
#
# Вес биржа считает по адресу, а не по процессу: два счётчика по 1800 на одной
# машине выбирают 3600 из 2400, которые даёт биржа. Живой стол 17 сентября,
# сразу после разделения: «потрачено 1690 из 1400 за минуту, фоновых отказов
# 21» - и половина стаканов без снимка.
#
# Сайту хватает малого: рыночные ручки редкие и с кэшем, а потоки, снимки
# стаканов и свечи терминала живут в процессе рынка.
SITE_SHARE = 0.2

# Сколько веса фоновым запросам не достаётся никогда: его держим за запросами
# трейдера - свечами графика и разбором свечи. После запуска сервер берёт
# снимки стаканов по всем монетам скринера разом и выбирал бюджет до дна, а
# график у трейдера в эту минуту отвечал 502: его свечи стояли в той же очереди.
INTERACTIVE_RESERVE = 400


def weight_budget(role: str | None = None, apart: str | None = None) -> tuple[int, int]:
    """Сколько веса достаётся этому процессу: (весь бюджет, резерв трейдеру).

    Один процесс - весь бюджет, как было. Рыночные данные вынесены отдельно -
    сборщику большая часть, сайту остаток: считать порознь и каждому по полному
    пределу значит выбрать чужой и получить бан на адрес.
    """
    name = (role if role is not None else os.getenv("NMNH_ROLE", "all")).strip().lower()
    raw = apart if apart is not None else os.getenv("NMNH_MARKET", "")
    if raw.strip().lower() not in ("1", "true", "yes"):
        return WEIGHT_BUDGET, INTERACTIVE_RESERVE
    site = int(WEIGHT_BUDGET * SITE_SHARE)
    budget = WEIGHT_BUDGET - site if name == "market" else site
    # Резерв трейдеру - той же долей: у процесса с малым бюджетом прежние
    # четыреста не оставили бы фоновым ничего.
    return budget, max(1, round(INTERACTIVE_RESERVE * budget / WEIGHT_BUDGET))

# Вес известных запросов по документации биржи.
WEIGHTS = {
    "/fapi/v1/depth": 10,       # при лимите до 500 уровней; глубже - см. depth_weight
    "/fapi/v1/klines": 2,
    "/fapi/v1/aggTrades": 20,   # страница сделок, до тысячи штук
    "/fapi/v1/ticker/24hr": 40,  # сводка по всем инструментам
}
DEFAULT_WEIGHT = 5


def depth_weight(limit: int) -> int:
    """Вес снимка стакана: у биржи он растёт с глубиной - 2/5/10/20."""
    if limit <= 50:
        return 2
    if limit <= 100:
        return 5
    if limit <= 500:
        return 10
    return 20


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
        # Потраченный вес: (когда, сколько). Старше минуты выбрасывается.
        self._spent: deque[tuple[float, int]] = deque()
        # Свой предел: он зависит от того, один процесс ходит на биржу или два.
        self.budget, self.reserve = weight_budget()
        # Фоновые отказы бюджета за минуту - для одной сводной строки в журнале.
        self._refused = 0
        self._refused_logged = 0.0

    @property
    def blocked(self) -> bool:
        return time.monotonic() < self._blocked_until

    @property
    def blocked_for(self) -> float:
        return max(0.0, self._blocked_until - time.monotonic())

    def _block(self, seconds: float) -> None:
        self._blocked_until = time.monotonic() + seconds
        logger.warning("Биржа закрыта для запросов на %.0f с", seconds)

    def _spent_weight(self, now: float) -> int:
        """Сколько веса потрачено за последнюю минуту."""
        while self._spent and now - self._spent[0][0] > WEIGHT_WINDOW:
            self._spent.popleft()
        return sum(w for _, w in self._spent)

    async def _reserve(
        self, path: str, weight: int | None = None, background: bool = False
    ) -> bool:
        """Занять вес под запрос. False — бюджет исчерпан, запрос не пойдёт.

        Фоновым достаётся не весь бюджет: INTERACTIVE_RESERVE держится за
        запросами трейдера.
        """
        weight = weight or WEIGHTS.get(path, DEFAULT_WEIGHT)
        now = time.monotonic()
        spent = self._spent_weight(now)
        ceiling = self.budget - self.reserve if background else self.budget
        if spent + weight > ceiling:
            # Отказ трейдеру - предупреждение сразу. Фоновые отказы копятся и
            # уходят одной строкой раз в минуту: сорок одинаковых строк ничего
            # не говорят, а полная тишина прятала причину пустого стакана - в
            # журнале было только «снимок не получен», и не видно почему.
            if not background:
                logger.warning(
                    "Бюджет запросов исчерпан (%d из %d за минуту), %s отложен",
                    spent,
                    ceiling,
                    path,
                )
            else:
                self._refused += 1
                if now - self._refused_logged >= WEIGHT_WINDOW:
                    logger.warning(
                        "Бюджет запросов Binance исчерпан: потрачено %d из %d за минуту, "
                        "фоновых отказов %d",
                        spent,
                        ceiling,
                        self._refused,
                    )
                    self._refused = 0
                    self._refused_logged = now
            return False
        self._spent.append((now, weight))
        return True

    def budget_free_in(self, weight: int = 10, background: bool = True) -> float:
        """Через сколько секунд запрос такого веса уложится в бюджет. Ноль - уже.

        Пауза «двадцать секунд на всё» при нехватке бюджета повторяла снимки
        всей полусотни монет раньше, чем бюджет успевал освободиться: они снова
        получали отказ и держали его исчерпанным. Ждать надо ровно столько,
        сколько нужно окну, чтобы выпустить старые запросы.
        """
        now = time.monotonic()
        spent = self._spent_weight(now)
        ceiling = self.budget - self.reserve if background else self.budget
        need = spent + weight - ceiling
        if need <= 0:
            return 0.0
        freed = 0
        for at, used in self._spent:
            freed += used
            if freed >= need:
                return max(0.0, at + WEIGHT_WINDOW - now)
        return WEIGHT_WINDOW

    async def _get(
        self,
        path: str,
        params: dict | None = None,
        *,
        weight: int | None = None,
        background: bool = False,
    ) -> Any:
        if self.blocked:
            return None
        # Держим себя в лимите сами. Дожидаться предупреждения от биржи поздно:
        # за 429 приходит 418, а это бан адреса на десятки минут.
        if not await self._reserve(path, weight, background):
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

    async def depth(
        self, symbol: str, limit: int = 1000, background: bool = True
    ) -> dict | None:
        """Снимок стакана. Берётся один раз на подписку, дальше — поток.

        Обычно фоновый: снимки монет скринера берёт сборщик сам, их никто не
        ждёт. Но стакан монеты, открытой у трейдера на экране, ждут - такой
        снимок идёт наравне со свечами, иначе при запуске он стоял в очереди за
        полусотней чужих, и стакан пропадал с экрана.
        """
        data = await self._get(
            "/fapi/v1/depth",
            {"symbol": symbol.upper(), "limit": limit},
            weight=depth_weight(limit),
            background=background,
        )
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

    async def agg_trades(
        self,
        symbol: str,
        start_ms: int,
        end_ms: int,
        limit: int = 1000,
        from_id: int | None = None,
    ) -> list[dict]:
        """Страница сделок за окно: из них собирается профиль объёма свечи.

        Дорогой запрос — двадцать единиц веса против двух у свечей, — поэтому
        зовётся только по нажатию трейдера и только за прошлое: текущая свеча
        собирается из ленты, которая и так идёт к нам потоком.

        Биржа отдаёт не больше тысячи сделок за раз и требует, чтобы окно
        `startTime`/`endTime` укладывалось в час. Продолжение берётся по
        `fromId`: по времени продолжать нельзя — в одну миллисекунду попадает
        десяток сделок, и часть из них терялась бы на каждой границе страниц.
        """
        params: dict[str, Any] = {"symbol": symbol.upper(), "limit": min(limit, 1000)}
        if from_id is not None:
            params["fromId"] = from_id
        else:
            params["startTime"] = int(start_ms)
            params["endTime"] = int(end_ms)
        data = await self._get("/fapi/v1/aggTrades", params)
        return data if isinstance(data, list) else []

    async def tickers_24h(self) -> list[dict]:
        """Суточная сводка по всем инструментам одним запросом. Фоновый."""
        data = await self._get("/fapi/v1/ticker/24hr", background=True)
        return data if isinstance(data, list) else []


class StreamClient:
    """Одно соединение с комбинированным потоком и подписки поверх него.

    Держим ровно один сокет на процесс: биржа разрешает до 1024 потоков в
    соединении, а лимит на число соединений с одного адреса куда жёстче.
    Подписки меняются на лету — при переключении монеты пересоединяться не надо.
    """

    def __init__(
        self,
        on_message: Callable[[str, dict], None],
        name: str = "",
        stall: float = STALL_DEPTH,
    ):
        self._on_message = on_message
        # Сколько тишины терпим, прежде чем считать соединение мёртвым.
        self._stall = stall
        # Подпись соединения в журнале: «стаканы» или «лента», когда их два.
        self._name = name
        self._label = f" ({name})" if name else ""
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
            suffix = f"-{self._name}" if self._name else ""
            self._task = asyncio.create_task(self._run(), name=f"binance-stream{suffix}")

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
                logger.warning("Поток Binance%s оборвался: %s", self._label, exc)
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
        # Без своего heartbeat: он и рвал соединение (см. STALL_DEPTH выше).
        # Отвечать на ping биржи aiohttp продолжает сам.
        async with self._session.ws_connect(url, heartbeat=None, max_msg_size=0) as ws:
            self._ws = ws
            self._connected.set()
            opened = time.monotonic()
            health.note_stream("binance", up=True)
            logger.info("Поток Binance%s подключён, потоков: %d", self._label, len(initial))

            # Пока сокет поднимался, набор мог измениться — досылаем разницу.
            async with self._lock:
                extra = self._streams - set(initial)
            if extra:
                await self._control("SUBSCRIBE", extra)

            why = ""
            try:
                why = await self._read(ws)
            finally:
                # Почему поток закрылся - в журнал и в панель. Каждое
                # переподключение рвёт цепочку обновлений у всех книг разом, и
                # все они идут за снимком: без причины не отличить штатный обрыв
                # биржи от нашей собственной ошибки. Пишем и при исключении -
                # иначе обрыв по ошибке чтения не попадал бы в счёт вовсе.
                lived = time.monotonic() - opened
                logger.warning(
                    "Поток Binance%s закрыт: %s, код %s, %s (жил %.0f с, потоков %d)",
                    self._label,
                    why or "чтение прервано",
                    ws.close_code,
                    ws.exception() or "без ошибки",
                    lived,
                    len(initial),
                )
                health.note_stream("binance", up=False)
                # Время жизни соединения - не задержка ответа: в панели оно шло
                # бы в задержки и рисовало «ответ обычно 43 секунды».
                # С именем соединения: рвётся лента или стаканы - это разные
                # беды и разные лекарства. Лента везёт тысячу сообщений в
                # секунду и её обрыв книг не трогает; обрыв стаканов рушит все
                # книги разом. В панели они стояли одной строкой.
                health.note_call(
                    "binance",
                    0.0,
                    False,
                    health.STREAM,
                    f"{why or 'чтение прервано'}{self._label}",
                )
        self._ws = None

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> str:
        """Читать сообщения, пока поток жив. Возвращает причину остановки.

        Своим ожиданием, а не `async for`: молчащее соединение иначе висит до
        обрыва на той стороне, а его может и не быть - сокет, оборванный сетью
        посередине, молчит вечно. Тишина дольше срока значит, что обновлений
        нет и книги уже неверны: честнее переподключиться.
        """
        closing = (
            aiohttp.WSMsgType.CLOSE,
            aiohttp.WSMsgType.CLOSING,
            aiohttp.WSMsgType.CLOSED,
        )
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=self._stall)
            except asyncio.TimeoutError:
                return f"тишина {self._stall:.0f} с"
            if msg.type in closing:
                return f"обрыв {ws.close_code}"
            if msg.type is aiohttp.WSMsgType.ERROR:
                return f"ошибка {msg.data}"
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            self._dispatch(msg.data)

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


def is_depth_stream(name: str) -> bool:
    """Поток стакана: `btcusdt@depth@500ms` и подобные."""
    return "@depth" in str(name)


class StreamFan:
    """Потоки, разложенные по нескольким соединениям.

    Живой замер на столе (`check_binance_stream.py`, процесс, который только
    читает и больше ничего не делает): лента полусотни монет - это две тысячи
    сообщений в секунду в одном соединении, и оно умирает каждые двадцать
    секунд кодом 1006, то есть обрывом без прощания. Стаканы тех же монет -
    семьдесят сообщений в секунду - живут минутами. Разбор тут ни при чём:
    пустой процесс рвался так же, как сервер.

    Значит рвётся толстый поток, а не наш код, и лекарство - раскладывать его
    тоньше. Монеты разводятся по соединениям раз и навсегда, по остатку от
    номера имени: на одном соединении остаётся десятая часть ленты, а обрыв
    уносит десятую часть монет на секунду, а не всю ленту целиком.

    Живая проверка на столе после правки: лента полусотни монет по восьми
    соединениям - ни одного обрыва за девять минут против одного каждые
    двадцать секунд в одном соединении.

    Снаружи это один поток: подписка, отписка, запуск, остановка и список
    потоков - как у одного соединения.
    """

    def __init__(
        self,
        on_message: Callable[[str, dict], None],
        name: str = "лента",
        sockets: int = TAPE_SOCKETS,
        stall: float = STALL_TAPE,
    ):
        count = max(1, int(sockets))
        self.sockets = [
            StreamClient(on_message, name=f"{name} {i + 1}", stall=stall)
            for i in range(count)
        ]
        # Где какой поток. Раз выбранное соединение не меняется: перебрасывать
        # монету между соединениями значит рвать её ленту на ровном месте.
        self._where: dict[str, int] = {}

    def _spread(self, streams: set[str]) -> dict[int, set[str]]:
        """Разложить потоки по соединениям, ровно по числу монет.

        Не по остатку от номера имени: на полусотне монет тот давал пятнадцать
        на одном соединении против шести на другом, а мы затем и делим поток,
        чтобы толстых не осталось.
        """
        out: dict[int, set[str]] = {}
        counts = [len(one.streams) for one in self.sockets]
        for stream in sorted(streams):
            place = self._where.get(stream)
            if place is None:
                place = min(range(len(self.sockets)), key=lambda i: counts[i])
                self._where[stream] = place
                counts[place] += 1
            out.setdefault(place, set()).add(stream)
        return out

    @property
    def streams(self) -> frozenset[str]:
        out: set[str] = set()
        for socket in self.sockets:
            out |= socket.streams
        return frozenset(out)

    @property
    def connected(self) -> bool:
        """Жив ли поток. Хотя бы одно соединение из нескольких - уже поток."""
        return any(socket.connected for socket in self.sockets)

    def start(self) -> None:
        for socket in self.sockets:
            socket.start()

    async def stop(self) -> None:
        for socket in self.sockets:
            await socket.stop()

    async def subscribe(self, streams: set[str]) -> None:
        for place, part in self._spread(streams).items():
            await self.sockets[place].subscribe(part)

    async def unsubscribe(self, streams: set[str]) -> None:
        for place, part in self._spread(streams).items():
            await self.sockets[place].unsubscribe(part)
        for stream in streams:
            self._where.pop(stream, None)


class SplitStreamClient:
    """Стаканы и лента сделок - в разных соединениях, с тем же интерфейсом.

    В одном соединении лента давала около тысячи сообщений в секунду из тысячи
    ста, а стаканы - девяносто. Обрыв такого соединения ломал книги всех
    полусотни монет разом: каждая шла за снимком, бюджет веса выбирался до дна,
    и скринер стоял пустым. Теперь обрыв ленты книг не трогает - лента просто
    пропускает несколько секунд, а это ни одного запроса к бирже. И в журнале
    видно, какое из соединений рвётся.

    Сборщику это тот же клиент: подписка, отписка, запуск, остановка, список
    потоков и признак подключения.
    """

    def __init__(self, on_message: Callable[[str, dict], None]):
        # Стаканы тоже по нескольким соединениям, хоть они и легче ленты
        # вдесятеро. Дело не в весе, а в цене обрыва: он оставляет дыру в
        # книгах всех монет соединения разом, и каждая идёт за снимком - на
        # полусотне это бюджет веса до дна и пустой скринер. На четырёх
        # соединениях такой обрыв уносит четверть монет.
        self.depth = StreamFan(
            on_message, name="стаканы", sockets=DEPTH_SOCKETS, stall=STALL_DEPTH
        )
        self.tape = StreamFan(
            on_message, name="лента", sockets=TAPE_SOCKETS, stall=STALL_TAPE
        )

    @staticmethod
    def _split(streams: set[str]) -> tuple[set[str], set[str]]:
        depth = {s for s in streams if is_depth_stream(s)}
        return depth, set(streams) - depth

    @property
    def streams(self) -> frozenset[str]:
        return self.depth.streams | self.tape.streams

    @property
    def connected(self) -> bool:
        # По соединению стаканов: от него зависят книги, а без ленты скринер
        # лишь на несколько секунд теряет свежие сделки.
        return self.depth.connected

    @property
    def tape_connected(self) -> bool:
        return self.tape.connected

    def start(self) -> None:
        self.depth.start()
        self.tape.start()

    async def stop(self) -> None:
        await self.depth.stop()
        await self.tape.stop()

    async def subscribe(self, streams: set[str]) -> None:
        depth, tape = self._split(streams)
        if depth:
            await self.depth.subscribe(depth)
        if tape:
            await self.tape.subscribe(tape)

    async def unsubscribe(self, streams: set[str]) -> None:
        depth, tape = self._split(streams)
        if depth:
            await self.depth.unsubscribe(depth)
        if tape:
            await self.tape.unsubscribe(tape)
