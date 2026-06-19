"""Модель данных — единая схема для бота и веб-платформы (docs/architecture/unified-core.md).

Денежные значения — ``Numeric`` (A-09), время — ``DateTime(timezone=True)`` в UTC (A-07).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db import Base

# BigInteger PK, который на SQLite становится INTEGER (иначе нет автоинкремента).
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    tg_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    weex_uid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), default="moderate")
    risk_percent: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    turbo_leverage: Mapped[int | None] = mapped_column(nullable=True)
    language: Mapped[str] = mapped_column(String(2), default="ru")
    balance_usdt: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    balance_source: Mapped[str] = mapped_column(String(16), default="affiliate_api")
    balance_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    deliveries: Mapped[list["SignalDelivery"]] = relationship(back_populates="student")
    coin_transactions: Mapped[list["CoinTransaction"]] = relationship(back_populates="student")


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))
    leverage: Mapped[int] = mapped_column()
    entry_price: Mapped[float] = mapped_column(Numeric(20, 8))
    entry_type: Mapped[str] = mapped_column(String(8), default="market")
    stop_loss: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp1: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp2: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp3: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    margin_type: Mapped[str] = mapped_column(String(8), default="cross")
    target_audience: Mapped[str] = mapped_column(String(8), default="all")
    has_photo: Mapped[bool] = mapped_column(Boolean, default=False)
    chart_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deliveries: Mapped[list["SignalDelivery"]] = relationship(back_populates="signal")


class SignalDelivery(Base):
    __tablename__ = "signal_deliveries"
    __table_args__ = (
        UniqueConstraint("signal_id", "student_id", name="uq_delivery_signal_student"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    balance_at_signal: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    margin_usd: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    position_size: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    risk_usd: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp1: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp2: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp3: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="sent")  # sent | failed | skipped
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="deliveries")
    student: Mapped["Student"] = relationship(back_populates="deliveries")


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text, default="")
    chart_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    audience: Mapped[str] = mapped_column(String(16), default="all")
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BalanceSnapshot(Base):
    """Дневной снимок баланса ученика для расчёта PnL по дням."""

    __tablename__ = "balance_snapshots"
    __table_args__ = (
        UniqueConstraint("student_id", "date", name="uq_snapshot_student_date"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD UTC
    balance_usdt: Mapped[float] = mapped_column(Numeric(20, 8))
    futures_volume: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    spot_volume: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="affiliate_api")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SettingRow(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class CoinTransaction(Base):
    """История начислений монет NMNH ученику."""

    __tablename__ = "coin_transactions"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))   # achievement | level_up | volume_milestone
    ref: Mapped[str] = mapped_column(String(64))       # achievement_id, level number, or milestone label
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    student: Mapped["Student"] = relationship(back_populates="coin_transactions")


class ShopItem(Base):
    """Товар магазина NMNH — покупается за монеты (подписка на индикатор, менторство, VIP)."""

    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(Integer)               # цена в монетах NMNH (0 = не покупается, витрина)
    category: Mapped[str] = mapped_column(String(32), default="other")  # indicator|mentorship|vip|academy|...
    section: Mapped[str] = mapped_column(String(16), default="shop")     # shop (покупка) | software (витрина)
    icon: Mapped[str] = mapped_column(String(32), default="Gift")        # имя lucide-иконки
    link_url: Mapped[str] = mapped_column(String(500), default="")       # ссылка (индикатор/софт), видна в карточке
    requires_tv: Mapped[bool] = mapped_column(Boolean, default=False)    # требовать ник TradingView при покупке
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    orders: Mapped[list["ShopOrder"]] = relationship(back_populates="item")


class ShopOrder(Base):
    """Заказ ученика в магазине. Монеты списываются сразу, выдача — вручную ментором."""

    __tablename__ = "shop_orders"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("shop_items.id"), nullable=True)
    item_title: Mapped[str] = mapped_column(String(120))       # снимок названия на момент покупки
    price: Mapped[int] = mapped_column(Integer)                # снимок цены
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|fulfilled|rejected
    contact: Mapped[str] = mapped_column(String(255), default="")        # контакт/пожелание ученика
    mentor_note: Mapped[str] = mapped_column(String(255), default="")    # комментарий ментора при выдаче
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["Student"] = relationship()
    item: Mapped["ShopItem"] = relationship(back_populates="orders")


class AuthCode(Base):
    """Одноразовый код входа в веб-платформу (UID → код, ТЗ §4.1, контракт A-10)."""

    __tablename__ = "auth_codes"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    weex_uid: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(String(8))
    attempts: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


__all__ = ["Student", "Signal", "SignalDelivery", "SettingRow", "AuthCode", "Broadcast", "BalanceSnapshot", "CoinTransaction", "ShopItem", "ShopOrder", "utcnow"]
