"""Приватные потоки бирж по счетам: кто подключён и кого будить.

Опрос биржи - самое дорогое место сопровождения. Терминал спрашивает позиции
раз в несколько секунд, после взятой цели - каждые семь десятых; обход
сопровождения идёт своим кругом; на девяти биржах у каждой свои лимиты на ключ
и на адрес. Приватный поток снимает обе беды разом: позиции приходят сами, а
об исполнении биржа сообщает в момент, а не через пять секунд (ТЗ мультибиржи,
§10.2).

Кто включается и когда:

* поток заводится на счёт, где **есть живая сделка терминала** - именно её
  сопровождение и ведёт. Счета без сделок потока не держат: соединение стоит
  памяти, а спрашивать о них некому;
* поток гаснет, когда на счёте не осталось живых сделок;
* поток есть не у каждой биржи. У OKX, BingX, MEXC и Binance он описан и
  открыт; у WEEX приватного потока в документации брокера не названо, и счета
  WEEX остаются на опросе - это честнее, чем догадываться об адресе.

Потоки бирж устроены по-разному, и разница видна здесь одним местом: OKX
присылает снимок позиций сама, а BingX и MEXC - только изменения, поэтому их
потокам нужен торговый клиент, которым они возьмут снимок при подключении
(`core/bingx/stream.py`, `core/mexc/stream.py`).

Событие о заявке здесь не превращается в состояние: каналы заявок снимка не
дают, и собранный по ним список молча разошёлся бы с биржей. Событие работает
звонком - сбрасывает память чтений и будит сопровождение, а список заявок
по-прежнему спрашивается у биржи.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp

from sqlalchemy import select

from backend.trading import health, live_state
from backend.trading.accounts import account_for, trade_exchange
from core.models import LiveTrade
from core.binance.futures import BinanceFutures
from core.binance.stream import BinancePrivateStream
from core.bingx.futures import BingxFutures
from core.bingx.stream import BingxPrivateStream
from core.mexc.futures import MexcFutures
from core.mexc.stream import MexcPrivateStream
from core.models import ExchangeAccount
from core.okx.futures import load_instruments
from core.okx.stream import OkxPrivateStream
from core.weex import keys as keystore
from core.weex.futures import Credentials

logger = logging.getLogger("nmnh.trading.stream")

# Биржи, у которых приватный поток описан и подключён.
STREAMED = ("okx", "bingx", "mexc", "binance")

Waker = Callable[[int], Awaitable[Any]]
SessionFactory = Callable[[], Awaitable[aiohttp.ClientSession]]


def credentials(row: ExchangeAccount) -> Credentials:
    return Credentials(
        api_key=keystore.decrypt(row.api_key_enc),
        secret_key=keystore.decrypt(row.secret_enc),
        passphrase=keystore.decrypt(row.passphrase_enc),
    )


class PrivateStreams:
    """Приватные соединения по счетам: заводит, будит и гасит."""

    def __init__(self, http: SessionFactory, wake: Waker | None = None):
        self._http = http
        self._wake = wake
        self._streams: dict[tuple[int, str], Any] = {}
        # Задачи побудки: держим ссылки, иначе сборщик мусора может забрать
        # задачу до того, как она отработает.
        self._waking: set[asyncio.Task] = set()

    @property
    def accounts(self) -> tuple[tuple[int, str], ...]:
        return tuple(sorted(self._streams))

    def has(self, student_id: int, exchange: str) -> bool:
        return (int(student_id), str(exchange)) in self._streams

    def ready(self, student_id: int, exchange: str) -> bool:
        """Жив ли поток счёта. По этому видно, опрашивается биржа или нет."""
        stream = self._streams.get((int(student_id), str(exchange)))
        return bool(stream and stream.ready)

    # ── жизненный цикл потоков ──────────────────────────────────────────────

    async def ensure(self, row: ExchangeAccount) -> None:
        """Поднять поток счёта, если биржа его даёт и он ещё не поднят."""
        exchange = str(row.exchange or "").lower()
        if exchange not in STREAMED or not row.is_active:
            return
        account = (int(row.student_id), exchange)
        if account in self._streams:
            return

        stream = self._build(exchange, row, account)
        if stream is None:
            return
        self._streams[account] = stream
        # Память чтений начинает спрашивать поток, а не биржу - но только пока
        # он сам считает себя живым (`ready`).
        live_state.attach(account, stream)
        stream.start()
        health.note_stream(exchange, up=True)
        logger.info("Приватный поток %s включён для ученика %s", exchange, row.student_id)

    async def keep(self, accounts: set[tuple[int, str]]) -> None:
        """Оставить потоки только этих счетов. Остальные закрыть."""
        for account in list(self._streams):
            if account not in accounts:
                await self.drop(*account)

    async def drop(self, student_id: int, exchange: str) -> None:
        account = (int(student_id), str(exchange))
        stream = self._streams.pop(account, None)
        if stream is None:
            return
        live_state.detach(account)
        health.note_stream(str(exchange), up=False)
        await stream.stop()
        logger.info("Приватный поток %s выключен для ученика %s", exchange, student_id)

    async def stop(self) -> None:
        for account in list(self._streams):
            await self.drop(*account)
        for task in list(self._waking):
            task.cancel()
        self._waking.clear()

    # ── потоки бирж ─────────────────────────────────────────────────────────

    def _build(self, exchange: str, row: ExchangeAccount, account: tuple[int, str]) -> Any:
        """Поток биржи этого счёта. `None` - биржа потока не даёт."""
        student = int(row.student_id)

        def ring(_symbol: str) -> None:
            """Заявка изменилась - разбудить сопровождение этого ученика."""
            self._ring(student)

        def down() -> None:
            """Поток оборвался - память чтений этого счёта больше не верна."""
            live_state.forget(account)
            # Обрыв - число панели: по нему видно, какая биржа рвёт соединение
            # и как часто (backend/trading/health.py).
            health.note_call(exchange, 0.0, False, health.STREAM, "обрыв")

        if exchange == "okx":
            return OkxPrivateStream(
                credentials(row),
                self._specs,
                on_orders=ring,
                on_down=down,
                demo=_demo(),
            )
        if exchange == "bingx":
            # Снимок позиций берёт торговый клиент: адрес, подпись и перевод
            # полей у него уже есть, и второй такой же код разошёлся бы с ним.
            demo = _bingx_demo()
            client = BingxFutures(credentials(row), self._http, demo=demo)
            return BingxPrivateStream(
                credentials(row),
                client.positions,
                on_orders=ring,
                on_down=down,
                demo=demo,
            )
        if exchange == "binance":
            # Как у BingX и MEXC: снимок позиций берёт торговый клиент. У
            # Binance это ещё и вес запроса - пять единиц из общего бюджета
            # адреса, - и второй такой же код стоил бы его дважды.
            testnet = _binance_testnet()
            client = BinanceFutures(credentials(row), self._http, testnet=testnet)
            return BinancePrivateStream(
                credentials(row),
                client.positions,
                on_orders=ring,
                on_down=down,
                testnet=testnet,
            )
        if exchange == "mexc":
            # Как у BingX: снимок позиций берёт торговый клиент. У MEXC это
            # ещё и перевод контрактов в монеты - считать его вторым кодом в
            # потоке значило бы завести второй источник правды о размере
            # позиции (`core/mexc/stream.py`).
            client = MexcFutures(credentials(row), self._http)
            return MexcPrivateStream(
                credentials(row),
                client.positions,
                on_orders=ring,
                on_down=down,
            )
        return None

    # ── вспомогательное ─────────────────────────────────────────────────────

    async def _specs(self) -> dict[str, Any]:
        """Справочник свопов: из него берётся размер контракта для перевода."""
        return await load_instruments(await self._http())

    def _ring(self, student_id: int) -> None:
        """Заявка изменилась - проверить сделки ученика сейчас, а не в обход.

        Сопровождение само не пускает проверки чаще, чем раз в пару секунд, так
        что частые события лавины не устроят.
        """
        if self._wake is None:
            return
        task = asyncio.create_task(self._wake(student_id), name=f"wake-{student_id}")
        self._waking.add(task)
        task.add_done_callback(self._waking.discard)


def _demo() -> bool:
    """Демо-счёт OKX: у него свой адрес приватного потока."""
    return os.getenv("OKX_DEMO", "").strip().lower() in ("1", "true", "yes")


def _binance_testnet() -> bool:
    """Учебный контур Binance: свой адрес и у ручек, и у потока."""
    return os.getenv("BINANCE_TESTNET", "").strip().lower() in ("1", "true", "yes")


def _bingx_demo() -> bool:
    """Демо-контур BingX (VST): свой адрес и у ручек, и у потока."""
    return os.getenv("BINGX_DEMO", "").strip().lower() in ("1", "true", "yes")


# ── счета со сделками и сведение потоков ────────────────────────────────────


def live_accounts(session) -> set[tuple[int, str]]:
    """Счета, на которых прямо сейчас идут сделки терминала."""
    return {
        (int(student_id), trade_exchange(code))
        for student_id, code in session.execute(
            select(LiveTrade.student_id, LiveTrade.exchange).where(
                LiveTrade.status.in_(("waiting", "open"))
            )
        ).all()
    }


async def sync_streams(streams: PrivateStreams, sessions, accounts: set[tuple[int, str]]) -> None:
    """Свести набор потоков к этим счетам: лишние закрыть, недостающие поднять.

    Одно место на обоих, кто держит потоки: сопровождение и процесс терминала
    (`StreamKeeper`). Два похожих кода разошлись бы на первой же правке.
    """
    await streams.keep(accounts)
    if not accounts:
        return
    session = sessions()
    try:
        for student_id, exchange in sorted(accounts):
            if streams.has(student_id, exchange):
                continue
            row = account_for(session, student_id, exchange)
            if row is not None:
                await streams.ensure(row)
    except Exception as exc:  # noqa: BLE001 - без потока работа идёт опросом
        logger.warning("Приватные потоки не подняты: %s", exc)
    finally:
        session.close()


class StreamKeeper:
    """Приватные потоки в процессе, который сделок не ведёт.

    Нужен в раздельном режиме (`NMNH_SPLIT=1`): сопровождение живёт своим
    процессом и держит потоки у себя, а терминал обслуживает процесс `api` - и
    без потока он спрашивал позиции у биржи по нескольку раз в секунду. Своё
    соединение возвращает ему живые цифры и снимает эти запросы.

    Будить здесь некого: сопровождения в этом процессе нет, поток нужен только
    как источник позиций (`live_state`).
    """

    INTERVAL = 5.0

    def __init__(
        self,
        sessions,
        http: SessionFactory,
        interval: float = INTERVAL,
        bell: Waker | None = None,
        streamed: Callable[[int, tuple[str, ...]], Awaitable[Any]] | None = None,
    ):
        self._sessions = sessions
        # Звонок в терминал: биржа сообщила об исполнении или снятой заявке -
        # и об этом сразу узнаёт открытый терминал, вместо того чтобы
        # спрашивать позиции и заявки по кругу (backend/ws/scalping_hub.py).
        self.streams = PrivateStreams(http, bell)
        self._streamed = streamed
        self.interval = interval
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="stream-keeper")
            logger.info("Приватные потоки терминала включены, сверка раз в %.0f с", self.interval)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self.streams.stop()

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - круг не должен обрываться
                logger.warning("Сверка потоков терминала не удалась: %s", exc)
            await asyncio.sleep(self.interval)

    async def _tick(self) -> None:
        session = self._sessions()
        try:
            accounts = live_accounts(session)
        finally:
            session.close()
        await sync_streams(self.streams, self._sessions, accounts)
        await self._tell_streamed(accounts)
        # Свой снимок панели: у процесса терминала свои задержки и отказы.
        session = self._sessions()
        try:
            health.publish(session, health.role())
        except Exception as exc:  # noqa: BLE001 - панель не повод рвать круг
            logger.debug("Снимок панели не записан: %s", exc)
        finally:
            session.close()

    async def _tell_streamed(self, accounts: set[tuple[int, str]]) -> None:
        """Сказать терминалам, по каким их биржам идёт поток.

        По этому терминал решает, ждать событий или спрашивать частым кругом.
        Поток есть не у всех бирж - у WEEX его в документации брокера нет
        вовсе, - и молча растянуть опрос там значило бы узнавать об
        исполнении позже, чем сейчас.
        """
        if self._streamed is None:
            return
        live: dict[int, list[str]] = {}
        for student_id, exchange in accounts:
            if self.streams.ready(student_id, exchange):
                live.setdefault(int(student_id), []).append(str(exchange))
        for student_id in {int(s) for s, _ in accounts}:
            try:
                await self._streamed(student_id, tuple(sorted(live.get(student_id, ()))))
            except Exception as exc:  # noqa: BLE001 - канал не повод рвать круг
                logger.debug("Состав потоков ученику %s не ушёл: %s", student_id, exc)
