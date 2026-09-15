"""Поход сервера по чужой ссылке: только в открытый интернет (backend/netguard.py).

Проверяем то, что ломается молча: превью ссылки в чате не должно открывать
серверу дорогу к самому себе, к туннелю и в локальную сеть стола.
"""

from __future__ import annotations

import asyncio
import socket

import aiohttp
import pytest
from aiohttp import web

from backend import netguard


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.0.0.1:20241/metrics",
        "http://10.1.2.3/x",
        "http://192.168.0.1/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data",
        "http://[::ffff:127.0.0.1]/",
        "http://100.64.0.1/",
        "http://0.0.0.0/",
        "ftp://example.com/",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http:///nohost",
    ],
)
def test_allowed_url_rejects_internal(url):
    assert not netguard.allowed_url(url)


@pytest.mark.parametrize("url", ["https://example.com/page", "http://8.8.8.8/", "https://t.me/x"])
def test_allowed_url_accepts_public(url):
    assert netguard.allowed_url(url)


def _row(host: str, address: str) -> dict:
    return {
        "hostname": host, "host": address, "port": 80,
        "family": socket.AF_INET, "proto": 0, "flags": 0,
    }


def test_resolver_refuses_internal_only(monkeypatch):
    async def fake(self, host, port=0, family=socket.AF_INET):
        return [_row(host, "127.0.0.1"), _row(host, "10.0.0.5")]

    monkeypatch.setattr(aiohttp.ThreadedResolver, "resolve", fake)
    with pytest.raises(OSError):
        asyncio.run(netguard.PublicResolver().resolve("evil.test"))


def test_resolver_keeps_only_public(monkeypatch):
    async def fake(self, host, port=0, family=socket.AF_INET):
        return [_row(host, "127.0.0.1"), _row(host, "93.184.216.34")]

    monkeypatch.setattr(aiohttp.ThreadedResolver, "resolve", fake)
    rows = asyncio.run(netguard.PublicResolver().resolve("mixed.test"))
    assert [r["host"] for r in rows] == ["93.184.216.34"]


async def _serve(routes):
    app = web.Application()
    for path, handler in routes.items():
        app.router.add_get(path, handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, port


def test_fetch_never_reaches_loopback():
    """Ни по IP, ни по имени localhost запрос до сервера на столе не доходит."""
    hits: list[str] = []

    async def secret(request):
        hits.append(request.path)
        return web.Response(text="<title>внутреннее</title>", content_type="text/html")

    async def run():
        runner, port = await _serve({"/": secret})
        try:
            by_ip = await netguard.fetch(f"http://127.0.0.1:{port}/", limit=1024, timeout=3)
            try:
                by_name = await netguard.fetch(f"http://localhost:{port}/", limit=1024, timeout=3)
            except aiohttp.ClientError:
                by_name = None
        finally:
            await runner.cleanup()
        return by_ip, by_name

    by_ip, by_name = asyncio.run(run())
    assert by_ip is None
    assert by_name is None
    assert hits == []


def test_fetch_checks_every_redirect(monkeypatch):
    """Разрешённая страница с редиректом во внутреннюю сеть дальше не идёт."""
    hits: list[str] = []

    async def start(request):
        hits.append(request.path)
        raise web.HTTPFound("/inner")

    async def inner(request):
        hits.append(request.path)
        return web.Response(text="<title>внутреннее</title>", content_type="text/html")

    # Первый шаг пускаем, как если бы это был публичный сайт; второй - нет.
    monkeypatch.setattr(netguard, "allowed_url", lambda url: url.endswith("/start"))

    async def run():
        runner, port = await _serve({"/start": start, "/inner": inner})
        try:
            return await netguard.fetch(f"http://127.0.0.1:{port}/start", limit=1024, timeout=3)
        finally:
            await runner.cleanup()

    assert asyncio.run(run()) is None
    assert hits == ["/start"]
