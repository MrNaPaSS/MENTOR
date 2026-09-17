"""Звонок о счёте, когда сокеты терминалов живут в другом процессе.

Рыночные данные вынесены в свой процесс (`NMNH_MARKET=1`): канал стакана, а
вместе с ним и открытые терминалы, обслуживает он. Приватные потоки бирж
остались у процесса сайта - позиции из них читают торговые ручки, и уводить
их отсюда значило бы снова спрашивать биржу.

Получается, что о событии знает один процесс, а сказать о нём надо из
другого. Между ними один локальный запрос: они стоят на одной машине, и это
доли миллисекунды. Ручка слушает только петлю и требует общий секрет -
снаружи в неё не позвонить (`backend/api/internal.py`).

Не дозвонились - молчим: терминал в этом случае узнает об изменении своим
кругом опроса, он никуда не делся, просто идёт реже.
"""

from __future__ import annotations

import logging
import os

import aiohttp

logger = logging.getLogger("nmnh.scalping.ws")

# Адрес процесса рыночных данных. Порт 8002: 8000 - сайт, 8001 - сопровождение.
DEFAULT_URL = "http://127.0.0.1:8002"

# Предел ожидания. Локальный запрос отвечает мгновенно; если процесс рынка
# поднимается или занят, ждать его нельзя - за нами поток биржи.
TIMEOUT = 1.0


def market_url(value: str | None = None) -> str:
    raw = value if value is not None else os.getenv("NMNH_MARKET_URL", "")
    return (raw.strip() or DEFAULT_URL).rstrip("/")


class BellBridge:
    """Звонок в процесс рыночных данных. Свой на процесс, живёт с приложением."""

    def __init__(self, secret: str, url: str | None = None, timeout: float = TIMEOUT):
        self._secret = secret
        self._url = market_url(url)
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: aiohttp.ClientSession | None = None

    async def ring(self, student_id: int, reason: str = "order") -> None:
        await self._post({"student_id": int(student_id), "reason": reason})

    async def streamed(self, student_id: int, venues: tuple[str, ...]) -> None:
        await self._post({"student_id": int(student_id), "streamed": list(venues)})

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None

    async def _post(self, body: dict) -> None:
        try:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession(timeout=self._timeout)
            async with self._session.post(
                f"{self._url}/internal/bell",
                json=body,
                headers={"X-Internal-Token": self._secret},
            ) as response:
                if response.status != 200:
                    logger.debug("Звонок в процесс рынка вернул %s", response.status)
        except Exception as exc:  # noqa: BLE001 - терминал узнает своим кругом
            logger.debug("Звонок в процесс рынка не прошёл: %s", exc)
