"""Поход сервера по чужой ссылке - только в открытый интернет.

Превью ссылок в чате и обложки товаров в маркете сервер собирает сам: браузеру
чужую страницу на другой домен не отдают. Но адрес присылает человек, и без
защиты сервер по его просьбе сходил бы куда угодно: к себе же на 127.0.0.1, к
метрикам туннеля, в локальную сеть стола, к адресу метаданных облака. Это SSRF,
и в ответ человек получал бы заголовок внутренней страницы.

Проверка стоит в двух местах, и нужны оба:

* адрес с IP вместо имени проверяется до запроса - резолвер для него не зовётся;
* имя проверяет сам резолвер соединения: внутренние адреса он отбрасывает в
  момент подключения, и подменить ответ DNS между проверкой и запросом нельзя.

Редиректы разбираем сами, по одному, с той же проверкой на каждом шаге: иначе
публичная страница с Location на 127.0.0.1 обходила бы всё сказанное выше.

Ошибки сети поднимаются как есть (aiohttp.ClientError, asyncio.TimeoutError):
что с ними делать, решает вызывающий.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Callable, Mapping
from urllib.parse import urljoin, urlparse

import aiohttp
from aiohttp.abc import AbstractResolver, ResolveResult

# Больше четырёх переходов нормальной странице не нужно, а цепочка без конца -
# способ держать соединение сервера занятым.
MAX_REDIRECTS = 4
_REDIRECTS = frozenset({301, 302, 303, 307, 308})


def is_public_ip(value: str) -> bool:
    """Адрес из открытого интернета: не локальный, не частный, не служебный.

    IPv6 с вложенным IPv4 (``::ffff:127.0.0.1``) разворачиваем: иначе локальный
    адрес прошёл бы в обёртке.
    """
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return ip.is_global and not ip.is_multicast


def allowed_url(url: str) -> bool:
    """Можно ли идти по адресу: http(s), с хостом, и если хост - IP, то публичный.

    Имя здесь не резолвим: это сделает соединение, и сделает честно, в момент
    подключения (см. ``PublicResolver``).
    """
    try:
        parsed = urlparse(url)
        host = parsed.hostname
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not host:
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return True
    return is_public_ip(host)


class PublicResolver(AbstractResolver):
    """Резолвер, который отдаёт соединению только публичные адреса."""

    def __init__(self) -> None:
        # Внутренний резолвер заводим при первом запросе: aiohttp требует для
        # него уже запущенный цикл событий.
        self._inner: aiohttp.ThreadedResolver | None = None

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_INET
    ) -> list[ResolveResult]:
        if self._inner is None:
            self._inner = aiohttp.ThreadedResolver()
        found = await self._inner.resolve(host, port, family)
        public = [row for row in found if is_public_ip(row["host"])]
        if not public:
            raise OSError(f"{host}: адрес не в открытом интернете")
        return public

    async def close(self) -> None:
        if self._inner is not None:
            await self._inner.close()


@dataclass(frozen=True)
class Page:
    """Что пришло по ссылке: конечный адрес после редиректов, тип и начало тела."""

    url: str
    content_type: str
    body: bytes


async def fetch(
    url: str,
    *,
    limit: int,
    timeout: float,
    headers: Mapping[str, str] | None = None,
    read_if: Callable[[str], bool] | None = None,
) -> Page | None:
    """Скачать начало страницы по чужой ссылке. None - идти нельзя или отказали.

    ``read_if`` решает по типу содержимого, читать ли тело: картинку ради её
    типа качать незачем.
    """
    connector = aiohttp.TCPConnector(resolver=PublicResolver())
    async with aiohttp.ClientSession(
        connector=connector,
        timeout=aiohttp.ClientTimeout(total=timeout),
        headers=dict(headers or {}),
    ) as http:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            if not allowed_url(current):
                return None
            async with http.get(current, allow_redirects=False) as res:
                if res.status in _REDIRECTS:
                    target = res.headers.get("Location")
                    if not target:
                        return None
                    current = urljoin(current, target)
                    continue
                if res.status >= 400:
                    return None
                kind = res.headers.get("Content-Type", "")
                wanted = read_if(kind) if read_if is not None else True
                body = await res.content.read(limit) if wanted else b""
                return Page(url=current, content_type=kind, body=body)
    return None
