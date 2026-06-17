"""Команды и поток сигнала для ментора (ТЗ §10)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from aiogram import Bot, F, Router

logger = logging.getLogger("nmnh.mentor")
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from core import repo
from core.db import SessionLocal
from core.models import Broadcast
from core.parser import parse_signal
from core.templates import fmt_money, fmt_price
from core.weex.base import WeexClient
from bot.keyboards import audience_keyboard, confirm_keyboard, enter_trade_keyboard
from bot.middlewares import IsAdmin
from bot.services import signal_service
from bot.delivery import deliver_signal

UPLOADS_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

TV_RE = re.compile(r"tradingview\.com/x/([A-Za-z0-9]+)")


class SignalFlow(StatesGroup):
    waiting_text = State()
    choosing_audience = State()
    confirming = State()


def _audience_counts(session) -> dict:
    students = repo.audience_students(session, "all")
    return {
        "all": len(students),
        "moderate": len([s for s in students if s.mode == "moderate"]),
        "turbo": len([s for s in students if s.mode == "turbo"]),
    }


def _parsed_preview(parsed) -> str:
    found = parsed.found_fields
    def tag(name):
        return "НАЙДЕНО" if name in found else "АВТО"
    lines = ["🔍 Разобранный сигнал:"]
    lines.append(f"• Тикер: {parsed.symbol} [{tag('symbol')}]")
    lines.append(f"• Направление: {parsed.direction} [{tag('direction')}]")
    lines.append(f"• Плечо: {parsed.leverage or '—'} [{tag('leverage')}]")
    lines.append(f"• Вход: {parsed.entry_price or 'с WEEX'} [{tag('entry_price')}]")
    lines.append(f"• Стоп: {parsed.stop_loss or 'авто'} [{tag('stop_loss')}]")
    if parsed.take_profits:
        lines.append(f"• Тейки: {', '.join(str(t) for t in parsed.take_profits)}")
    lines.append(f"• Маржа: {parsed.margin_type} | Вход: {parsed.entry_type}")
    return "\n".join(lines)


def build_mentor_router(admin_id: int) -> Router:
    router = Router(name="mentor")
    router.message.filter(IsAdmin(admin_id))
    router.callback_query.filter(IsAdmin(admin_id))

    @router.message(Command("signal"))
    async def cmd_signal(message: Message, state: FSMContext):
        await state.set_state(SignalFlow.waiting_text)
        await message.answer(
            "📡 Введите сигнал в свободной форме.\n\n"
            "Пример:\nXLM LONG\nПлечо 20х\nВход 0.150 (опционально)"
        )

    @router.message(StateFilter(SignalFlow.waiting_text))
    async def got_signal_text(message: Message, state: FSMContext, weex: WeexClient):
        parsed = parse_signal(message.text or "")
        if not parsed.is_valid:
            await message.answer("⚠️ " + "; ".join(parsed.errors) + "\nПопробуйте снова.")
            return
        with SessionLocal() as session:
            settings = repo.load_settings(session)
            resolved = await signal_service.resolve_signal(parsed, weex, settings)
            counts = _audience_counts(session)
        await state.update_data(resolved=resolved.to_dict())
        await state.set_state(SignalFlow.choosing_audience)
        await message.answer(
            _parsed_preview(parsed)
            + f"\n\nЦена входа: {fmt_price(resolved.entry_price)}$\n\nКому отправляем?",
            reply_markup=audience_keyboard(counts),
        )

    @router.callback_query(F.data.startswith("aud:"), StateFilter(SignalFlow.choosing_audience))
    async def choose_audience(callback: CallbackQuery, state: FSMContext, weex: WeexClient):
        audience = callback.data.split(":", 1)[1]
        data = await state.get_data()
        resolved = signal_service.ResolvedSignal.from_dict(data["resolved"])
        resolved.target_audience = audience
        await state.update_data(resolved=resolved.to_dict())

        lines = [f"Аудитория: {audience}. Расчёт под учеников:"]
        with SessionLocal() as session:
            settings = repo.load_settings(session)
            students = repo.audience_students(session, audience)
            if not students:
                await callback.message.edit_text("Нет учеников в этой аудитории.")
                await state.clear()
                await callback.answer()
                return
            for s in students[:20]:
                calc = await signal_service.compute_for_student(resolved, s, weex, settings)
                if calc.status == "skipped":
                    lines.append(f"• @{s.username}: пропуск (мал баланс)")
                else:
                    lines.append(
                        f"• @{s.username} [{s.mode}] бал {fmt_money(s.balance_usdt or 0,0)} → "
                        f"маржа {fmt_money(calc.margin_usd)} | риск {fmt_money(calc.risk_usd)}$"
                    )
        await state.set_state(SignalFlow.confirming)
        await callback.message.edit_text("\n".join(lines), reply_markup=confirm_keyboard())
        await callback.answer()

    @router.callback_query(F.data == "sig:cancel")
    async def cancel(callback: CallbackQuery, state: FSMContext):
        await state.clear()
        await callback.message.edit_text("❌ Отменено.")
        await callback.answer()

    @router.callback_query(F.data == "sig:send", StateFilter(SignalFlow.confirming))
    async def confirm_send(callback: CallbackQuery, state: FSMContext, weex: WeexClient):
        data = await state.get_data()
        resolved = signal_service.ResolvedSignal.from_dict(data["resolved"])
        bot = callback.bot

        async def send(chat_id, text, btn_text, btn_url):
            await bot.send_message(chat_id, text, reply_markup=enter_trade_keyboard(btn_text, btn_url))

        with SessionLocal() as session:
            settings = repo.load_settings(session)
            ref = signal_service.reference_calc(
                resolved, settings, "turbo" if resolved.target_audience == "turbo" else "moderate"
            )
            tps = ref.take_profits
            signal = repo.create_signal(
                session,
                symbol=resolved.symbol, direction=resolved.direction,
                leverage=resolved.leverage or ref.leverage, entry_price=resolved.entry_price,
                entry_type=resolved.entry_type, margin_type=resolved.margin_type,
                stop_loss=ref.sl_price,
                tp1=tps[0].price if len(tps) > 0 else None,
                tp2=tps[1].price if len(tps) > 1 else None,
                tp3=tps[2].price if len(tps) > 2 else None,
                target_audience=resolved.target_audience, status="active",
            )
            students = repo.audience_students(session, resolved.target_audience)
            report = await deliver_signal(
                session, send, signal.id, resolved, students, weex, settings, delay_seconds=0
            )

        out = [f"✅ Сигнал #{signal.id} отправлен. Доставлено: {len(report.sent)}/{report.total}"]
        for u, b in report.sent:
            out.append(f"✅ @{u} — {fmt_money(b or 0, 0)}$")
        for u, r in report.skipped:
            out.append(f"⏭ @{u} — пропуск")
        for u, e in report.failed:
            out.append(f"❌ @{u} — {e}")
        await state.clear()
        await callback.message.edit_text("\n".join(out))
        await callback.answer()

    @router.message(Command("students"))
    async def cmd_students(message: Message):
        with SessionLocal() as session:
            students = repo.list_students(session)
        if not students:
            await message.answer("Учеников пока нет.")
            return
        lines = ["👥 Ученики:"]
        for s in students:
            status = "✅" if s.is_approved and s.is_active else "⏸"
            lines.append(
                f"{status} @{s.username or s.tg_id} [{s.mode}] "
                f"бал {fmt_money(s.balance_usdt or 0, 0)}$"
            )
        await message.answer("\n".join(lines))

    @router.message(Command("stats"))
    async def cmd_stats(message: Message):
        with SessionLocal() as session:
            students = repo.list_students(session, only_approved=True, only_active=True)
            from sqlalchemy import select, func as sqlfunc
            from core.models import Signal
            active_signals = session.execute(
                select(sqlfunc.count()).select_from(Signal).where(Signal.status == "active")
            ).scalar_one()
            total_signals = session.execute(
                select(sqlfunc.count()).select_from(Signal)
            ).scalar_one()
        await message.answer(
            f"📊 Статистика:\n"
            f"• Активных учеников: {len(students)}\n"
            f"• Сигналов всего: {total_signals}\n"
            f"• Активных сигналов: {active_signals}"
        )

    @router.message(Command("history"))
    async def cmd_history(message: Message):
        from sqlalchemy import select
        from core.models import Signal
        with SessionLocal() as session:
            signals = session.execute(
                select(Signal).order_by(Signal.created_at.desc()).limit(10)
            ).scalars().all()
        if not signals:
            await message.answer("История пуста.")
            return
        lines = ["📋 Последние сигналы:"]
        for s in signals:
            lines.append(
                f"#{s.id} {s.symbol} {s.direction} x{s.leverage} "
                f"[{s.target_audience}] — {s.status}"
            )
        await message.answer("\n".join(lines))

    @router.message(Command("settings"))
    async def cmd_settings(message: Message):
        with SessionLocal() as session:
            s = repo.load_settings(session)
        await message.answer(
            "⚙️ Настройки расчёта:\n"
            f"• Умеренный SL: {s.moderate_sl_percent}% | TP {s.moderate_tp1_percent}/"
            f"{s.moderate_tp2_percent}/{s.moderate_tp3_percent}%\n"
            f"• Турбо SL: {s.turbo_sl_percent}% (buffer {s.turbo_sl_buffer}) | "
            f"TP {s.turbo_tp1_percent}/{s.turbo_tp2_percent}/{s.turbo_tp3_percent}%\n"
            f"• Кап маржи турбо: {s.turbo_margin_cap}$\n"
            f"• Плечи по умолчанию: умер {s.default_leverage_moderate}x / турбо {s.default_leverage_turbo}x\n"
            f"• Интервал синхр. балансов: {s.balance_sync_interval} мин"
        )

    # ── Аппрув/реджект ученика ──
    @router.callback_query(F.data.startswith("appr:"))
    async def approve_student(callback: CallbackQuery):
        tg_id = int(callback.data.split(":", 1)[1])
        with SessionLocal() as session:
            st = repo.get_or_create_student(session, tg_id)
            st.is_approved = True
            session.commit()
        try:
            await callback.bot.send_message(tg_id, "✅ Доступ открыт! Отправьте /start для регистрации.")
        except Exception:
            pass
        await callback.message.edit_text(callback.message.text + "\n\n✅ Принят.")
        await callback.answer("Принят")

    @router.callback_query(F.data.startswith("rej:"))
    async def reject_student(callback: CallbackQuery):
        tg_id = int(callback.data.split(":", 1)[1])
        with SessionLocal() as session:
            st = repo.get_or_create_student(session, tg_id)
            st.is_approved = False
            st.is_active = False
            session.commit()
        try:
            await callback.bot.send_message(tg_id, "❌ Доступ закрыт. Обратитесь к ментору.")
        except Exception:
            pass
        await callback.message.edit_text(callback.message.text + "\n\n❌ Отклонён.")
        await callback.answer("Отклонён")

    @router.message(StateFilter(None), F.photo | (F.text & ~F.text.startswith("/")))
    async def save_analysis(message: Message, bot: Bot) -> None:
        logger.info(
            "save_analysis: from=%s type=%s has_photo=%s text=%.80r entities=%s",
            getattr(message.from_user, "id", None),
            message.content_type,
            bool(message.photo),
            message.text or message.caption,
            message.entities or message.caption_entities,
        )
        text = message.caption or message.text or ""
        chart_url: str | None = None

        # Реальное фото (скриншот графика, отправленный напрямую)
        if message.photo:
            photo = message.photo[-1]
            file = await bot.get_file(photo.file_id)
            filename = f"{uuid.uuid4().hex}.jpg"
            dest = UPLOADS_DIR / filename
            await bot.download_file(file.file_path, destination=dest)
            chart_url = f"/uploads/{filename}"
        else:
            # TV-ссылка в тексте сообщения
            m = TV_RE.search(text)
            if not m:
                # TV-ссылка в entities (пересланные сообщения)
                for ent in (message.entities or message.caption_entities or []):
                    url = ent.url or (text[ent.offset: ent.offset + ent.length] if ent.type in ("url", "text_link") else "")
                    m = TV_RE.search(url)
                    if m:
                        break
            if m:
                chart_url = f"https://www.tradingview.com/x/{m.group(1)}/"

        if not text.strip() and not chart_url:
            return

        with SessionLocal() as session:
            session.add(Broadcast(
                text=text.strip(),
                chart_url=chart_url,
                audience="all",
                sent_count=0,
                created_at=datetime.now(timezone.utc),
            ))
            session.commit()

        await message.answer("Анализ сохранён на сайте.")

    return router
