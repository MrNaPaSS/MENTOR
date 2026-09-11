"""Инструменты терминала: кому что открыто.

Функции терминала продаются в маркете (раздел «Инструменты»), и закрыть их
одними кнопками значит оставить обход через консоль браузера: стакан и разбор
свечи приходят по открытому каналу. Поэтому то, что стоит денег, ограничивает
и сервер - по тем же правам, что покупает ученик.

Бесплатно у всех: стакан в 30 строк, шаги ×1, ×5 и ×10. Остальное - за монеты.
Ментор видит всё: он показывает терминал ученикам.
"""

from __future__ import annotations

import logging

from backend import entitlements
from backend.security import TokenError, decode_token
from core.db import SessionLocal

logger = logging.getLogger("nmnh.tools")

# Сколько строк стакана у всех бесплатно. Глубже - «Стакан 60 и 100 строк».
FREE_ROWS = 30
# Самый крупный бесплатный шаг сетки стакана. Крупнее - «Шаг стакана ×25».
FREE_MAX_AGG = 10

DEPTH = "tool_dom_depth"
STEP25 = "tool_dom_step25"
FOOTPRINT = "tool_footprint"


def rights_from_token(token: str | None, secret: str) -> frozenset[str]:
    """Купленные инструменты по токену. Нет токена или он негоден - ничего.

    Отказом не отвечаем: без прав у человека остаётся бесплатный терминал, и
    ронять ему канал из-за протухшего токена незачем.
    """
    if not token:
        return frozenset()
    try:
        payload = decode_token(token, secret)
    except TokenError:
        return frozenset()
    if payload.get("type") != "access":
        return frozenset()
    if payload.get("role") == "mentor":
        return frozenset(entitlements.TOOLS)
    try:
        student_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return frozenset()
    try:
        with SessionLocal() as session:
            return frozenset(
                row.feature
                for row in entitlements.active_for(session, student_id)
                if row.feature in entitlements.TOOLS
            )
    except Exception as exc:  # noqa: BLE001 - база молчит: бесплатный уровень, а не падение
        logger.warning("Права на инструменты не прочитаны: %s", exc)
        return frozenset()


def rights_from_header(authorization: str | None, secret: str) -> frozenset[str]:
    """То же по заголовку Authorization: Bearer <токен>."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return frozenset()
    return rights_from_token(authorization.split(" ", 1)[1], secret)


def limit_rows(rows: int, rights: frozenset[str]) -> int:
    """Глубина стакана по правам: без покупки - не больше тридцати строк."""
    return rows if DEPTH in rights else min(rows, FREE_ROWS)


def limit_agg(agg: int, rights: frozenset[str]) -> int:
    """Шаг сетки по правам: без покупки - не крупнее ×10."""
    return agg if STEP25 in rights else min(agg, FREE_MAX_AGG)


def can_footprint(rights: frozenset[str]) -> bool:
    return FOOTPRINT in rights
