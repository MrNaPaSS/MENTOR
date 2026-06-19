"""Pydantic-схемы запросов/ответов API."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


# ── Калькулятор ──

class CalcRequest(BaseModel):
    mode: str = Field(examples=["moderate", "turbo"])
    balance: Decimal
    entry_price: Decimal
    direction: str = Field(examples=["LONG", "SHORT"])
    leverage: Optional[int] = None
    sl_price: Optional[Decimal] = None
    tp_prices: Optional[list[Decimal]] = None


class TakeProfitOut(BaseModel):
    index: int
    percent: Decimal
    price: Decimal
    profit_usd: Decimal
    rr: Decimal


class CalcResponse(BaseModel):
    mode: str
    direction: str
    balance: Decimal
    leverage: int
    entry_price: Decimal
    margin_usd: Decimal
    position_size: Decimal
    sl_percent: Decimal
    sl_price: Decimal
    risk_usd: Decimal
    risk_percent_of_balance: Decimal
    margin_type: str
    take_profits: list[TakeProfitOut]
    warnings: list[str]
    status: str


# ── Рынок ──

class PriceResponse(BaseModel):
    symbol: str
    price: Decimal


# ── Сигналы ──

class SignalOut(BaseModel):
    id: int
    symbol: str
    direction: str
    leverage: int
    entry_price: Decimal
    entry_type: str
    stop_loss: Optional[Decimal]
    tp1: Optional[Decimal]
    tp2: Optional[Decimal]
    tp3: Optional[Decimal]
    margin_type: str
    target_audience: str
    status: str
    chart_url: Optional[str] = None


# ── Статистика ──

class PublicStats(BaseModel):
    total_signals: int
    active_signals: int
    active_students: int
    winrate: Optional[Decimal] = None


class LeaderboardRow(BaseModel):
    rank: int
    username: Optional[str]
    mode: str
    balance: Optional[Decimal]


# ── Авторизация ──

class RequestCodeIn(BaseModel):
    weex_uid: str


class RequestCodeOut(BaseModel):
    ok: bool
    detail: str
    code: Optional[str] = None  # только в dev (AUTH_EXPOSE_CODES=true)


class VerifyIn(BaseModel):
    weex_uid: str
    code: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str


class StudentOut(BaseModel):
    id: int
    username: Optional[str]
    weex_uid: Optional[str]
    mode: str
    language: str
    balance_usdt: Optional[Decimal]
    is_active: bool
    is_approved: bool


# ── Создание/закрытие сигнала (ментор) ──

class SignalCreate(BaseModel):
    text: str = Field(examples=["XLM LONG\nПлечо 20х"])
    audience: str = Field(default="all", examples=["all", "moderate", "turbo"])
    chart_url: Optional[str] = Field(default=None, examples=["https://www.tradingview.com/x/eQTQ071J/"])


class SignalCreateDirect(BaseModel):
    symbol: str
    direction: str                     # LONG | SHORT
    leverage: int = 20
    entry_price: Decimal
    stop_loss: Decimal
    tp1: Optional[Decimal] = None
    tp2: Optional[Decimal] = None
    tp3: Optional[Decimal] = None
    entry_type: str = "market"
    margin_type: str = "cross"
    audience: str = "all"
    chart_url: Optional[str] = None


class DeliveryPreview(BaseModel):
    username: Optional[str]
    mode: str
    balance: Optional[Decimal]
    margin_usd: Optional[Decimal]
    risk_usd: Optional[Decimal]
    status: str


class SignalCreateResult(BaseModel):
    signal: SignalOut
    deliveries: list[DeliveryPreview]


# ── Профиль ученика ──

class ProfileOut(BaseModel):
    id: int
    username: Optional[str]
    weex_uid: Optional[str]
    mode: str
    language: str
    risk_percent: Optional[Decimal]
    turbo_leverage: Optional[int]
    balance_usdt: Optional[Decimal]
    balance_source: str


class ProfilePatch(BaseModel):
    mode: Optional[str] = None
    language: Optional[str] = None
    risk_percent: Optional[Decimal] = None
    turbo_leverage: Optional[int] = None


class AnalyticsMe(BaseModel):
    signals_received: int
    sent: int
    skipped: int
    failed: int


class DevTokens(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None


class DevLoginOut(BaseModel):
    mentor: DevTokens
    student: DevTokens
    student_username: str


# ── Монеты NMNH ──

class CoinTxOut(BaseModel):
    id: int
    amount: int
    reason: str
    ref: str
    created_at: str


class CoinsBalance(BaseModel):
    balance: int
    transactions: list[CoinTxOut]


class CoinSyncIn(BaseModel):
    earned_achievement_ids: list[str]
    current_level: int
    reached_volume_milestones: list[str]  # ["50K", "100K", ...]


class CoinSyncOut(BaseModel):
    balance: int
    added: int
    new_transactions: list[CoinTxOut]


# ── Магазин NMNH ──

class ShopItemOut(BaseModel):
    id: int
    title: str
    description: str
    price: int
    category: str
    section: str
    icon: str
    link_url: str
    requires_tv: bool
    is_active: bool
    sort_order: int


class ShopItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    price: int = Field(ge=0)
    category: str = "other"
    section: str = "shop"
    icon: str = "Gift"
    link_url: str = Field(default="", max_length=500)
    requires_tv: bool = False
    is_active: bool = True
    sort_order: int = 0


class ShopItemPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0)
    category: Optional[str] = None
    section: Optional[str] = None
    icon: Optional[str] = None
    link_url: Optional[str] = Field(default=None, max_length=500)
    requires_tv: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class ShopOrderCreate(BaseModel):
    item_id: int
    contact: str = Field(default="", max_length=255)


class ShopOrderOut(BaseModel):
    id: int
    item_id: Optional[int]
    item_title: str
    price: int
    status: str
    contact: str
    mentor_note: str
    created_at: str
    resolved_at: Optional[str]
    # Только для админских ответов:
    student_id: Optional[int] = None
    student_username: Optional[str] = None
    student_uid: Optional[str] = None


class ShopOrderResolve(BaseModel):
    mentor_note: str = Field(default="", max_length=255)
