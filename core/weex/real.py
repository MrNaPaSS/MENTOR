"""Реальный WEEX-клиент (HMAC SHA256 + Base64, HTTP через aiohttp).

Публичные рыночные эндпоинты (цена, свечи, время) — без подписи; аффилиат/аккаунт — с подписью
(ТЗ §5.2). Точная схема ответов WEEX может отличаться, поэтому парсинг — защитный (ищем поле по
списку кандидатов). Для тестов можно передать свою ``session`` с интерфейсом aiohttp.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import time
from decimal import Decimal, InvalidOperation
from typing import Optional

from core.weex.base import WeexClient

logger = logging.getLogger("nmnh.weex")

FUTURES_BASE = "https://api-contract.weex.com"
AFFILIATE_BASE = "https://api-spot.weex.com"

_PRICE_FIELDS = ("price", "last", "close", "markPrice", "lastPr")
_BALANCE_FIELDS = (
    "futuresBalance", "availableBalance", "balance", "totalAsset", "asset", "equity",
)


def sign(secret: str, timestamp: str, method: str, path: str, body: str = "") -> str:
    """ACCESS-SIGN = base64(hmac_sha256(secret, timestamp+METHOD+path+body))."""
    message = f"{timestamp}{method.upper()}{path}{body}"
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def _to_decimal(value) -> Optional[Decimal]:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _search_field(payload, fields) -> Optional[Decimal]:
    """Рекурсивно найти первое числовое поле из ``fields`` в dict/list."""
    if isinstance(payload, dict):
        for key in fields:
            if key in payload:
                val = _to_decimal(payload[key])
                if val is not None:
                    return val
        for value in payload.values():
            found = _search_field(value, fields)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _search_field(item, fields)
            if found is not None:
                return found
    return None


class RealWeexClient(WeexClient):
    """Реальный клиент WEEX. Требует ключи; работает поверх aiohttp."""

    def __init__(self, api_key: str, secret: str, passphrase: str, session=None, **affiliate_creds):
        self.api_key = api_key
        self.secret = secret
        self.passphrase = passphrase
        self.affiliate = affiliate_creds
        self._session = session
        self._owns_session = session is None

    async def _get_session(self):
        if self._session is None:
            import aiohttp
            self._session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False))
        return self._session

    def _signed_headers(self, method: str, path_with_query: str, *, affiliate: bool) -> dict:
        ts = str(int(time.time() * 1000))
        if affiliate:
            key = self.affiliate.get("affiliate_key", "")
            secret = self.affiliate.get("affiliate_secret", "")
            passphrase = self.affiliate.get("affiliate_passphrase", "")
        else:
            key, secret, passphrase = self.api_key, self.secret, self.passphrase
        return {
            "ACCESS-KEY": key,
            "ACCESS-SIGN": sign(secret, ts, method, path_with_query),
            "ACCESS-PASSPHRASE": passphrase,
            "ACCESS-TIMESTAMP": ts,
            "Content-Type": "application/json",
        }

    # Совместимость с прежним API (используется в тестах).
    def _headers(self, method: str, path: str, body: str = "") -> dict:
        return self._signed_headers(method, path, affiliate=False)

    async def _get(self, base: str, path: str, params: dict | None = None,
                   *, signed: bool = False, affiliate: bool = False) -> Optional[dict]:
        session = await self._get_session()
        headers = {}
        if signed:
            query = "&".join(f"{k}={v}" for k, v in (params or {}).items())
            path_q = f"{path}?{query}" if query else path
            headers = self._signed_headers("GET", path_q, affiliate=affiliate)
        try:
            async with session.get(base + path, params=params, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning("WEEX %s%s -> HTTP %s", base, path, resp.status)
                    return None
                return await resp.json(content_type=None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("WEEX запрос %s%s упал: %s", base, path, exc)
            return None

    async def get_price(self, symbol: str) -> Decimal:
        data = await self._get(FUTURES_BASE, "/capi/v3/market/symbolPrice", {"symbol": symbol})
        price = _search_field(data, _PRICE_FIELDS) if data else None
        if price is None:
            raise RuntimeError(f"Не удалось получить цену {symbol} с WEEX")
        return price

    async def get_klines(self, symbol: str, interval: str = "15m", limit: int = 50) -> list:
        data = await self._get(
            FUTURES_BASE, "/capi/v3/market/klines",
            {"symbol": symbol, "interval": interval, "limit": limit},
        )
        if not data:
            return []
        return data.get("data", data) if isinstance(data, dict) else data

    async def get_min_order_usd(self, symbol: str) -> Decimal:
        # Публичного эндпоинта мин. ордера в ТЗ нет — берём настраиваемый дефолт.
        return _to_decimal(os.getenv("WEEX_MIN_ORDER_USD", "5")) or Decimal("5")

    async def get_affiliate_balance(self, weex_uid: str) -> Optional[Decimal]:
        # Реальный баланс реферала по UID через agency/getAssert (A-01, подтверждённая схема).
        assets = await self.get_agency_assert(weex_uid)
        if not assets:
            return None
        # По умолчанию берём availableBalance; настраивается через WEEX_AFFILIATE_BALANCE_FIELD.
        field = os.getenv("WEEX_AFFILIATE_BALANCE_FIELD", "availableBalance")
        return _to_decimal(assets.get(field)) or _search_field(assets, _BALANCE_FIELDS)

    async def _post(self, base: str, path: str, body: dict, *, affiliate: bool = False) -> Optional[dict]:
        import json as _json

        session = await self._get_session()
        raw = _json.dumps(body)
        headers = self._signed_headers("POST", path, affiliate=affiliate)
        try:
            async with session.post(base + path, data=raw, headers=headers) as resp:
                if resp.status != 200:
                    return None
                return await resp.json(content_type=None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("WEEX POST %s%s упал: %s", base, path, exc)
            return None

    @staticmethod
    def _data(payload) -> dict:
        if isinstance(payload, dict):
            d = payload.get("data", payload)
            return d if isinstance(d, dict) else {"_list": d}
        return {}

    @staticmethod
    def _extract_list(data: dict, keys) -> list:
        for k in keys:
            v = data.get(k)
            if isinstance(v, list):
                return v
        # запасной вариант — первый список среди значений
        for v in data.values():
            if isinstance(v, list):
                return v
        return []

    async def get_affiliate_uids(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        payload = await self._get(
            AFFILIATE_BASE, "/api/v3/rebate/affiliate/getAffiliateUIDs",
            {"startTime": start_ms, "endTime": end_ms, "page": page, "pageSize": 100},
            signed=True, affiliate=True,
        )
        return self._extract_list(self._data(payload), ("channelUserInfoItemList", "_list"))

    async def get_affiliate_uids_all(self, start_ms: int, end_ms: int) -> list:
        """Fetches all pages from getAffiliateUIDs."""
        results, page = [], 1
        while True:
            payload = await self._get(
                AFFILIATE_BASE, "/api/v3/rebate/affiliate/getAffiliateUIDs",
                {"startTime": start_ms, "endTime": end_ms, "page": page, "pageSize": 100},
                signed=True, affiliate=True,
            )
            data = self._data(payload)
            items = self._extract_list(data, ("channelUserInfoItemList", "_list"))
            results.extend(items)
            pages = data.get("pages", 1) if isinstance(data, dict) else 1
            if page >= pages or not items:
                break
            page += 1
        return results

    async def get_channel_trade_asset(self, start_ms: int, end_ms: int, page: int = 1) -> list:
        payload = await self._get(
            AFFILIATE_BASE, "/api/v3/rebate/affiliate/getChannelUserTradeAndAsset",
            {"startTime": start_ms, "endTime": end_ms, "page": page, "pageSize": 100},
            signed=True, affiliate=True,
        )
        return self._extract_list(self._data(payload), ("records", "_list"))

    async def get_channel_trade_asset_all(self, start_ms: int, end_ms: int) -> list:
        """Fetches all pages from getChannelUserTradeAndAsset."""
        results, page = [], 1
        while True:
            payload = await self._get(
                AFFILIATE_BASE, "/api/v3/rebate/affiliate/getChannelUserTradeAndAsset",
                {"startTime": start_ms, "endTime": end_ms, "page": page, "pageSize": 100},
                signed=True, affiliate=True,
            )
            data = self._data(payload)
            items = self._extract_list(data, ("records", "_list"))
            results.extend(items)
            pages = data.get("pages", 1) if isinstance(data, dict) else 1
            if page >= pages or not items:
                break
            page += 1
        return results

    async def get_affiliate_commission(self, start_ms: int, end_ms: int, page: int = 1, product_type: str = "") -> list:
        params: dict = {"startTime": start_ms, "endTime": end_ms, "page": page, "pageSize": 100}
        if product_type:
            params["productType"] = product_type
        payload = await self._get(
            AFFILIATE_BASE, "/api/v3/rebate/affiliate/getAffiliateCommission",
            params, signed=True, affiliate=True,
        )
        return self._extract_list(self._data(payload), ("channelCommissionInfoItems", "_list"))

    async def get_affiliate_commission_all(self, start_ms: int, end_ms: int) -> list:
        """Все страницы getAffiliateCommission (FUTURES) параллельно."""
        import asyncio as _asyncio

        def _params(page: int) -> dict:
            return {
                "startTime": start_ms, "endTime": end_ms,
                "page": page, "pageSize": 100, "productType": "FUTURES",
            }

        # Первая страница: узнаём total_pages
        first = await self._get(
            AFFILIATE_BASE, "/api/v3/rebate/affiliate/getAffiliateCommission",
            _params(1), signed=True, affiliate=True,
        )
        data0 = self._data(first)
        items0 = self._extract_list(data0, ("channelCommissionInfoItems", "_list"))
        total_pages = data0.get("pages", 1) if isinstance(data0, dict) else 1

        if total_pages <= 1:
            return items0

        # Остальные страницы — параллельно (WEEX rate limit 500 req/10s)
        tasks = [
            self._get(
                AFFILIATE_BASE, "/api/v3/rebate/affiliate/getAffiliateCommission",
                _params(p), signed=True, affiliate=True,
            )
            for p in range(2, total_pages + 1)
        ]
        payloads = await _asyncio.gather(*tasks)

        results = list(items0)
        for payload in payloads:
            results.extend(self._extract_list(self._data(payload), ("channelCommissionInfoItems", "_list")))
        return results

    async def get_agency_assert(self, user_id: str, start_date: str = "", end_date: str = "") -> dict:
        """Asset snapshot for a referral. Dates in yyyy-MM-dd format (WEEX requirement)."""
        params: dict = {"userId": user_id}
        if start_date:
            params["startTime"] = start_date
        if end_date:
            params["endTime"] = end_date
        payload = await self._get(
            AFFILIATE_BASE, "/api/v3/agency/getAssert", params, signed=True, affiliate=True
        )
        return self._data(payload) if payload else {}

    async def check_uid_existence(self, uid: str, contact_type: str = "email", contact_value: str = "") -> bool:
        payload = await self._post(
            AFFILIATE_BASE, "/api/v3/rebate/affiliate/checkUidExistence",
            {"uid": uid, "contactType": contact_type, "contactValue": contact_value},
            affiliate=True,
        )
        data = self._data(payload) if payload else {}
        return bool(data.get("verified"))

    async def get_own_balance(self) -> dict:
        mentor_uid = os.getenv("WEEX_MENTOR_UID", "6613031308")
        return await self.get_agency_assert(mentor_uid)


    async def get_server_time(self) -> int:
        data = await self._get(FUTURES_BASE, "/capi/v3/market/time")
        if isinstance(data, dict):
            for key in ("serverTime", "time", "data"):
                if key in data:
                    val = data[key]
                    if isinstance(val, (int, str)):
                        return int(val)
        return int(time.time() * 1000)

    async def close(self) -> None:
        if self._session is not None and self._owns_session:
            await self._session.close()
