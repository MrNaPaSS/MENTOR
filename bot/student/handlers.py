"""Команды и онбординг ученика (ТЗ §8, §11)."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from aiogram import F, Router
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from core import repo
from core.db import SessionLocal
from core.models import utcnow
from core.templates import fmt_money
from core.weex.base import WeexClient
from bot.keyboards import approve_keyboard, lang_keyboard, mode_keyboard


class Onboarding(StatesGroup):
    language = State()
    mode = State()
    risk = State()
    weex_uid = State()


def build_student_router(admin_id: int, referral_link: str = "https://www.weex.com/ru/register?vipCode=kaktotakxme") -> Router:
    router = Router(name="student")

    @router.message(Command("start"))
    async def cmd_start(message: Message, state: FSMContext):
        user = message.from_user
        with SessionLocal() as session:
            student = repo.get_or_create_student(session, user.id, user.username)
            has_uid = bool(student.weex_uid)
            approved = student.is_approved

        if approved and has_uid:
            await message.answer("Вы уже зарегистрированы. /balance · /active · /help")
            return

        # Не ждём ручного одобрения — сразу даём ввести UID.
        # Уведомляем ментора фоново, но не блокируем пользователя.
        if not approved:
            try:
                await message.bot.send_message(
                    admin_id,
                    f"🟡 Новый пользователь: @{user.username or user.id} (id {user.id}) — начал регистрацию",
                )
            except Exception:
                pass
            await message.answer(
                "👋 Добро пожаловать в NMNH — торговые сигналы по WEEX!\n\n"
                "Для доступа к сигналам нужен аккаунт WEEX.\n"
                "Если ещё не зарегистрирован — создай аккаунт по ссылке:\n"
                f"👉 {referral_link}\n\n"
                "Уже есть аккаунт? Продолжаем 👇"
            )

        await state.set_state(Onboarding.language)
        await message.answer("Выберите язык:", reply_markup=lang_keyboard())

    @router.callback_query(F.data.startswith("lang:"), StateFilter(Onboarding.language))
    async def set_language(callback: CallbackQuery, state: FSMContext):
        lang = callback.data.split(":", 1)[1]
        await state.update_data(language=lang)
        await state.set_state(Onboarding.mode)
        await callback.message.edit_text("Выберите режим:", reply_markup=mode_keyboard())
        await callback.answer()

    @router.callback_query(F.data.startswith("mode:"), StateFilter(Onboarding.mode))
    async def set_mode(callback: CallbackQuery, state: FSMContext):
        mode = callback.data.split(":", 1)[1]
        await state.update_data(mode=mode)
        if mode == "moderate":
            await state.set_state(Onboarding.risk)
            await callback.message.edit_text("Введите риск % (1–5):")
        else:
            await state.set_state(Onboarding.weex_uid)
            await callback.message.edit_text("Введите ваш WEEX UID:")
        await callback.answer()

    @router.message(StateFilter(Onboarding.risk))
    async def set_risk(message: Message, state: FSMContext):
        try:
            risk = Decimal((message.text or "").replace(",", "."))
        except InvalidOperation:
            await message.answer("Введите число от 1 до 5.")
            return
        if not (Decimal(1) <= risk <= Decimal(5)):
            await message.answer("Риск должен быть от 1 до 5%.")
            return
        await state.update_data(risk=str(risk))
        await state.set_state(Onboarding.weex_uid)
        await message.answer("Введите ваш WEEX UID:")

    @router.message(StateFilter(Onboarding.weex_uid))
    async def set_weex_uid(message: Message, state: FSMContext, weex: WeexClient):
        from sqlalchemy import select as sa_select
        from core.models import Student

        uid = (message.text or "").strip()
        tg_id = message.from_user.id

        # Проверяем: есть ли уже зарегистрированный с таким UID в базе.
        with SessionLocal() as session:
            existing = session.execute(
                sa_select(Student).where(Student.weex_uid == uid)
            ).scalar_one_or_none()

            if existing is not None:
                # UID уже есть в системе — привязываем текущего пользователя.
                student = repo.get_or_create_student(session, tg_id, message.from_user.username)
                data = await state.get_data()
                student.language = data.get("language", "ru")
                student.mode = data.get("mode", "moderate")
                if data.get("risk"):
                    student.risk_percent = Decimal(data["risk"])
                student.weex_uid = uid
                student.is_approved = True
                student.balance_usdt = existing.balance_usdt
                student.balance_updated_at = existing.balance_updated_at
                session.commit()
                await state.clear()
                await message.answer(
                    f"✅ Вы уже зарегистрированы в системе! Доступ открыт.\n"
                    f"/balance · /active · /help"
                )
                return

        # UID новый — проверяем через WEEX affiliate API.
        balance = await weex.get_affiliate_balance(uid)
        if balance is None:
            await message.answer("❌ UID не найден в системе WEEX. Проверьте и попробуйте снова.")
            return

        data = await state.get_data()
        with SessionLocal() as session:
            student = repo.get_or_create_student(session, tg_id, message.from_user.username)
            student.language = data.get("language", "ru")
            student.mode = data.get("mode", "moderate")
            if data.get("risk"):
                student.risk_percent = Decimal(data["risk"])
            student.weex_uid = uid
            student.is_approved = True
            student.balance_usdt = balance
            student.balance_source = "affiliate_api"
            student.balance_updated_at = utcnow()
            session.commit()

        await state.clear()
        await message.answer(
            f"✅ Регистрация завершена! Баланс: {fmt_money(balance, 2)} USDT\n"
            f"/balance · /active · /help"
        )

        try:
            await message.bot.send_message(
                admin_id,
                f"✅ Зарегистрирован: @{message.from_user.username or tg_id} · UID {uid} · {fmt_money(balance, 2)} USDT",
            )
        except Exception:
            pass

    @router.message(Command("balance"))
    async def cmd_balance(message: Message, weex: WeexClient):
        with SessionLocal() as session:
            student = repo.get_or_create_student(session, message.from_user.id)
            if not student.is_approved or not student.weex_uid:
                await message.answer("Сначала пройдите регистрацию: /start")
                return
            balance = await weex.get_affiliate_balance(student.weex_uid)
            if balance is not None:
                repo.set_balance(session, student, balance, "affiliate_api")
            else:
                balance = student.balance_usdt
        await message.answer(f"💰 Баланс: {fmt_money(balance or 0, 2)} USDT")

    @router.message(Command("active"))
    async def cmd_active(message: Message):
        from sqlalchemy import select
        from core.models import Signal, SignalDelivery, Student
        with SessionLocal() as session:
            student = repo.get_or_create_student(session, message.from_user.id)
            rows = session.execute(
                select(Signal)
                .join(SignalDelivery, SignalDelivery.signal_id == Signal.id)
                .where(SignalDelivery.student_id == student.id, Signal.status == "active")
                .order_by(Signal.created_at.desc())
            ).scalars().all()
        if not rows:
            await message.answer("Активных сигналов нет.")
            return
        lines = ["📡 Активные сигналы:"]
        for s in rows:
            lines.append(f"• {s.symbol} {s.direction} x{s.leverage}")
        await message.answer("\n".join(lines))

    @router.message(Command("help"))
    async def cmd_help(message: Message):
        await message.answer(
            "ℹ️ Команды:\n"
            "/start — регистрация\n"
            "/balance — текущий баланс\n"
            "/active — активные сигналы\n"
            "/settings — режим, язык, риск, UID\n"
            "/help — справка"
        )

    @router.message(Command("settings"))
    async def cmd_settings(message: Message):
        with SessionLocal() as session:
            student = repo.get_or_create_student(session, message.from_user.id)
            mode, lang, risk = student.mode, student.language, student.risk_percent
        await message.answer(
            f"⚙️ Ваши настройки:\n"
            f"• Режим: {mode}\n• Язык: {lang}\n• Риск %: {risk or '—'}\n\n"
            f"Изменение настроек появится в ближайшем обновлении."
        )

    return router
