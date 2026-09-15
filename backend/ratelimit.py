"""Rate limiting для чувствительных эндпоинтов (ТЗ §4.3, A-08).

Скользящее окно по ключу (IP + путь). In-memory — достаточно для одного инстанса; для нескольких
инстансов вынести в Redis. Применяется к ``/api/auth/*``.
"""

from __future__ import annotations

import math
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimiter:
    # Как часто выметать ключи, к которым больше не обращаются. Ключ - это адрес
    # и путь; адрес, заглянувший один раз, иначе оставался бы в памяти навсегда.
    SWEEP_EVERY = 1024

    def __init__(self, max_requests: int, window_seconds: int):
        self.max = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._since_sweep = 0

    def _fresh(self, key: str, now: float) -> list[float]:
        """Попытки в окне: просроченные забываем сразу, чтобы счёт не рос вечно.

        Опустевший ключ убираем совсем. Ключом бывает ученик, а учеников со
        временем становится больше, чем помещается в память процесса, если
        каждый оставляет по пустому списку навсегда.
        """
        bucket = [t for t in self._hits.get(key, []) if now - t < self.window]
        if bucket:
            self._hits[key] = bucket
        else:
            self._hits.pop(key, None)
        return bucket

    def _sweep(self, now: float) -> None:
        """Забыть всех, чьё окно истекло. ``_fresh`` чистит только того, кого спросили."""
        for key in list(self._hits):
            self._fresh(key, now)

    def check(self, key: str, now: float | None = None) -> bool:
        """Пройдёт ли запрос - **не засчитывая** попытку.

        Отдельно от ``allow`` ради нескольких пределов на одну ручку: у
        ИИ-разбора их два, оконный и суточный, и отказ второго не должен
        съедать попытку у первого.
        """
        now = time.time() if now is None else now
        return len(self._fresh(key, now)) < self.max

    def record(self, key: str, now: float | None = None) -> None:
        """Засчитать попытку. Проверку делает вызывающий."""
        now = time.time() if now is None else now
        bucket = self._fresh(key, now)
        bucket.append(now)
        # Пустой ключ `_fresh` убрал из словаря - кладём обратно.
        self._hits[key] = bucket
        self._since_sweep += 1
        if self._since_sweep >= self.SWEEP_EVERY:
            self._since_sweep = 0
            self._sweep(now)

    def retry_after(self, key: str, now: float | None = None) -> int:
        """Через сколько секунд освободится место. Ноль - место есть сейчас."""
        now = time.time() if now is None else now
        bucket = self._fresh(key, now)
        if len(bucket) < self.max:
            return 0
        # Место освободит самая старая попытка, когда выпадет из окна.
        return max(1, math.ceil(self.window - (now - bucket[0])))

    def allow(self, key: str, now: float | None = None) -> bool:
        """True, если запрос в пределах лимита; иначе False (и не засчитывает попытку)."""
        now = time.time() if now is None else now
        if not self.check(key, now):
            return False
        self.record(key, now)
        return True

    def reset(self) -> None:
        self._hits.clear()


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """Общий предел на весь префикс входа плюс отдельные - на узкие места.

    Одного предела на префикс мало. Вход по UID перебирают редко: код там
    проверяется вместе с введённым счётом. Одноразовый пароль от бота
    проверяется сам по себе - подходит любой живой пароль любого ученика, - и
    по этой ручке перебор бьёт всерьёз. Ей нужен свой, более узкий счёт.

    Обновление токена, наоборот, живёт на своём, щедром счёте вместо общего.
    Перебирать там нечего - refresh подписан, - а зовёт его каждый ученик раз в
    четверть часа. Под общим пределом (десять за пятнадцать минут на адрес)
    одиннадцатый ученик за общим адресом - класс академии, общежитие, мобильный
    NAT - получал отказ и сидел с неработающим кабинетом до конца окна.
    """

    def __init__(
        self,
        app,
        limiter: RateLimiter,
        prefix: str = "/api/auth",
        tight: dict[str, RateLimiter] | None = None,
        own: dict[str, RateLimiter] | None = None,
    ):
        super().__init__(app)
        self.limiter = limiter
        self.prefix = prefix
        # Путь → свой ограничитель. Проходить надо оба: узкий не отменяет общий.
        self.tight = tight or {}
        # Путь → ограничитель вместо общего.
        self.own = own or {}

    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method != "OPTIONS" and path.startswith(self.prefix):
            # Разрешаем дев-вход без лимитов (для удобства разработки и тестирования)
            if path == f"{self.prefix}/dev-login":
                return await call_next(request)

            ip = request.client.host if request.client else "unknown"
            key = f"{ip}:{path}"
            own = self.own.get(path)
            if own is not None:
                allowed = own.allow(key)
            else:
                narrow = self.tight.get(path)
                allowed = self.limiter.allow(key)
                if allowed and narrow is not None:
                    allowed = narrow.allow(key)
            if not allowed:
                return JSONResponse(
                    {"detail": "Слишком много попыток. Попробуйте позже."},
                    status_code=429,
                )
        return await call_next(request)
