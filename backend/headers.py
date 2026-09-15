"""Заголовки безопасности на каждый ответ API.

Бэкенд отдаёт не только JSON: страницы снимков, загруженные картинки товаров и
аватарки. Без ``nosniff`` браузер вправе угадать в загруженном файле HTML и
выполнить его на нашем домене; без запрета фреймов страницу снимка можно
подложить в чужую страницу под прозрачной кнопкой.

HSTS ставим только на ответ, пришедший по HTTPS: снаружи сервер виден лишь
через туннель Cloudflare, а местные запросы по http://127.0.0.1 (бот, проверки
на столе) заголовка не требуют и не должны его получать.

Чистый ASGI, а не BaseHTTPMiddleware: этот слой стоит на каждом запросе
терминала, и лишняя обёртка над ответом здесь заметна.
"""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Год. Имена api и s живут только за HTTPS, отступать с него некуда.
HSTS = "max-age=31536000"


class SecurityHeaders:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        secure = scope.get("scheme") == "https"

        async def stamped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "SAMEORIGIN")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                if secure:
                    headers.setdefault("Strict-Transport-Security", HSTS)
            await send(message)

        await self.app(scope, receive, stamped)
