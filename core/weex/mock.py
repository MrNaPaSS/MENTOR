"""Мок-реализация WEEX-клиента для разработки без реальных ключей.

Детерминированные, но «живые» данные: цены слегка колеблются во времени, баланс реферала
выводится из UID. Реальные вызовы подключаются позже (см. ``RealWeexClient``).
"""

from __future__ import annotations

import hashlib
import math
import time
from decimal import Decimal
from typing import Optional

from core.weex.base import WeexClient


# Базовые цены популярных пар (для прочих — выводим из имени).
_BASE_PRICES = {
    "BTCUSDT": Decimal("65000"),
    "ETHUSDT": Decimal("3200"),
    "XRPUSDT": Decimal("0.52"),
    "XLMUSDT": Decimal("0.1523"),
    "SOLUSDT": Decimal("145"),
}


def _hash_float(text: str) -> float:
    """Стабильное число [0,1) из строки."""
    h = hashlib.sha256(text.encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


class MockWeexClient(WeexClient):
    """Поддельный клиент: возвращает правдоподобные данные без сети."""

    def __init__(self, volatility: Decimal = Decimal("0.002")):
        self._volatility = volatility

    def _base_price(self, symbol: str) -> Decimal:
        symbol = symbol.upper()
        if symbol in _BASE_PRICES:
            return _BASE_PRICES[symbol]
        # Для неизвестной пары — псевдо-цена из хэша (0.01 .. 100).
        return (Decimal("0.01") + Decimal(str(_hash_float(symbol))) * Decimal("100")).quantize(
            Decimal("0.0001")
        )

    async def get_price(self, symbol: str) -> Decimal:
        base = self._base_price(symbol)
        # Лёгкое колебание по синусоиде от времени — выглядит «живым», но детерминировано.
        phase = (time.time() % 300) / 300 * 2 * math.pi
        drift = Decimal(str(math.sin(phase))) * self._volatility
        return (base * (Decimal(1) + drift)).quantize(Decimal("0.00000001"))

    async def get_klines(self, symbol: str, interval: str = "15m", limit: int = 50) -> list:
        base = self._base_price(symbol)
        now_ms = int(time.time() * 1000)
        step_ms = 15 * 60 * 1000
        candles = []
        for i in range(limit):
            ts = now_ms - (limit - i) * step_ms
            wobble = Decimal(str(math.sin(i / 5))) * self._volatility
            close = base * (Decimal(1) + wobble)
            high = close * (Decimal(1) + self._volatility)
            low = close * (Decimal(1) - self._volatility)
            candles.append([ts, str(base), str(high), str(low), str(close), "1000"])
        return candles

    async def get_min_order_usd(self, symbol: str) -> Decimal:
        # У большинства пар WEEX минимальный ордер невелик; для мока — 5 USDT.
        return Decimal("5")

    async def get_affiliate_balance(self, weex_uid: str) -> Optional[Decimal]:
        if not weex_uid or not str(weex_uid).strip():
            return None
        # Несколько UID считаем «не найденными» — чтобы тестировать fallback.
        if str(weex_uid).strip() in {"0", "404", "notfound"}:
            return None
        # Баланс 100 .. 5000 USDT, стабильный для данного UID.
        balance = Decimal("100") + Decimal(str(_hash_float(str(weex_uid)))) * Decimal("4900")
        return balance.quantize(Decimal("0.01"))

    async def get_server_time(self) -> int:
        return int(time.time() * 1000)

    # ── Аффилиат-статистика (синтетика под реальные схемы WEEX) ──

    def _mock_uids(self, n: int = 12) -> list[str]:
        return [str(3066862000 + i * 137) for i in range(n)]

    async def get_affiliate_uids(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        now = int(time.time() * 1000)
        day = 86_400_000
        out = []
        for i, uid in enumerate(self._mock_uids()):
            h = _hash_float(uid)
            out.append({
                "uid": uid,
                "registerTime": now - int(h * 300 * day),
                "kycResult": h > 0.4,
                "inviteCode": uid[-4:],
                "firstTrade": now - int(h * 120 * day),
                "lastTrade": now - int(h * 5 * day),
                "firstDeposit": now - int(h * 200 * day),
                "lastDeposit": now - int(h * 3 * day),
            })
        return out

    async def get_channel_trade_asset(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        out = []
        for uid in self._mock_uids():
            h = _hash_float(uid)
            dep = round(200 + h * 9800, 2)
            spot = round(h * 50000, 2)
            fut = round(h * 250000, 2)
            out.append({
                "uid": uid,
                "depositAmount": f"{dep:.2f}",
                "withdrawalAmount": f"{round(dep * 0.2, 2):.2f}",
                "spotTradingAmount": f"{spot:.2f}",
                "futuresTradingAmount": f"{fut:.2f}",
                "commission": f"{round((spot + fut) * 0.0004, 2):.2f}",
            })
        return out

    async def get_affiliate_commission(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        now = int(time.time() * 1000)
        day = 86_400_000
        out = []
        for d in range(14):  # 14 дней истории
            for uid in self._mock_uids()[:4]:
                h = _hash_float(f"{uid}{d}")
                taker = round(h * 5000, 3)
                out.append({
                    "uid": uid,
                    "date": now - d * day,
                    "coin": "USDT",
                    "fee": f"{round(taker * 0.0006, 6)}",
                    "commission": f"{round(taker * 0.00006, 6)}",
                    "rate": "0.1",
                    "productType": "FUTURES" if h > 0.5 else "SPOT",
                    "symbol": "cmt_btcusdt",
                    "sourceType": 1,
                    "takerAmount": f"{taker}",
                    "makerAmount": "0",
                })
        return out

    async def get_agency_assert(self, user_id: str, start_ms: int = 0, end_ms: int = 0) -> dict:
        h = _hash_float(str(user_id))
        contract = round(100 + h * 4900, 2)
        spot = round(h * 1500, 2)
        return {
            "availableBalance": f"{round(contract * 0.8, 2):.2f}",
            "contractTotalUsdt": f"{contract:.2f}",
            "depositTotalAmount": f"{round(200 + h * 3000, 2):.2f}",
            "fundingTotalUsdt": f"{round(h * 50, 2):.2f}",
            "spotProTotalUsdt": f"{spot:.2f}",
            "unimarginTotalUsdt": f"{round(h * 80, 2):.2f}",
        }

    async def check_uid_existence(self, uid: str, contact_type: str = "email", contact_value: str = "") -> bool:
        return bool(str(uid).strip()) and str(uid).strip() not in {"0", "404", "notfound"}

    async def get_own_balance(self) -> dict:
        return await self.get_agency_assert("6613031308")

