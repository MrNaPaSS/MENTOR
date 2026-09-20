"""Проход по блокам: чей платёж пришёл, что просрочено, куда деть чужое.

Наблюдатель живёт в процессе `watcher` (`NMNH_ROLE`), тик раз в пятнадцать
секунд. Он отвечает только за факт оплаты: нашёл перевод, сопоставил с
ожидающим счётом и передал его начислению. Сколько дней это даёт и кому -
знает `backend/subscriptions.py`, а не этот модуль.

Правила, которые нельзя нарушать:

* **Курсор двигается только после успешной обработки куска.** Упали посреди
  диапазона - следующий проход прочитает его заново, а начисление идемпотентно
  по `tx_hash` и второй раз дней не даст.
* **Курсор двигается и тогда, когда ждать нечего.** Иначе после суток тишины
  наблюдатель будет догонять сеть кусками по 2000 блоков вместо того, чтобы
  увидеть новый платёж сразу.
* **Несопоставленный перевод не выбрасывается.** Ошибся человек суммой - деньги
  всё равно пришли, и они ложатся в `orphan_payments` на ручной разбор.
* **Сбой узла не роняет процесс.** Проход пропускается, курсор стоит на месте.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.payments import bsc
from core.db import SessionLocal
from core.models import ChainCursor, OrphanPayment, PaymentIntent

log = logging.getLogger("nmnh.payments")

# Раз в пятнадцать секунд: блок в BSC идёт три секунды, но платёж всё равно
# ждёт пятнадцати подтверждений, и чаще спрашивать узел незачем.
TICK_SECONDS = 15.0

# Первый запуск: историю сети не читаем, начинаем с недавнего окна.
FIRST_RUN_LOOKBACK = 1000

# Сколько после истечения счёта его сумма всё ещё числится за человеком -
# и столько же её хвост не выдаётся никому другому (`backend/payments/bsc.py`).
LATE_WINDOW = bsc.LATE_WINDOW


class OnPayment(Protocol):
    """Начисление по найденному переводу. Своей транзакции здесь нет."""

    def __call__(self, session: Session, intent: PaymentIntent, transfer: bsc.Transfer) -> None: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


def expire_stale(session: Session, now: datetime | None = None) -> int:
    """Снять бронь со счетов, которых никто не оплатил. Возвращает число снятых."""
    moment = now or _now()
    stale = session.scalars(
        select(PaymentIntent).where(
            PaymentIntent.status == "pending",
            PaymentIntent.expires_at <= moment,
        )
    ).all()
    for intent in stale:
        intent.status = "expired"
    if stale:
        session.commit()
    return len(stale)


def find_intent(session: Session, transfer: bsc.Transfer, now: datetime | None = None) -> PaymentIntent | None:
    """Чей это перевод: по точной сумме среди ожидающих, затем среди недавних.

    Недоплату и переплату не принимаем: сумма сравнивается точно, остальное
    уходит на ручной разбор. Частичная оплата подписки - это спор о том,
    сколько дней дать, и решать его должен человек, а не наблюдатель.
    """
    moment = now or _now()
    waiting = session.scalars(
        select(PaymentIntent).where(
            PaymentIntent.network == bsc.NETWORK,
            PaymentIntent.amount_raw == transfer.amount_raw,
            PaymentIntent.status == "pending",
            PaymentIntent.expires_at > moment,
        )
    ).first()
    if waiting is not None:
        return waiting
    # Деньги шли дольше, чем жил счёт. Пока прошло не больше суток, сумма всё
    # ещё числится за тем, кому её выдали.
    return session.scalars(
        select(PaymentIntent)
        .where(
            PaymentIntent.network == bsc.NETWORK,
            PaymentIntent.amount_raw == transfer.amount_raw,
            PaymentIntent.status.in_(("pending", "expired")),
            PaymentIntent.expires_at > moment - LATE_WINDOW,
        )
        .order_by(PaymentIntent.expires_at.desc())
    ).first()


def remember_orphan(session: Session, transfer: bsc.Transfer) -> bool:
    """Записать неопознанный перевод. Повторный проход дубля не создаёт."""
    known = session.get(OrphanPayment, transfer.tx_hash)
    if known is not None:
        return False
    session.add(
        OrphanPayment(
            tx_hash=transfer.tx_hash,
            network=bsc.NETWORK,
            from_address=transfer.from_address,
            amount_raw=transfer.amount_raw,
        )
    )
    session.commit()
    log.warning(
        "Неопознанный перевод %s на %s USDT - ждёт разбора",
        transfer.tx_hash,
        bsc.format_usdt(transfer.amount_raw),
    )
    return True


def read_cursor(session: Session) -> int | None:
    row = session.get(ChainCursor, bsc.NETWORK)
    return int(row.last_block) if row else None


def save_cursor(session: Session, block: int) -> None:
    row = session.get(ChainCursor, bsc.NETWORK)
    if row is None:
        session.add(ChainCursor(network=bsc.NETWORK, last_block=block, updated_at=_now()))
    else:
        row.last_block = block
        row.updated_at = _now()
    session.commit()


class PaymentWatcher:
    """Фоновый проход по BSC: один тик - один кусок блоков."""

    def __init__(self, on_payment: OnPayment, interval: float = TICK_SECONDS):
        self.on_payment = on_payment
        self.interval = interval
        self._task: asyncio.Task | None = None
        # Сколько проходов подряд не удались. Десять минут молчания узла -
        # повод написать в журнал громко, а не тихо ждать дальше.
        self._failures = 0

    def start(self) -> None:
        if not bsc.enabled():
            log.info("Приём USDT выключен: не задан NMNH_BSC_RECEIVER")
            return
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="payments-watcher")
            log.info(
                "Приём USDT включён: %s, опрос раз в %.0f с", bsc.NETWORK_LABEL, self.interval
            )

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.interval)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - сбой прохода не роняет сервер
                log.warning("Сбой прохода по платежам: %s", exc)

    async def tick(self) -> int:
        """Один проход. Возвращает число сопоставленных платежей."""
        with SessionLocal() as session:
            expire_stale(session)
            cursor = read_cursor(session)

        try:
            head = await bsc.safe_head()
        except bsc.RpcError as exc:
            self._note_failure(exc)
            return 0
        if head <= 0:
            return 0

        start = cursor if cursor is not None else head - FIRST_RUN_LOOKBACK
        if head <= start:
            return 0
        finish = min(head, start + bsc.LOG_SPAN)

        try:
            transfers = await bsc.fetch_transfers(start + 1, finish)
        except bsc.RpcError as exc:
            self._note_failure(exc)
            return 0

        self._failures = 0
        matched = 0
        with SessionLocal() as session:
            for transfer in transfers:
                intent = find_intent(session, transfer)
                if intent is None:
                    remember_orphan(session, transfer)
                    continue
                self.on_payment(session, intent, transfer)
                matched += 1
            # Курсор - последним действием: всё, что выше, уже в базе.
            save_cursor(session, finish)
        if matched:
            log.info("Платежей сопоставлено: %d (блоки %d-%d)", matched, start + 1, finish)
        return matched

    def _note_failure(self, exc: Exception) -> None:
        self._failures += 1
        # Десять минут подряд при тике в 15 секунд - сорок неудач.
        if self._failures * self.interval >= 600:
            log.error("Узел BSC молчит %d проходов подряд: %s", self._failures, exc)
        else:
            log.warning("Узел BSC не ответил: %s", exc)


def make_watcher(on_payment: Callable[..., None], interval: float = TICK_SECONDS) -> PaymentWatcher:
    return PaymentWatcher(on_payment, interval=interval)
