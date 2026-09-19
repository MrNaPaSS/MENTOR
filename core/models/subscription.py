"""Подписка на терминал за USDT: счёт, состояние, история оплат, чтение сети.

Второй источник доступа рядом с рефералом академии (docs/tz/subscription-tz.md).
Человек платит в криптовалюте, наблюдатель видит перевод, подписка продлевается.

Три вещи, которые здесь сделаны не самым очевидным образом:

* **Суммы - строки, а не числа.** USDT в BNB Smart Chain имеет 18 знаков, и
  49 USDT - это 49000000000000000000: двадцать цифр. В SQLite (разработка и
  тесты) целое хранится восемью байтами и обрывается около 9.2e18, а `Numeric`
  он держит с плавающей точкой - сумма приехала бы искажённой, и наблюдатель
  не нашёл бы платёж. Строка одинакова в обеих базах и сравнивается точно, а
  сравнение здесь всегда точное: диапазоны нам не нужны.
* **У подписки нет поля «активна».** Она активна, пока `paid_until > now()`.
  Отдельный флаг - второй источник правды, и разошлись бы они на первом сбое.
* **Неопознанный перевод не выбрасывается.** Ошибся человек суммой или сетью -
  деньги всё равно пришли, и они лежат в `orphan_payments`, пока наставник не
  привяжет их к ученику. Иначе разбирать пришлось бы по логам.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.db import Base
from core.models.common import BigIntPK, utcnow


def new_intent_id() -> str:
    """Идентификатор счёта.

    Строка, а не тип `uuid` базы: на SQLite его нет, и схема разработки
    разошлась бы с боевой ровно в том месте, где мы её и сверяем.
    """
    return str(uuid.uuid4())


class PaymentIntent(Base):
    """Выставленный счёт: сколько, куда и до какого времени ждём."""

    __tablename__ = "payment_intents"
    __table_args__ = (
        # Двух ожидающих счетов на одну сумму быть не может: плательщик
        # опознаётся суммой, и совпадение сделало бы невозможным понять, кто
        # заплатил. Условие на `pending` обязательно - оплаченные и истёкшие
        # счета с той же суммой встречаются и мешать не должны.
        Index(
            "payment_intents_amount_active",
            "network",
            "amount_raw",
            unique=True,
            sqlite_where=text("status = 'pending'"),
            postgresql_where=text("status = 'pending'"),
        ),
        # Поиск по сумме среди истёкших счетов: человек заплатил с биржи, вывод
        # шёл полтора часа, счёт успел закрыться (§13 ТЗ).
        Index("payment_intents_amount", "network", "amount_raw"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_intent_id)
    # Пусто только у анонимной оплаты (четвёртый этап): счёт выставлен до того,
    # как человек вообще известен.
    student_id: Mapped[int | None] = mapped_column(
        ForeignKey("students.id"), nullable=True, index=True
    )
    # Дубль для счетов, выставленных ботом ученику, которого ещё нет в базе.
    tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    # terminal | pro
    plan: Mapped[str] = mapped_column(String(16))
    # month | year. Период оплаты лежит у счёта, а не у подписки: сколько дней
    # дал платёж, решает он сам, и годовая оплата после месячной продлевает ту
    # же подписку, ничего в ней не переключая.
    period: Mapped[str] = mapped_column(String(8), default="month", server_default="month")
    # Цена на момент выставления: подорожание не меняет выставленный счёт.
    price_usd: Mapped[float] = mapped_column(Numeric(10, 2))
    network: Mapped[str] = mapped_column(String(16), default="bep20")
    receiver: Mapped[str] = mapped_column(String(64))
    # Точная сумма в минимальных единицах сети, строкой (см. докстринг модуля).
    amount_raw: Mapped[str] = mapped_column(String(40))
    # pending | paid | expired | cancelled
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    tx_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Subscription(Base):
    """Состояние подписки ученика. Одна строка на человека."""

    __tablename__ = "subscriptions"

    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), primary_key=True)
    plan: Mapped[str] = mapped_column(String(16), default="terminal")
    # До какого момента оплачено. Активна, пока это время не прошло.
    paid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Первая оплата. Пусто - подарочные дни ещё не выдавались.
    first_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Подарочная неделя выдана. Выдаётся один раз навсегда, в том числе после
    # отмены и новой оплаты: подарок новым, а не каждому новому кругу.
    gift_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    # Человек отказался от продления: не напоминать и не ждать платежа.
    # Оплаченные дни это не трогает.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SubscriptionPayment(Base):
    """Одна оплата подписки. Главный предохранитель от двойного начисления."""

    __tablename__ = "subscription_payments"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    # Пусто у ручной выдачи наставником: счёта не было, а запись нужна - подарок
    # должен быть виден в истории так же, как оплата.
    intent_id: Mapped[str | None] = mapped_column(
        ForeignKey("payment_intents.id"), nullable=True
    )
    amount_raw: Mapped[str] = mapped_column(String(40), default="0")
    # Повторный проход наблюдателя по тем же блокам не начислит дни дважды:
    # вторая вставка с тем же хешем не пройдёт. У ручной выдачи хеша нет, и
    # пустых значений уникальность не ограничивает - ни в Postgres, ни в SQLite.
    tx_hash: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    days_added: Mapped[int] = mapped_column(Integer, default=0)
    gift_days: Mapped[int] = mapped_column(Integer, default=0)
    # Зачем выдано, если выдано руками: «компенсация за простой», «наставник».
    reason: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ChainCursor(Base):
    """Докуда прочитана сеть. Двигается только после успешной обработки куска."""

    __tablename__ = "chain_cursor"

    network: Mapped[str] = mapped_column(String(16), primary_key=True)
    last_block: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OrphanPayment(Base):
    """Перевод на адрес приёма, не совпавший ни с одним ожидаемым счётом."""

    __tablename__ = "orphan_payments"

    tx_hash: Mapped[str] = mapped_column(String(80), primary_key=True)
    network: Mapped[str] = mapped_column(String(16), default="bep20")
    # Отправитель. Чаще всего это горячий кошелёк биржи, а не человек, но по
    # нему и по сумме владельца платежа находят в поддержке.
    from_address: Mapped[str] = mapped_column(String(64), default="")
    amount_raw: Mapped[str] = mapped_column(String(40), default="0")
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    # Кому в итоге зачли. Пусто - платёж ещё ждёт разбора.
    resolved_student_id: Mapped[int | None] = mapped_column(
        ForeignKey("students.id"), nullable=True, index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationEvent(Base):
    """Событие для бота: оплата пришла, подписка кончается, подписка кончилась.

    Платформа не ходит в Telegram сама - у неё нет ни токена бота, ни права
    писать людям. Она кладёт событие сюда, бот забирает пачку, рассылает и
    отмечает забранное. Та же схема, по которой он уже забирает начисления
    монет, только хранилище наше, а не файл у бота.

    Ключ повторов (`dedup`) - то, из-за чего событие не задвоится: хеш
    транзакции у оплаты, дата окончания у предупреждения. Напоминание «через
    три дня кончится» ставится раз в час, и без этого ключа человек получил бы
    семьдесят два одинаковых сообщения.
    """

    __tablename__ = "notification_events"
    __table_args__ = (
        Index(
            "notification_events_once",
            "kind",
            "event",
            "student_id",
            "dedup",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # Кому предназначено: пока только `subscription`, но очередь общая - сюда
    # же лягут события других частей платформы.
    kind: Mapped[str] = mapped_column(String(16), default="subscription", index=True)
    # payment_received | expires_soon | expired
    event: Mapped[str] = mapped_column(String(32))
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    # Дубль для бота: он пишет по tg_id и о наших номерах учеников не знает.
    tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Подробности события, JSON: тариф, дата окончания, сумма.
    payload: Mapped[str] = mapped_column(Text, default="{}")
    dedup: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    # Когда бот подтвердил, что забрал. Пусто - лежит в очереди.
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


__all__ = [
    "PaymentIntent",
    "Subscription",
    "SubscriptionPayment",
    "ChainCursor",
    "OrphanPayment",
    "NotificationEvent",
    "new_intent_id",
]
