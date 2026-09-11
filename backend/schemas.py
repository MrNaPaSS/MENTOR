"""Pydantic-схемы запросов/ответов API."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


# ── Калькулятор ──

class CalcRequest(BaseModel):
    mode: str = Field(examples=["moderate", "turbo"])
    balance: Decimal
    entry_price: Decimal
    direction: str = Field(examples=["LONG", "SHORT"])
    leverage: Optional[int] = None
    sl_price: Optional[Decimal] = None
    tp_prices: Optional[list[Decimal]] = None


class TakeProfitOut(BaseModel):
    index: int
    percent: Decimal
    price: Decimal
    profit_usd: Decimal
    rr: Decimal


class CalcResponse(BaseModel):
    mode: str
    direction: str
    balance: Decimal
    leverage: int
    entry_price: Decimal
    margin_usd: Decimal
    position_size: Decimal
    sl_percent: Decimal
    sl_price: Decimal
    risk_usd: Decimal
    risk_percent_of_balance: Decimal
    margin_type: str
    take_profits: list[TakeProfitOut]
    warnings: list[str]
    status: str


# ── Рынок ──

class PriceResponse(BaseModel):
    symbol: str
    price: Decimal


# ── Сигналы ──

class SignalOut(BaseModel):
    id: int
    symbol: str
    direction: str
    leverage: int
    entry_price: Decimal
    entry_type: str
    stop_loss: Optional[Decimal]
    tp1: Optional[Decimal]
    tp2: Optional[Decimal]
    tp3: Optional[Decimal]
    margin_type: str
    target_audience: str
    status: str
    chart_url: Optional[str] = None
    # Из какого сообщения чата вырос сигнал. По нему карточка рисует ссылку на
    # обсуждение: там уже лежит разговор о сделке.
    chat_message_id: Optional[int] = None


# ── Статистика ──

class PublicStats(BaseModel):
    total_signals: int
    active_signals: int
    active_students: int
    winrate: Optional[Decimal] = None


class LeaderboardRow(BaseModel):
    rank: int
    username: Optional[str]
    mode: str
    balance: Optional[Decimal]
    # Аватар и надетая рамка: лидерборд показывает людей, а не заглушки.
    avatar: Optional[str] = None
    frame: Optional[str] = None


class TraderRow(BaseModel):
    """Строка таблицы трейдеров: чем человек торговал и с каким результатом.

    Только те, кто торгует по своим ключам: у остальных объём и результат
    известны в лучшем случае со стороны, а места в таблице однажды дадут
    награду - и раздавать её по чужой оценке нельзя.
    """

    rank: int
    username: Optional[str]
    mode: str
    volume: float
    pnl: float
    trades: int
    wins: int


# ── Авторизация ──

class RequestCodeIn(BaseModel):
    weex_uid: str


class RequestCodeOut(BaseModel):
    ok: bool
    detail: str
    code: Optional[str] = None  # только в dev (AUTH_EXPOSE_CODES=true)


class VerifyIn(BaseModel):
    weex_uid: str
    code: str


class TgCodeIn(BaseModel):
    """Запрос бота академии: кому выдать пароль.

    Бот зовёт ручку только после своей проверки и передаёт то, что при ней
    узнал. `weex_uid` обязателен: без него платформа не знает, к какому счёту
    привязывать ученика, а связка с биржей - то, ради чего кабинет и есть.
    """

    tg_id: int
    weex_uid: str = Field(min_length=1, max_length=64)
    username: str = Field(default="", max_length=64)
    # Аватарка из Telegram, data-URL. Её приносит бот - у платформы нет ни
    # токена бота, ни права спрашивать Telegram о человеке. Пусто - у ученика
    # аватарки нет или она закрыта настройками, и это нормально.
    avatar: str = Field(default="", max_length=2_000_000)


class TgCodeOut(BaseModel):
    code: str
    expires_in: int


class TgVerifyIn(BaseModel):
    """Ввод ученика на странице входа. Дефис и регистр здесь не важны."""

    code: str = Field(min_length=1, max_length=32)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str


class StudentOut(BaseModel):
    id: int
    username: Optional[str]
    weex_uid: Optional[str]
    tg_id: Optional[int] = None
    mode: str
    language: str
    balance_usdt: Optional[Decimal]
    is_active: bool
    is_approved: bool
    # Допущен к копированию сделок из чата. Выдаётся наставником поимённо.
    copy_allowed: bool = False
    # Может убирать записи из своего журнала. Тоже поимённо.
    journal_delete_allowed: bool = False
    # VIP: все инструменты терминала без покупки.
    is_vip: bool = False
    coins: int = 0
    # Откуда запись: bot | web | academy
    created_via: str = "bot"
    created_at: Optional[str] = None
    # Входы в кабинет. first_login_at = null означает «ни разу не заходил».
    first_login_at: Optional[str] = None
    last_login_at: Optional[str] = None
    login_count: int = 0


# ── Создание/закрытие сигнала (ментор) ──

class SignalCreate(BaseModel):
    text: str = Field(examples=["XLM LONG\nПлечо 20х"])
    audience: str = Field(default="all", examples=["all", "moderate", "turbo"])
    chart_url: Optional[str] = Field(default=None, examples=["https://www.tradingview.com/x/eQTQ071J/"])


class SignalCreateDirect(BaseModel):
    symbol: str
    direction: str                     # LONG | SHORT
    leverage: int = 20
    entry_price: Decimal
    stop_loss: Decimal
    tp1: Optional[Decimal] = None
    tp2: Optional[Decimal] = None
    tp3: Optional[Decimal] = None
    entry_type: str = "market"
    margin_type: str = "cross"
    audience: str = "all"
    chart_url: Optional[str] = None


class DeliveryPreview(BaseModel):
    username: Optional[str]
    mode: str
    balance: Optional[Decimal]
    margin_usd: Optional[Decimal]
    risk_usd: Optional[Decimal]
    status: str


class SignalCreateResult(BaseModel):
    signal: SignalOut
    deliveries: list[DeliveryPreview]


# ── Профиль ученика ──

class ProfileOut(BaseModel):
    id: int
    username: Optional[str]
    weex_uid: Optional[str]
    mode: str
    language: str
    risk_percent: Optional[Decimal]
    turbo_leverage: Optional[int]
    balance_usdt: Optional[Decimal]
    balance_source: str
    avatar_url: Optional[str] = None
    # Надетая рамка аватара. Пусто - без рамки.
    avatar_frame: Optional[str] = None
    card_name: Optional[str] = None
    # Права наставника. Интерфейсу нужно знать их до отрисовки: кнопки, которой
    # у ученика быть не должно, он не нарисует и на мгновение.
    is_admin: bool = False
    # Допуск к копированию сделок из чата. По той же причине приходит вместе с
    # профилем: «войти» под чужой заявкой видит только допущенный.
    copy_allowed: bool = False
    # Право убирать записи из своего журнала. Кнопку корзины рисует только тот,
    # у кого оно есть, и знать об этом интерфейсу надо до отрисовки.
    journal_delete_allowed: bool = False


class ProfilePatch(BaseModel):
    mode: Optional[str] = None
    language: Optional[str] = None
    risk_percent: Optional[Decimal] = None
    turbo_leverage: Optional[int] = None
    # Имя на карточке сделки. Пустая строка возвращает подпись к нику из
    # Telegram - это способ отказаться от своего варианта, а не ошибка ввода.
    card_name: Optional[str] = Field(default=None, max_length=32)


class AnalyticsMe(BaseModel):
    signals_received: int
    sent: int
    skipped: int
    failed: int


class DevTokens(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None


class DevLoginOut(BaseModel):
    mentor: DevTokens
    student: DevTokens
    student_username: str


# ── Монеты NMNH ──

class CoinTxOut(BaseModel):
    id: int
    amount: int
    reason: str
    ref: str
    created_at: str
    # true - награда ждёт, пока ученик её заберёт; в балансе её ещё нет.
    pending: bool = False


class CoinsBalance(BaseModel):
    balance: int
    # История: то, что уже в балансе или списано.
    transactions: list[CoinTxOut]
    # Ждёт получения, свежее первым.
    pending: list[CoinTxOut] = []
    # Сколько прибавится к балансу, если забрать всё (награды минус долги).
    pending_total: int = 0
    # Сколько наград ждёт - число на значке в шапке.
    pending_count: int = 0


class CoinClaimOut(BaseModel):
    balance: int
    # На сколько вырос баланс. Ноль - забирать было нечего.
    claimed: int
    transactions: list[CoinTxOut]


class CoinSyncIn(BaseModel):
    earned_achievement_ids: list[str]
    current_level: int
    reached_volume_milestones: list[str]  # ["50K", "100K", ...]


class CoinSyncOut(BaseModel):
    balance: int
    # Сколько встало в ожидание этим вызовом.
    added: int
    new_transactions: list[CoinTxOut]
    pending_total: int = 0
    pending_count: int = 0


class CoinGrantIn(BaseModel):
    """Начисление от сервера академии.

    Ученик ищется по ``tg_id`` или ``weex_uid`` — нужен хотя бы один.
    ``ref`` — идентификатор события (например ``module_3``): повторный вызов
    с тем же ref ничего не начисляет, поэтому академия может слать смело.
    ``amount`` не обязателен: если не задан, берётся тариф по ``reason``.
    """

    tg_id: Optional[int] = None
    weex_uid: Optional[str] = None
    ref: str
    reason: str = "academy"
    amount: Optional[int] = None
    username: Optional[str] = None


class CoinBalanceOut(BaseModel):
    """Баланс ученика для мини-аппа академии (запрос по служебному ключу)."""

    # false — такого ученика в базе нет; баланс тогда 0, а не ошибка:
    # мини-аппу нечего показывать, но и падать ему незачем.
    exists: bool
    student_id: Optional[int] = None
    balance: int = 0
    # Начислено, но не забрано: забирают в кабинете. Повод позвать туда.
    pending: int = 0
    tg_id: Optional[int] = None
    weex_uid: Optional[str] = None
    created_via: Optional[str] = None
    # null — ученик в кабинет ни разу не заходил; повод позвать его туда.
    first_login_at: Optional[str] = None


class CoinGrantOut(BaseModel):
    student_id: int
    # Баланс, который можно тратить. Начисление в него не входит, пока
    # ученик не заберёт награду в кабинете.
    balance: int
    added: int
    # Сколько всего ждёт получения, вместе с этим начислением.
    pending: int = 0
    # false, если ref уже был начислен раньше — вызов признан повтором.
    granted: bool
    # true, если ученика завели прямо сейчас: в академии он есть, в кабинет не заходил.
    student_created: bool


# ── Магазин NMNH ──

class ShopItemOut(BaseModel):
    id: int
    title: str
    description: str
    # Английская версия карточки. Пусто - показывается русский текст.
    title_en: str = ""
    description_en: str = ""
    price: int
    category: str
    section: str
    icon: str
    link_url: str
    image_url: str
    requires_tv: bool
    is_active: bool
    sort_order: int
    # Функция платформы, которую открывает товар. Пусто - выдаёт ментор.
    feature: str = ""
    duration_days: int = 0
    charges: int = 0
    # Выбор при заказе, JSON: {"color": [...], "size": [...]}. Пусто - выбирать нечего.
    options: str = ""


class EntitlementOut(BaseModel):
    feature: str
    permanent: bool
    expires_at: Optional[str] = None
    charges: int = 0


class FrameIn(BaseModel):
    # Пусто - снять рамку.
    frame: str = Field(default="", max_length=32)


class ShopItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    title_en: str = Field(default="", max_length=120)
    description_en: str = ""
    price: int = Field(ge=0)
    category: str = "other"
    section: str = "shop"
    icon: str = "Gift"
    link_url: str = Field(default="", max_length=500)
    image_url: str = ""   # URL или data-URL (сжатая картинка) — без лимита длины
    requires_tv: bool = False
    is_active: bool = True
    sort_order: int = 0
    feature: str = Field(default="", max_length=32)
    duration_days: int = Field(default=0, ge=0)
    charges: int = Field(default=0, ge=0)
    options: str = Field(default="", max_length=2000)


class ShopItemPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = None
    title_en: Optional[str] = Field(default=None, max_length=120)
    description_en: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0)
    category: Optional[str] = None
    section: Optional[str] = None
    icon: Optional[str] = None
    link_url: Optional[str] = Field(default=None, max_length=500)
    image_url: Optional[str] = None   # URL или data-URL — без лимита длины
    requires_tv: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    feature: Optional[str] = Field(default=None, max_length=32)
    duration_days: Optional[int] = Field(default=None, ge=0)
    charges: Optional[int] = Field(default=None, ge=0)
    options: Optional[str] = Field(default=None, max_length=2000)


class ShopOrderCreate(BaseModel):
    item_id: int
    contact: str = Field(default="", max_length=255)


class ShopOrderOut(BaseModel):
    id: int
    item_id: Optional[int]
    item_title: str
    price: int
    status: str
    contact: str
    mentor_note: str
    created_at: str
    resolved_at: Optional[str]
    # Только для админских ответов:
    student_id: Optional[int] = None
    student_username: Optional[str] = None
    student_uid: Optional[str] = None


class ShopOrderResolve(BaseModel):
    mentor_note: str = Field(default="", max_length=255)
