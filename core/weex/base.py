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

    async def close(self) -> None:
        """Освободить ресурсы (HTTP-сессию и т.п.). По умолчанию ничего."""
        return None
