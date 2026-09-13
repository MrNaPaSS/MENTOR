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
* поток есть не у каждой биржи. У OKX и BingX он описан и открыт; у WEEX
  приватного потока в документации брокера не названо, и счета WEEX остаются
  на опросе - это честнее, чем догадываться об адресе.

Потоки бирж устроены по-разному, и разница видна здесь одним местом: OKX
присылает снимок позиций сама, а BingX - только изменения, поэтому её потоку
нужен торговый клиент, которым он возьмёт снимок при подключении
(`core/bingx/stream.py`).

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

from backend.trading import live_state
from core.bingx.futures import BingxFutures
from core.bingx.stream import BingxPrivateStream
from core.models import ExchangeAccount
from core.okx.futures import load_instruments
from core.okx.stream import OkxPrivateStream
from core.weex import keys as keystore
from core.weex.futures import Credentials

logger = logging.getLogger("nmnh.trading.stream")

# Биржи, у которых приватный поток описан и подключён.
STREAMED = ("okx", "bingx")

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


def _bingx_demo() -> bool:
    """Демо-контур BingX (VST): свой адрес и у ручек, и у потока."""
    return os.getenv("BINGX_DEMO", "").strip().lower() in ("1", "true", "yes")
