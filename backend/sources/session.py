"""Одна общая HTTP-сессия на процесс (ТЗ этап 1, §4.1).

Было три: своя в `market_data.py`, своя в `market_extra.py`, своя в
`institutional.py`. Две из них создавались с выключенной проверкой
сертификата, и понять по коду, почему, было нельзя.

Здесь проверка **включена**: корни берём из `certifi`, как в торговом клиенте
(`backend/api/trading.py`) - до системного хранилища Windows Python не достаёт,
и запрос падает с «unable to get local issuer certificate». Источнику, который
иначе не отвечает, сессию без проверки выдаёт `insecure()`, и в месте вызова
пишется, почему. Секретов в таких запросах быть не должно.
"""

from __future__ import annotations

import os
import ssl

import aiohttp
import certifi

# Восемь секунд: дольше ученик ждать не станет, а цепочка источников за это
# время успеет перейти ко второму.
TIMEOUT_SECONDS = 8
USER_AGENT = "nmnh-platform/1.0"

_session: aiohttp.ClientSession | None = None
_insecure_session: aiohttp.ClientSession | None = None


def roots() -> str:
    """Файл с доверенными корнями для этой машины.

    `SSL_CERT_FILE` - набор, собранный `make_ca_bundle.py`: в нём и публичные
    центры, и корень того, кто перехватывает HTTPS именно на этом сервере. Он
    задан - берём его, иначе корни `certifi`. Проверку не отключаем ни в том,
    ни в другом случае.
    """
    return os.environ.get("SSL_CERT_FILE") or certifi.where()


def _make(*, verify: bool) -> aiohttp.ClientSession:
    ssl_context: ssl.SSLContext | bool = (
        ssl.create_default_context(cafile=roots()) if verify else False
    )
    return aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS),
        connector=aiohttp.TCPConnector(ssl=ssl_context, limit=20),
        headers={"User-Agent": USER_AGENT},
    )


async def get() -> aiohttp.ClientSession:
    """Общая сессия с проверкой сертификата."""
    global _session
    if _session is None or _session.closed:
        _session = _make(verify=True)
    return _session


async def insecure() -> aiohttp.ClientSession:
    """Сессия без проверки сертификата - для источников, которые иначе молчат."""
    global _insecure_session
    if _insecure_session is None or _insecure_session.closed:
        _insecure_session = _make(verify=False)
    return _insecure_session


async def close() -> None:
    """Закрыть сессии при остановке приложения."""
    global _session, _insecure_session
    for existing in (_session, _insecure_session):
        if existing is not None and not existing.closed:
            await existing.close()
    _session = None
    _insecure_session = None
