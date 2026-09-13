"""Вход биржей: связать счёт без ввода ключей API.

Ученику проще и безопаснее нажать «войти через биржу», чем заводить ключ
руками: ключ не ходит через буфер обмена, не остаётся в переписке и не бывает
выдан с лишними правами. Биржи называют это по-разному - у WEEX это OAuth Fast
Connect, у OKX Fast API, - но снаружи путь один и тот же:

    1. терминал просит адрес входа;
    2. ученик подтверждает связку на сайте биржи;
    3. биржа возвращает его назад с кодом;
    4. сервер меняет код на доступ и сохраняет его вместо ключей.

**Адреса и коды сюда не вписаны, и это не упущение.** Вход биржей открывается
брокеру после выдачи брокерского ID, а его ни у одной биржи ещё нет
(`docs/integrations/broker-program-plan.md`, §3). Адрес входа, адрес обмена
кода и пара «идентификатор и секрет» приходят с этим ID, у каждой биржи свои,
и выдумывать их значит написать код, который однажды молча отправит ученика не
туда. Поэтому провайдер собирается из окружения, а пока переменных нет - вход
биржей выключен, и терминал честно предлагает ключи.

Переменные на биржу (пример для OKX; для WEEX те же с префиксом `WEEX_`):

    OKX_OAUTH_CLIENT_ID
    OKX_OAUTH_CLIENT_SECRET
    OKX_OAUTH_AUTHORIZE_URL
    OKX_OAUTH_TOKEN_URL
    OKX_OAUTH_REDIRECT        - куда биржа вернёт ученика
    OKX_OAUTH_SCOPE           - через пробел, необязательно

Обмен кода идёт по правилам OAuth 2.0 с PKCE: код перехватить мало, нужен ещё
проверочный секрет, которого у перехватившего нет.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import aiohttp

logger = logging.getLogger("nmnh.oauth")

# Сколько живёт начатый вход. Пять минут: дольше ученик на странице биржи не
# сидит, а просроченная попытка не должна открывать счёт задним числом.
STATE_TTL = 300

# Как называются ключи торговли в ответе биржи. Списком, потому что биржи
# зовут их по-своему, а угадывать по одному имени - значит промахнуться на
# первой же.
KEY_FIELDS = ("apiKey", "api_key", "accessKey")
SECRET_FIELDS = ("secretKey", "secret_key", "apiSecret", "secret")
PASSPHRASE_FIELDS = ("passphrase", "passPhrase", "apiPassphrase")
UID_FIELDS = ("uid", "userId", "accountId", "account_uid")


@dataclass(frozen=True)
class Provider:
    """Настройки входа одной биржи. Пусто - вход у неё не включён."""

    code: str
    client_id: str = ""
    client_secret: str = ""
    authorize_url: str = ""
    token_url: str = ""
    redirect_uri: str = ""
    scope: str = ""

    @property
    def configured(self) -> bool:
        """Можно ли начинать вход: без любого из четырёх - нельзя."""
        return bool(self.client_id and self.authorize_url and self.token_url and self.redirect_uri)


def provider(code: str) -> Provider:
    """Собрать провайдера из окружения. Ничего не задано - выключен."""
    prefix = (code or "").strip().upper()
    if not prefix.isalpha():
        return Provider(code="")
    return Provider(
        code=code.strip().lower(),
        client_id=os.getenv(f"{prefix}_OAUTH_CLIENT_ID", "").strip(),
        client_secret=os.getenv(f"{prefix}_OAUTH_CLIENT_SECRET", "").strip(),
        authorize_url=os.getenv(f"{prefix}_OAUTH_AUTHORIZE_URL", "").strip(),
        token_url=os.getenv(f"{prefix}_OAUTH_TOKEN_URL", "").strip(),
        redirect_uri=os.getenv(f"{prefix}_OAUTH_REDIRECT", "").strip(),
        scope=os.getenv(f"{prefix}_OAUTH_SCOPE", "").strip(),
    )


def enabled(code: str) -> bool:
    """Даёт ли эта биржа вход прямо сейчас - на этом сервере."""
    return provider(code).configured


# ── PKCE ────────────────────────────────────────────────────────────────────


def new_verifier() -> str:
    """Секрет, который знает только наш сервер. Живёт до конца входа."""
    return secrets.token_urlsafe(48)


def challenge_of(verifier: str) -> str:
    """Отпечаток секрета: его и видит биржа вместо самого секрета."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_url(one: Provider, state: str, verifier: str) -> str:
    """Адрес, на который отправляем ученика."""
    params = {
        "response_type": "code",
        "client_id": one.client_id,
        "redirect_uri": one.redirect_uri,
        "state": state,
        "code_challenge": challenge_of(verifier),
        "code_challenge_method": "S256",
    }
    if one.scope:
        params["scope"] = one.scope
    joiner = "&" if "?" in one.authorize_url else "?"
    return f"{one.authorize_url}{joiner}{urlencode(params)}"


