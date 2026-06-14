"""Инлайн-клавиатуры бота."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def audience_keyboard(counts: dict) -> InlineKeyboardMarkup:
    """Выбор аудитории сигнала с количеством учеников."""
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text=f"👥 Всем ({counts.get('all', 0)})", callback_data="aud:all"),
            InlineKeyboardButton(text=f"📊 Умеренным ({counts.get('moderate', 0)})", callback_data="aud:moderate"),
            InlineKeyboardButton(text=f"⚡ Турбо ({counts.get('turbo', 0)})", callback_data="aud:turbo"),
        ]]
    )


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="✅ Отправить", callback_data="sig:send"),
            InlineKeyboardButton(text="❌ Отменить", callback_data="sig:cancel"),
        ]]
    )


def approve_keyboard(tg_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="✅ Принять", callback_data=f"appr:{tg_id}"),
            InlineKeyboardButton(text="❌ Отклонить", callback_data=f"rej:{tg_id}"),
        ]]
    )


def lang_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang:ru"),
            InlineKeyboardButton(text="🇬🇧 English", callback_data="lang:en"),
        ]]
    )


def mode_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="📊 Умеренный", callback_data="mode:moderate"),
            InlineKeyboardButton(text="⚡ Турбо", callback_data="mode:turbo"),
        ]]
    )


def enter_trade_keyboard(text: str, url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=text, url=url)]])
