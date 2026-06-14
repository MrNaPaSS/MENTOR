"""Rate limiting для чувствительных эндпоинтов (ТЗ §4.3, A-08).

Скользящее окно по ключу (IP + путь). In-memory — достаточно для одного инстанса; для нескольких
инстансов вынести в Redis. Применяется к ``/api/auth/*``.
"""

from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        """True, если запрос в пределах лимита; иначе False (и не засчитывает попытку)."""
        now = time.time() if now is None else now
        bucket = [t for t in self._hits.get(key, []) if now - t < self.window]
        if len(bucket) >= self.max:
            self._hits[key] = bucket
            return False
        bucket.append(now)
        self._hits[key] = bucket
        return True

    def reset(self) -> None:
        self._hits.clear()


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limiter: RateLimiter, prefix: str = "/api/auth"):
        super().__init__(app)
        self.limiter = limiter
        self.prefix = prefix

    async def dispatch(self, request, call_next):
        if request.method != "OPTIONS" and request.url.path.startswith(self.prefix):
            ip = request.client.host if request.client else "unknown"
            if not self.limiter.allow(f"{ip}:{request.url.path}"):
                return JSONResponse(
                    {"detail": "Слишком много попыток. Попробуйте позже."},
                    status_code=429,
                )
        return await call_next(request)
