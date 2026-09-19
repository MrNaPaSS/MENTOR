"""Очередь событий для бота: платформа кладёт, бот забирает и рассылает.

У платформы нет ни токена бота, ни права писать людям в Telegram, и заводить
их ей незачем: разговор с человеком ведёт бот академии. Поэтому события
подписки - «оплата пришла», «кончается», «кончилась» - ложатся в очередь, а бот
забирает их пачкой и отмечает забранное. Та же схема, по которой он уже
забирает начисления монет.

Событие не должно задваиваться, и стоит это не на проверке в коде, а на
указателе базы: напоминание о скором окончании ставится каждым проходом
сторожа, и без ключа повторов человек получил бы его десятки раз. Ключ -
`dedup`: хеш транзакции у оплаты, дата окончания у предупреждения.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.models import NotificationEvent, Student, Subscription

log = logging.getLogger("nmnh.subscription")

KIND = "subscription"

PAYMENT_RECEIVED = "payment_received"
EXPIRES_SOON = "expires_soon"
EXPIRED = "expired"

# За сколько предупреждаем. Льготного периода после окончания нет, поэтому
# предупреждение - единственный запас, который у человека есть.
WARN_BEFORE = timedelta(days=3)

# Сколько событий отдаём за раз, даже если бот просит больше.
MAX_BATCH = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def put(
    session: Session,
    *,
    event: str,
    student_id: int,
    dedup: str,
    payload: dict | None = None,
    kind: str = KIND,
    tg_id: int | None = None,
    now: datetime | None = None,
) -> NotificationEvent | None:
    """Положить событие в очередь. `None` - такое уже лежит.

    Коммита здесь нет намеренно: событие об оплате кладётся той же транзакцией,
    что и начисление дней. Уведомление, ушедшее без начисления, хуже, чем
    неушедшее.
    """
    if tg_id is None:
        student = session.get(Student, student_id)
        tg_id = student.tg_id if student else None
    row = NotificationEvent(
        kind=kind,
        event=event,
        student_id=student_id,
        tg_id=tg_id,
        payload=json.dumps(payload or {}, ensure_ascii=False),
        dedup=dedup,
        created_at=now or _now(),
    )
    # Вложенная транзакция (SAVEPOINT), а не голый flush: событие кладётся
    # внутри чужой транзакции - той, что начисляет дни. Откат по дублю события
    # должен отменить только событие, а `session.rollback()` отменил бы и
    # начисление, и - хуже того - съел бы ошибку о повторном платеже, которую
    # ждёт вызывающий.
    try:
        with session.begin_nested():
            session.add(row)
    except IntegrityError:
        return None
    return row


def pending(session: Session, *, kind: str = KIND, limit: int = 50) -> list[NotificationEvent]:
    """Что бот ещё не забрал, старое первым."""
    return list(
        session.scalars(
            select(NotificationEvent)
            .where(NotificationEvent.kind == kind, NotificationEvent.acked_at.is_(None))
            .order_by(NotificationEvent.created_at)
            .limit(max(1, min(int(limit), MAX_BATCH)))
        ).all()
    )


def view(row: NotificationEvent) -> dict:
    try:
        payload = json.loads(row.payload or "{}")
    except ValueError:
        payload = {}
    return {
        "id": row.id,
        "event": row.event,
        "tg_id": row.tg_id,
        "student_id": row.student_id,
        "payload": payload,
        "created_at": _aware(row.created_at).isoformat(),
    }


def ack(session: Session, ids: list[int], now: datetime | None = None) -> int:
    """Отметить забранное. Чужие и уже отмеченные идентификаторы пропускаются."""
    if not ids:
        return 0
    moment = now or _now()
    rows = session.scalars(
        select(NotificationEvent).where(
            NotificationEvent.id.in_([int(one) for one in ids]),
            NotificationEvent.acked_at.is_(None),
        )
    ).all()
    for row in rows:
        row.acked_at = moment
    session.commit()
    return len(rows)


def payment_received(
    session: Session,
    *,
    student_id: int,
    tx_hash: str,
    plan: str,
    paid_until: datetime,
    days_added: int,
    gift_days: int,
    now: datetime | None = None,
) -> NotificationEvent | None:
    """«Оплата пришла». Ключ повторов - хеш транзакции."""
    return put(
        session,
        event=PAYMENT_RECEIVED,
        student_id=student_id,
        dedup=tx_hash[:64],
        payload={
            "plan": plan,
            "paid_until": _aware(paid_until).isoformat(),
            "days_added": days_added,
            "gift_days": gift_days,
        },
        now=now,
    )


def sweep(session: Session, now: datetime | None = None) -> int:
    """Сторож окончаний: кому пора напомнить и кому уже пора сказать «всё».

    Гоняется вместе с наблюдателем за платежами. Ключ повторов - дата
    окончания: пока она не сдвинулась оплатой, второе такое же событие в
    очередь не ляжет, сколько бы раз сторож ни прошёл.

    Отменившему подписку «скоро кончится» не шлём - он об этом и попросил, -
    а «кончилась» шлём всем: терминал закрывается в тот же момент, и человек
    должен узнать об этом от нас, а не по запертой кнопке.
    """
    moment = now or _now()
    added = 0
    rows = session.scalars(
        select(Subscription).where(
            Subscription.paid_until > moment - timedelta(days=1),
            Subscription.paid_until <= moment + WARN_BEFORE,
        )
    ).all()
    for row in rows:
        until = _aware(row.paid_until)
        if until is None:
            continue
        key = until.date().isoformat()
        if until <= moment:
            event = put(
                session,
                event=EXPIRED,
                student_id=row.student_id,
                dedup=key,
                payload={"plan": row.plan, "paid_until": until.isoformat()},
                now=moment,
            )
        elif row.cancelled_at is None:
            event = put(
                session,
                event=EXPIRES_SOON,
                student_id=row.student_id,
                dedup=key,
                payload={
                    "plan": row.plan,
                    "paid_until": until.isoformat(),
                    "days_left": max(1, -(-int((until - moment).total_seconds()) // 86400)),
                },
                now=moment,
            )
        else:
            event = None
        if event is not None:
            added += 1
    if added:
        session.commit()
        log.info("Событий об окончании подписки поставлено: %d", added)
    return added


class SubscriptionSweeper:
    """Сторож окончаний: раз в час смотрит, кому пора написать.

    Живёт рядом с наблюдателем за платежами, в роли `watcher`. Раз в час, а не
    чаще: событие ставится один раз на дату окончания, и частые проходы ничего
    не ускорят - они только добавят запросов к базе.
    """

    def __init__(self, interval: float = 3600.0):
        self.interval = interval
        self._task = None

    def start(self) -> None:
        import asyncio

        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="subscription-sweeper")
            log.info("Сторож окончаний подписки запущен, проход раз в %.0f с", self.interval)

    async def stop(self) -> None:
        import asyncio

        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        import asyncio

        from core.db import SessionLocal

        while True:
            try:
                await asyncio.sleep(self.interval)
                with SessionLocal() as session:
                    sweep(session)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - сбой прохода не роняет сервер
                log.warning("Сбой сторожа окончаний: %s", exc)
