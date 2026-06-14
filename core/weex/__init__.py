"""WEEX-клиент: фабрика выбирает мок или реальный по конфигу."""

from __future__ import annotations

import os

from core.weex.base import WeexClient
from core.weex.mock import MockWeexClient


def get_weex_client(use_mock: bool | None = None) -> WeexClient:
    """Вернуть клиент WEEX.

    По умолчанию читает переменную окружения ``WEEX_USE_MOCK`` (default true). Пока ключей нет —
    работаем на моке.
    """
    if use_mock is None:
        use_mock = os.getenv("WEEX_USE_MOCK", "true").lower() != "false"

    if use_mock:
        return MockWeexClient()

    from core.weex.real import RealWeexClient  # импорт по требованию

    return RealWeexClient(
        api_key=os.getenv("WEEX_API_KEY", ""),
        secret=os.getenv("WEEX_SECRET_KEY", ""),
        passphrase=os.getenv("WEEX_PASSPHRASE", ""),
        affiliate_key=os.getenv("WEEX_AFFILIATE_KEY", ""),
        affiliate_secret=os.getenv("WEEX_AFFILIATE_SECRET", ""),
        affiliate_passphrase=os.getenv("WEEX_AFFILIATE_PASSPHRASE", ""),
    )


__all__ = ["WeexClient", "MockWeexClient", "get_weex_client"]