# ── обмен кода ──────────────────────────────────────────────────────────────


class OauthError(Exception):
    """Биржа отказала во входе. Текст показывается ученику как есть."""


async def exchange(
    one: Provider, code: str, verifier: str, session: aiohttp.ClientSession
) -> dict[str, Any]:
    """Поменять код на доступ. Отказ биржи - исключение с её же словами."""
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": one.client_id,
        "redirect_uri": one.redirect_uri,
        "code_verifier": verifier,
    }
    if one.client_secret:
        data["client_secret"] = one.client_secret
    try:
        async with session.post(
            one.token_url,
            data=data,
            headers={"Accept": "application/json"},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as response:
            text = await response.text()
            status = response.status
    except aiohttp.ClientError as exc:
        raise OauthError(f"Биржа недоступна: {exc}") from exc

    try:
        payload = json.loads(text) if text else {}
    except ValueError as exc:
        raise OauthError(f"Биржа ответила не JSON ({status})") from exc
    if not isinstance(payload, dict):
        raise OauthError(f"Биржа ответила неожиданным телом ({status})")
    if status >= 400 or payload.get("error"):
        reason = payload.get("error_description") or payload.get("error") or f"код {status}"
        raise OauthError(f"Биржа отказала во входе: {reason}")
    return payload


def _first(payload: dict, names: tuple[str, ...]) -> str:
    """Первое непустое поле из перечисленных - на любом уровне вложенности."""
    for name in names:
        value = payload.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    nested = payload.get("data")
    if isinstance(nested, dict):
        return _first(nested, names)
    if isinstance(nested, list) and nested and isinstance(nested[0], dict):
        return _first(nested[0], names)
    return ""


@dataclass(frozen=True)
class Grant:
    """Что биржа выдала в обмен на код."""

    access_token: str
    refresh_token: str
    expires_in: int
    api_key: str
    secret_key: str
    passphrase: str
    uid: str

    @property
    def tradable(self) -> bool:
        """Можно ли этим торговать. Один токен без ключей торговлю не открывает."""
        return bool(self.api_key and self.secret_key)


def read_grant(payload: dict) -> Grant:
    """Разобрать ответ биржи: токен и, если биржа их выдала, ключи торговли."""
    return Grant(
        access_token=_first(payload, ("access_token", "accessToken")),
        refresh_token=_first(payload, ("refresh_token", "refreshToken")),
        expires_in=int(_number(payload, ("expires_in", "expiresIn"))),
        api_key=_first(payload, KEY_FIELDS),
        secret_key=_first(payload, SECRET_FIELDS),
        passphrase=_first(payload, PASSPHRASE_FIELDS),
        uid=_first(payload, UID_FIELDS),
    )


def _number(payload: dict, names: tuple[str, ...]) -> float:
    for name in names:
        try:
            value = float(payload.get(name))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        return value
    nested = payload.get("data")
    if isinstance(nested, dict):
        return _number(nested, names)
    return 0.0
