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
