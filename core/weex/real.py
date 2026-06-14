"""Реальный WEEX-клиент (HMAC SHA256 + Base64).

Заготовка под подключение реальных ключей (ТЗ §5). Подпись и эндпоинты описаны; сетевые вызовы
реализуются при появлении ключей и точной схемы закрытого аффилиат-эндпоинта баланса (A-01).
Пока работаем на ``MockWeexClient`` (WEEX_USE_MOCK=true).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from decimal import Decimal
from typing import Optional

from core.weex.base import WeexClient

FUTURES_BASE = "https://api-contract.weex.com"
AFFILIATE_BASE = "https://api-spot.weex.com"


def sign(secret: str, timestamp: str, method: str, path: str, body: str = "") -> str:
    """ACCESS-SIGN = base64(hmac_sha256(secret, timestamp+METHOD+path+body))."""
    message = f"{timestamp}{method.upper()}{path}{body}"
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


class RealWeexClient(WeexClient):
    """Реальный клиент. Требует ключи и реализацию HTTP-вызовов."""

    def __init__(self, api_key: str, secret: str, passphrase: str, **affiliate_creds):
        self.api_key = api_key
        self.secret = secret
        self.passphrase = passphrase
        self.affiliate = affiliate_creds

    def _headers(self, method: str, path: str, body: str = "") -> dict:
        ts = str(int(time.time() * 1000))
        return {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": sign(self.secret, ts, method, path, body),
            "ACCESS-PASSPHRASE": self.passphrase,
            "ACCESS-TIMESTAMP": ts,
            "Content-Type": "application/json",
        }

    async def get_price(self, symbol: str) -> Decimal:  # pragma: no cover - сеть
        raise NotImplementedError("Подключается при наличии WEEX-ключей (WEEX_USE_MOCK=false).")

    async def get_klines(self, symbol: str, interval: str = "15m", limit: int = 50) -> list:  # pragma: no cover
        raise NotImplementedError("Подключается при наличии WEEX-ключей.")

    async def get_min_order_usd(self, symbol: str) -> Decimal:  # pragma: no cover
        raise NotImplementedError("Подключается при наличии WEEX-ключей.")

    async def get_affiliate_balance(self, weex_uid: str) -> Optional[Decimal]:  # pragma: no cover
        # Закрытый аффилиат-эндпоинт баланса реферала (A-01) — точная схема фиксируется при подключении.
        raise NotImplementedError("Подключается при наличии аффилиат-доступа WEEX.")

    async def get_server_time(self) -> int:  # pragma: no cover
        raise NotImplementedError("Подключается при наличии WEEX-ключей.")
