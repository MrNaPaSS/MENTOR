"""Интерфейс WEEX-клиента.

Единая точка доступа к бирже (Futures + Affiliate). Бот, бэкенд и сборщик цен ходят на WEEX
только через эту абстракцию (решение A-03). Реализации: ``MockWeexClient`` (для разработки) и
``RealWeexClient`` (HMAC-подпись, подключается при наличии ключей).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import Optional


class WeexClient(ABC):
    """Контракт клиента WEEX."""

    @abstractmethod
    async def get_price(self, symbol: str) -> Decimal:
        """Текущая цена пары (последняя сделка)."""

    @abstractmethod
    async def get_klines(self, symbol: str, interval: str = "15m", limit: int = 50) -> list:
        """Свечи [ts, open, high, low, close, volume] для расчёта стопа/ТП."""

    @abstractmethod
    async def get_min_order_usd(self, symbol: str) -> Decimal:
        """Минимальный размер ордера в USDT (guardrail A-11)."""

    @abstractmethod
    async def get_affiliate_balance(self, weex_uid: str) -> Optional[Decimal]:
        """Баланс фьючерсного счёта реферала по UID (закрытый аффилиат-эндпоинт, A-01).

        Возвращает ``None``, если UID не найден или баланс недоступен (тогда — fallback на
        ручной/последний известный баланс, ``balance_source = manual``).
        """

    @abstractmethod
    async def get_server_time(self) -> int:
        """Время сервера WEEX (Unix ms, UTC+8 на стороне биржи; в проекте всё → UTC)."""

    # ── Партнёрская/аффилиат-статистика (для админ-дашборда) ──

    @abstractmethod
    async def get_affiliate_uids(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        """Список UID рефералов (getAffiliateUIDs): uid, registerTime, kycResult,
        inviteCode, firstTrade, lastTrade, firstDeposit, lastDeposit."""

    @abstractmethod
    async def get_channel_trade_asset(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        """Торговля и активы рефералов (getChannelUserTradeAndAsset): uid, depositAmount,
        withdrawalAmount, spotTradingAmount, futuresTradingAmount, commission."""

    @abstractmethod
    async def get_affiliate_commission(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        """История комиссий (getAffiliateCommission): uid, date, coin, fee, commission, rate,
        productType, symbol, sourceType, takerAmount, makerAmount."""

    @abstractmethod
    async def get_agency_assert(self, user_id: str, start_ms: int = 0, end_ms: int = 0) -> dict:
        """Снимок активов реферала по UID (agency/getAssert): availableBalance,
        contractTotalUsdt, depositTotalAmount, fundingTotalUsdt, spotProTotalUsdt, unimarginTotalUsdt."""

    @abstractmethod
    async def get_own_balance(self) -> dict:
        """Собственный баланс аккаунта ментора (Spot + Contract)."""

    @abstractmethod
    async def check_uid_existence(self, uid: str, contact_type: str = "email", contact_value: str = "") -> bool:
        """Верификация существования UID (checkUidExistence)."""

    async def close(self) -> None:
        """Освободить ресурсы (HTTP-сессию и т.п.). По умолчанию ничего."""
        return None

