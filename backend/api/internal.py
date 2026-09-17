"""Ручки между своими процессами. Снаружи недоступны.

Одна на сегодня: звонок о счёте. Приватные потоки бирж держит процесс сайта, а
открытые терминалы - процесс рыночных данных, и событие биржи надо передать из
первого во второй (`backend/ws/bell_bridge.py`).

Защита двойная: адрес только петлевой и общий секрет из `.env`, тот же, что
подписывает токены. Ручка ничего не читает из базы и ничем не отвечает, кроме
«принято»: даже если бы к ней подобрались, взять из неё нечего - но лишний
звонок терминалу это лишние запросы, поэтому чужих не пускаем.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("nmnh.scalping.ws")

router = APIRouter(prefix="/internal", tags=["internal"])

# Адреса, с которых принимаем: только своя машина.
LOOPBACK = ("127.0.0.1", "::1", "localhost")


class BellIn(BaseModel):
    student_id: int = Field(ge=1)
    reason: str = Field(default="", max_length=32)
    streamed: list[str] | None = None


def _allowed(request: Request) -> None:
    host = (request.client.host if request.client else "") or ""
    if host not in LOOPBACK:
        raise HTTPException(404, "Не найдено")
    secret = getattr(request.app.state.config, "jwt_secret", "")
    token = request.headers.get("X-Internal-Token", "")
    if not secret or not hmac.compare_digest(token, secret):
        raise HTTPException(404, "Не найдено")


@router.post("/bell")
async def bell(request: Request, body: BellIn) -> dict:
    """Сказать терминалам ученика, что на счёте что-то изменилось."""
    _allowed(request)
    hub = getattr(request.app.state, "scalping_hub", None)
    if hub is None:
        # Рыночных данных в этом процессе нет - звонить некому и некого винить.
        return {"ok": False}
    if body.streamed is not None:
        await hub.streamed(body.student_id, tuple(sorted(body.streamed)))
    if body.reason:
        await hub.ring(body.student_id, body.reason)
    return {"ok": True}
