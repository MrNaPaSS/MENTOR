"""Рассылка сигнала ученикам с задержкой и идемпотентной записью доставки.

Доставка идёт от обычного бота (A-02). Сетевую отправку инкапсулирует callable ``send`` —
это позволяет тестировать логику без реального Telegram.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Awaitable, Callable, Optional

from core import repo
from core.calculator import CalcResult
from core.settings import Settings
from core.templates import render_signal, weex_trade_url
from core.weex.base import WeexClient
from core.models import utcnow
from bot.services import signal_service


# send(chat_id, text, button_text, button_url) -> Awaitable
SendFn = Callable[[int, str, str, str], Awaitable[None]]

_ENTER_TEXT = {"ru": "🚀 Войти в сделку", "en": "🚀 Enter trade"}


@dataclass
class DeliveryReport:
    sent: list = field(default_factory=list)       # [(username, balance)]
    failed: list = field(default_factory=list)     # [(username, error)]
    skipped: list = field(default_factory=list)    # [(username, reason)]

    @property
    def total(self) -> int:
        return len(self.sent) + len(self.failed) + len(self.skipped)


async def deliver_signal(
    session,
    send: SendFn,
    signal_id: int,
    resolved: signal_service.ResolvedSignal,
    students: list,
    weex: WeexClient,
    settings: Settings,
    delay_seconds: float = 3.0,
) -> DeliveryReport:
    """Разослать сигнал списку учеников. Возвращает отчёт о доставке."""
    report = DeliveryReport()

    for i, student in enumerate(students):
        lang = student.language or "ru"
        calc: CalcResult = await signal_service.compute_for_student(resolved, student, weex, settings)

        # Guardrail: позиция меньше минимального ордера — пропускаем (не ошибка).
        if calc.status == "skipped":
            repo.record_delivery(
                session, signal_id, student.id,
                balance_at_signal=student.balance_usdt,
                status="skipped", error=calc.skip_reason, delivered_at=utcnow(),
            )
            report.skipped.append((student.username, calc.skip_reason))
            continue

        text = render_signal(calc, resolved.symbol, resolved.entry_type, lang)
        btn_text = _ENTER_TEXT.get(lang, _ENTER_TEXT["ru"])
        btn_url = weex_trade_url(resolved.symbol, lang)

        try:
            await send(student.tg_id, text, btn_text, btn_url)
        except Exception as exc:  # noqa: BLE001 — фиксируем любую ошибку доставки
            repo.record_delivery(
                session, signal_id, student.id,
                balance_at_signal=student.balance_usdt,
                margin_usd=calc.margin_usd, position_size=calc.position_size,
                risk_usd=calc.risk_usd, status="failed", error=str(exc),
                delivered_at=utcnow(),
            )
            report.failed.append((student.username, str(exc)))
            continue

        profits = [tp.profit_usd for tp in calc.take_profits] + [None, None, None]
        repo.record_delivery(
            session, signal_id, student.id,
            balance_at_signal=student.balance_usdt,
            margin_usd=calc.margin_usd, position_size=calc.position_size,
            risk_usd=calc.risk_usd,
            profit_tp1=profits[0], profit_tp2=profits[1], profit_tp3=profits[2],
            status="sent", delivered_at=utcnow(),
        )
        report.sent.append((student.username, student.balance_usdt))

        # Задержка между отправками (кроме последней) — защита от лимитов Telegram.
        if delay_seconds and i < len(students) - 1:
            await asyncio.sleep(delay_seconds)

    return report
