"""Модель данных — единая схема для бота и веб-платформы (docs/architecture/unified-core.md).

Денежные значения — ``Numeric`` (A-09), время — ``DateTime(timezone=True)`` в UTC (A-07).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db import Base

# BigInteger PK, который на SQLite становится INTEGER (иначе нет автоинкремента).
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    """Время строкой, всегда с меткой пояса.

    Колонки объявлены `DateTime(timezone=True)`, но SQLite пояс не хранит и
    отдаёт время голым. Голую строку браузер читает как своё местное: событие,
    случившееся минуту назад, показывается на два часа раньше - ровно на
    разницу с UTC, - и «зашёл только что» превращается в «2 часа назад».

    С PostgreSQL метка приходит сама, и эта проверка ничего не меняет.
    """
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    tg_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    weex_uid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), default="moderate")
    risk_percent: Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
    turbo_leverage: Mapped[int | None] = mapped_column(nullable=True)
    language: Mapped[str] = mapped_column(String(2), default="ru")
    balance_usdt: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    balance_source: Mapped[str] = mapped_column(String(16), default="affiliate_api")
    # Аватарка из Telegram. Путь к файлу, а не сама картинка: её отдаёт тот же
    # сервер, что и снимки, и класть двоичные данные в строку рядом с балансом
    # значит таскать их каждым запросом профиля.
    avatar_url: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Метка текущей сессии. Один вход на ученика: новый вход заводит новую
    # метку, и токены прежнего устройства перестают подходить.
    #
    # Держать её приходится здесь, потому что токен подписан и сам по себе не
    # отзывается: сервер не помнит, какие токены он выдал, и единственный
    # способ закрыть чужой - хранить у ученика ту метку, которая сейчас верна.
    session_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Имя на карточке сделки. Отдельно от `username`: тот приходит из Telegram
    # и переписывается при каждом входе, а карточку показывают другим, и
    # подписывать её ученик вправе так, как хочет. Пусто - берётся ник.
    card_name: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Надетая рамка аватара (backend/frames.py). Пусто - без рамки.
    avatar_frame: Mapped[str | None] = mapped_column(String(32), nullable=True)
    balance_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    # Допуск к копированию сделок из чата. Выдаётся наставником поимённо и по
    # умолчанию закрыт: нажатие «войти» ставит настоящую заявку на настоящие
    # деньги, и открывать такое всем разом нельзя.
    copy_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Право убирать записи из своего журнала. Выдаётся наставником поимённо и
    # по умолчанию закрыто: журнал - это статистика, по которой судят о
    # торговле, и возможность стереть из неё неудачную сделку обесценивает её
    # целиком. Остаётся красивый список, из которого ничего не следует.
    #
    # Бывает, что запись всё-таки мусорная: сделка записалась дважды после
    # обрыва связи, или ученик пробовал терминал на копейку. Разбирать такое
    # через наставника на каждый чих - лишний круг, и тем, кому доверяют,
    # право выдаётся.
    journal_delete_allowed: Mapped[bool] = mapped_column(Boolean, default=False)
    coins: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Откуда появилась запись: bot | web | academy. Ученик может быть заведён
    # сервером академии до того, как он вообще откроет кабинет.
    created_via: Mapped[str] = mapped_column(String(16), default="bot")
    # Учёт входов в кабинет. first_login_at = NULL означает «ни разу не заходил».
    first_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    login_count: Mapped[int] = mapped_column(Integer, default=0)

    deliveries: Mapped[list["SignalDelivery"]] = relationship(back_populates="student")
    coin_transactions: Mapped[list["CoinTransaction"]] = relationship(back_populates="student")


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))
    leverage: Mapped[int] = mapped_column()
    entry_price: Mapped[float] = mapped_column(Numeric(20, 8))
    entry_type: Mapped[str] = mapped_column(String(8), default="market")
    stop_loss: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp1: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp2: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    tp3: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    margin_type: Mapped[str] = mapped_column(String(8), default="cross")
    target_audience: Mapped[str] = mapped_column(String(8), default="all")
    has_photo: Mapped[bool] = mapped_column(Boolean, default=False)
    chart_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Из какого сообщения чата вырос сигнал. Пусто - заведён формой в админке.
    # Ссылку держим без внешнего ключа: сообщение могут удалить, а сигнал после
    # этого закрывается, но остаётся в истории - по нему считают статистику.
    chat_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    deliveries: Mapped[list["SignalDelivery"]] = relationship(back_populates="signal")


class SignalDelivery(Base):
    __tablename__ = "signal_deliveries"
    __table_args__ = (
        UniqueConstraint("signal_id", "student_id", name="uq_delivery_signal_student"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    balance_at_signal: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    margin_usd: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    position_size: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    risk_usd: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp1: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp2: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    profit_tp3: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="sent")  # sent | failed | skipped
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="deliveries")
    student: Mapped["Student"] = relationship(back_populates="deliveries")


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text, default="")
    chart_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)  # торговая пара для графика
    audience: Mapped[str] = mapped_column(String(16), default="all")
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BalanceSnapshot(Base):
    """Дневной снимок баланса ученика для расчёта PnL по дням."""

    __tablename__ = "balance_snapshots"
    __table_args__ = (
        UniqueConstraint("student_id", "date", name="uq_snapshot_student_date"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD UTC
    balance_usdt: Mapped[float] = mapped_column(Numeric(20, 8))
    futures_volume: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    spot_volume: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="affiliate_api")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SettingRow(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class CoinTransaction(Base):
    """История начислений монет NMNH ученику."""

    __tablename__ = "coin_transactions"
    # Начисления идут и из кабинета, и с сервера академии. Проверки «есть ли
    # такой ref» на стороне кода мало: два одновременных запроса пройдут её оба.
    __table_args__ = (
        UniqueConstraint("student_id", "ref", name="uq_coin_tx_student_ref"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(32))   # achievement | level_up | volume_milestone | academy
    ref: Mapped[str] = mapped_column(String(64))       # achievement_id, level number, or milestone label
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Награда начислена, но ещё не забрана: в балансе её нет, пока ученик не
    # нажмёт «Забрать». Покупки, возвраты и списания за убыток идут мимо
    # ожидания - это не награды. См. backend/coin_ledger.py.
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["Student"] = relationship(back_populates="coin_transactions")


class ShopItem(Base):
    """Товар магазина NMNH — покупается за монеты (подписка на индикатор, менторство, VIP)."""

    __tablename__ = "shop_items"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(Integer)               # цена в монетах NMNH (0 = не покупается, витрина)
    category: Mapped[str] = mapped_column(String(32), default="other")  # indicator|mentorship|vip|academy|...
    section: Mapped[str] = mapped_column(String(16), default="shop")     # shop (покупка) | software (витрина)
    icon: Mapped[str] = mapped_column(String(32), default="Gift")        # имя lucide-иконки
    link_url: Mapped[str] = mapped_column(String(500), default="")       # ссылка (индикатор/софт), видна в карточке
    image_url: Mapped[str] = mapped_column(Text, default="")             # обложка: URL или data-URL (сжатая картинка)
    requires_tv: Mapped[bool] = mapped_column(Boolean, default=False)    # требовать ник TradingView при покупке
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Функция платформы, которую открывает товар (backend/entitlements.py).
    # Пусто - обычный товар, его выдаёт ментор. Есть - доступ пишется сразу.
    feature: Mapped[str] = mapped_column(String(32), default="")
    # Как продаётся функция: заряды (расходуются по одному), срок в днях или,
    # если оба нуля, навсегда.
    duration_days: Mapped[int] = mapped_column(Integer, default=0)
    charges: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    orders: Mapped[list["ShopOrder"]] = relationship(back_populates="item")


class ShopOrder(Base):
    """Заказ ученика в магазине. Монеты списываются сразу, выдача — вручную ментором."""

    __tablename__ = "shop_orders"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("shop_items.id"), nullable=True)
    item_title: Mapped[str] = mapped_column(String(120))       # снимок названия на момент покупки
    price: Mapped[int] = mapped_column(Integer)                # снимок цены
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|fulfilled|rejected
    contact: Mapped[str] = mapped_column(String(255), default="")        # контакт/пожелание ученика
    mentor_note: Mapped[str] = mapped_column(String(255), default="")    # комментарий ментора при выдаче
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["Student"] = relationship()
    item: Mapped["ShopItem"] = relationship(back_populates="orders")


class AuthCode(Base):
    """Одноразовый код входа в веб-платформу (UID → код, ТЗ §4.1, контракт A-10)."""

    __tablename__ = "auth_codes"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    weex_uid: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(String(8))
    attempts: Mapped[int] = mapped_column(default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TgAuthCode(Base):
    """Одноразовый пароль входа, выданный ботом академии.

    Отдельная таблица, а не расширение `auth_codes`. Там ключ - `weex_uid`, и
    код проверяется вместе с ним; здесь ключ - `tg_id`, а пароль предъявляют
    сам по себе. Смешать два способа входа в одной таблице значит однажды
    выдать токен не тому.

    Хранится хеш, а не пароль. Пароль живёт пять минут, база - годы, и утечка
    дампа не должна означать возможность войти. Соли нет намеренно: пароль
    случаен и короткоживущ, а искать по хешу надо по индексу.
    """

    __tablename__ = "tg_auth_codes"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, index=True)
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ScalpTrade(Base):
    """Сделка из журнала скальпинг-терминала.

    Пишется, когда сделка закрылась: по стопу, по последней цели или руками.
    Незакрытые сюда не попадают — журнал это факт, а не намерение.

    Цены хранятся с десятью знаками: на монетах вроде PEPE шаг цены — восьмой
    знак после запятой, и обычной точности не хватит.
    """

    __tablename__ = "scalp_trades"
    __table_args__ = (UniqueConstraint("student_id", "client_id", name="uq_scalp_trade_client"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    # Идентификатор сделки на клиенте: страница может отправить запись повторно
    # после обрыва связи, и дубликат в статистике исказил бы её.
    client_id: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    side: Mapped[str] = mapped_column(String(8))               # long | short
    entry: Mapped[float] = mapped_column(Numeric(24, 10))
    stop: Mapped[float] = mapped_column(Numeric(24, 10))
    exit_price: Mapped[float | None] = mapped_column(Numeric(24, 10), nullable=True)
    qty: Mapped[float] = mapped_column(Numeric(24, 10))
    margin: Mapped[float] = mapped_column(Numeric(20, 8))
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    takes_hit: Mapped[int] = mapped_column(Integer, default=0)
    # Цены целей: без них сделку не отрисовать на графике задним числом, а
    # журнал должен показывать не только итог, но и замысел.
    targets_json: Mapped[str] = mapped_column(Text, default="[]")
    outcome: Mapped[str] = mapped_column(String(8))            # stop | take | manual
    pnl: Mapped[float] = mapped_column(Numeric(20, 8), default=0)
    # Комиссия сделки: обе ноги вместе. Без неё «плюс 519 на бирже, плюс 487 в
    # журнале» выглядит расхождением данных, а это она и есть.
    fee: Mapped[float] = mapped_column(Numeric(20, 8), default=0)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    # Запись пришла из исполнений биржи, а не с экрана. Терминал пишет сделку
    # сразу, своей оценкой, чтобы она не пропала; настоящие числа приходят
    # следом с сервера. Без этой отметки поздняя оценка затирала правду, и в
    # журнале стояли цифры, которых на счёте не было.
    from_exchange: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    student: Mapped["Student"] = relationship()


class ChartShot(Base):
    """Снимок графика, которым делятся ссылкой.

    Картинка лежит файлом, здесь только подпись к ней: инструмент, таймфрейм и
    время. Кто снимал - не храним: имя рисуется в самой картинке браузером, а
    базе о владельце знать незачем. Ссылку открывают посторонние.
    """

    __tablename__ = "chart_shots"

    # Идентификатор в ссылке: короткий и непредсказуемый. По порядковому номеру
    # чужие снимки перебирались бы один за другим.
    id: Mapped[str] = mapped_column(String(22), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32))
    interval: Mapped[str] = mapped_column(String(8), default="1m")
    note: Mapped[str] = mapped_column(String(140), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Что именно лежит по ссылке: снимок графика или карточка сделки. У них
    # разные страницы - карточка печатается движением и получает печать, - и
    # различать их надо до того, как страница начнёт собираться.
    kind: Mapped[str] = mapped_column(String(8), default="chart")
    # Сторона сделки у карточки: от неё зависят и заготовка, и цвет страницы.
    side: Mapped[str] = mapped_column(String(5), default="")
    # Чья это карточка. У снимка графика имя рисуется прямо в картинке и базе
    # не нужно, а карточку печать заверяет - и подпись под ней должна быть
    # текстом, чтобы её видел и тот, у кого картинки не загрузились.
    owner: Mapped[str] = mapped_column(String(32), default="")
    # Что нужно странице карточки, кроме самих картинок: имя заготовки, цвет
    # печати и её место в долях. Строкой JSON, а не колонками, намеренно -
    # заготовки будут дорисовывать, у каждой новой рамка стоит по-своему, и
    # заводить миграцию на каждую значит не заводить их вовсе. Числа приходят
    # с той же стороны, что и рисует карточку, поэтому разойтись им негде.
    card_json: Mapped[str] = mapped_column(Text, default="")


class ChatMessage(Base):
    """Сообщение общего чата.

    Автор - ссылка на ученика, а не переписанные в строку ник с аватаркой. Ник
    в Telegram меняют, и старые сообщения обязаны подписываться так же, как
    новые: иначе один и тот же собеседник выглядит в ленте двумя разными.

    Приложенное лежит строкой JSON. Фотография, сделка, ждущая заявка - у
    каждого своя форма, и заводить миграцию на каждый новый вид вложения значит
    не заводить их вовсе. Читает эту строку только тот же чат, разойтись ей не с
    чем.
    """

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    text: Mapped[str] = mapped_column(Text, default="")
    attach_json: Mapped[str] = mapped_column(Text, default="")
    # По времени лента и читается: индекс нужен, страниц истории будет много.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    # Когда сообщение поправили. Пусто - не правили ни разу. Нужно не для учёта,
    # а для честности: исправленное задним числом слово меняет разговор, и
    # собеседник вправе знать, что читает не то, что было написано.
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Во что превратилось сообщение. По этой ссылке карточка в чате знает, что
    # заявка ушла дальше разговора, а удаление сообщения закрывает сигнал.
    signal_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # На какое сообщение это ответ.
    #
    # Без внешнего ключа и намеренно: оригинал удаляют, а ответ обязан остаться.
    # Реплика «этот вход я бы не брал» имеет смысл и без цитаты, а исчезновение
    # чужого ответа вслед за своим сообщением - способ переписать разговор
    # задним числом.
    reply_to_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # В какой ветке написано. Пусто - общая лента: так лежат сообщения,
    # написанные до появления веток, и терять их из-за новой колонки нельзя.
    thread_id: Mapped[int | None] = mapped_column(BigInteger, index=True, nullable=True)
    # Ссылки, вшитые в текст: строкой JSON, списком отрезков
    # ``[{"offset": 0, "length": 3, "url": "..."}]``.
    #
    # Отдельно от вложения, потому что это не вложение: в сообщении «BTC 1m»
    # ссылка спрятана в первых трёх знаках, а само сообщение остаётся текстом.
    # Форма повторяет то, как эти отрезки приходят из Telegram, - иначе перевод
    # в обе стороны пришлось бы писать дважды и по-разному.
    links_json: Mapped[str] = mapped_column(Text, default="")


class ChatThread(Base):
    """Ветка чата - она же тема форума в Telegram.

    Одна запись описывает обе стороны разговора: как ветка называется у нас и
    каким числом её знает Telegram. Держать это в настройках нельзя - темы
    заводят и переименовывают на ходу, а перезапускать сервер ради нового
    раздела никто не станет.

    Номер темы может быть пустым: ветка, заведённая на сайте, живёт до первого
    сообщения в форум, и только тогда у неё появляется тема.
    """

    __tablename__ = "chat_threads"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # message_thread_id темы. Уникален: две ветки на одну тему означали бы, что
    # одно и то же сообщение из форума ляжет в чат дважды.
    tg_topic_id: Mapped[int | None] = mapped_column(
        BigInteger, unique=True, index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(64), default="")
    # Порядок в списке веток. Считать его по времени создания неверно: «вопрос
    # ответ» заводят позже «крипто трейда», а стоять он должен там, где решили.
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Куда попадает сообщение, написанное без выбранной ветки. Ровно одна.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    # Ветка закрыта: читать можно, писать нельзя. Соответствует закрытой теме.
    closed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChatBridge(Base):
    """Связка сообщения чата с сообщением в форуме.

    Нужна не для порядка, а чтобы разговор не пошёл по кругу. Сообщение,
    отправленное нами в тему, прилетает боту обратно обновлением, и без этой
    таблицы оно легло бы в чат вторым экземпляром, снова уехало в форум - и так
    до предела частоты.

    Отсекать по «это писал бот» нельзя: в группе могут работать другие боты, и
    их сообщения в чат как раз нужны.

    Заодно по ней синхронизируются правки и удаления: чтобы поправить
    сообщение в Telegram, надо знать его номер, а он известен только отсюда.
    """

    __tablename__ = "chat_bridge"
    __table_args__ = (UniqueConstraint("tg_chat_id", "tg_message_id", name="uq_bridge_tg"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # Сообщение чата. Без внешнего ключа: связка переживает удаление обеих
    # сторон и служит памятью о том, что этот номер уже был обработан.
    message_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    tg_chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    tg_message_id: Mapped[int] = mapped_column(BigInteger, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ScalpWorkspace(Base):
    """Сохранённый шаблон рабочего места скальпера.

    Один на ученика: ширины панелей, тема, индикаторы, шаг и глубина стакана.
    Хранится строкой JSON, а не колонками, намеренно — набор настроек меняется
    с каждой версией интерфейса, и заводить миграцию на каждый переключатель
    значит не заводить их вовсе.
    """

    __tablename__ = "scalp_workspaces"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), unique=True, index=True)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WeexCredential(Base):
    """Торговые ключи ученика для WEEX.

    Хранятся зашифрованными: мастер-ключ живёт в окружении сервера, в базе
    лежит только шифротекст. Наружу ключ не отдаётся никогда — в интерфейс
    уходит хвост из четырёх символов, чтобы ученик узнал свой ключ.
    """

    __tablename__ = "weex_credentials"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), unique=True, index=True)
    api_key_enc: Mapped[str] = mapped_column(Text)
    secret_enc: Mapped[str] = mapped_column(Text)
    passphrase_enc: Mapped[str] = mapped_column(Text)
    # Хвост ключа для показа владельцу: расшифровывать ради этого нечего.
    key_tail: Mapped[str] = mapped_column(String(8), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LiveTrade(Base):
    """Сделка, которую сервер ведёт сам.

    Появляется, когда терминал отправил ордер на биржу, и живёт, пока позиция
    открыта. Нужна ровно затем, чтобы стоп переезжал в безубыток и когда вкладка
    закрыта: без записи на сервере вести нечего — браузер выключили, и сделка
    осталась без сопровождения.

    Цели хранятся строкой JSON: их три, они не ищутся отдельно и меняются
    целиком. Заводить под них таблицу — три джойна ради списка чисел.
    """

    __tablename__ = "live_trades"
    __table_args__ = (UniqueConstraint("student_id", "client_id", name="uq_live_trade_client"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    client_id: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    side: Mapped[str] = mapped_column(String(8))               # long | short
    entry: Mapped[float] = mapped_column(Numeric(24, 10))
    initial_stop: Mapped[float] = mapped_column(Numeric(24, 10))
    current_stop: Mapped[float] = mapped_column(Numeric(24, 10))
    targets_json: Mapped[str] = mapped_column(Text, default="[]")
    qty: Mapped[float] = mapped_column(Numeric(24, 10))
    leverage: Mapped[int] = mapped_column(Integer, default=1)
    margin: Mapped[float] = mapped_column(Numeric(20, 8), default=0)
    takes_hit: Mapped[int] = mapped_column(Integer, default=0)
    # waiting — заявка стоит, позиции ещё нет; open — позиция набрана;
    # closed — вышли, запись отработала и осталась для истории.
    status: Mapped[str] = mapped_column(String(8), default="waiting", index=True)
    sl_order_id: Mapped[str] = mapped_column(String(64), default="")
    # Сколько раз ждущая лимитка переставлялась. Номер дописывается к
    # идентификатору заявки на бирже: снятый она помнит ещё некоторое время и
    # повторный отклоняет, а наш собственный идентификатор менять нельзя - к
    # нему привязаны и метки заявок, и запись в журнале.
    replaces: Mapped[int] = mapped_column(Integer, default=0)
    # На скольких взятых целях трейдер поставил стоп руками. -1 - не ставил.
    # Сопровождение переносит стоп в безубыток после первой цели, и без этой
    # отметки оно возвращало руками поставленный стоп обратно своим расчётом.
    hand_stop: Mapped[int] = mapped_column(Integer, default=-1)
    # Ордера целей: [{"price":..., "order_id":"...", "filled":false}, ...].
    # Исполнение узнаём опросом самих ордеров, а не по остатку позиции: биржа
    # знает исполненный объём точно, а остаток врёт на частичном исполнении.
    tp_orders_json: Mapped[str] = mapped_column(Text, default="[]")
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LeverageCap(Base):
    """Предел позиции по монете на плече - так, как его назвала биржа.

    WEEX держит предел ступенями по плечу, а в справочнике инструментов
    ступеней нет. Точное число приходит только в отказе «position exceed max
    size X for leverage 'L'» - его и храним, общим для всех учеников: предел
    принадлежит монете, а не счёту. См. backend/trading/leverage_caps.py.
    """

    __tablename__ = "leverage_caps"
    __table_args__ = (UniqueConstraint("symbol", "leverage", name="uq_leverage_cap"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    leverage: Mapped[int] = mapped_column(Integer)
    # Предел в самой монете, как в ответе биржи.
    max_size: Mapped[float] = mapped_column(Numeric(24, 10))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Entitlement(Base):
    """Функция платформы, купленная учеником за монеты. См. backend/entitlements.py."""

    __tablename__ = "entitlements"
    __table_args__ = (UniqueConstraint("student_id", "feature", name="uq_entitlement"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    feature: Mapped[str] = mapped_column(String(32))
    # Куплено навсегда.
    permanent: Mapped[bool] = mapped_column(Boolean, default=False)
    # До какого времени действует доступ на срок. Пусто - срока нет.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Сколько осталось зарядов у расходуемой функции.
    charges: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Certificate(Base):
    """Сертификат трейдера NMNH: уровень и снимок столпов на момент выдачи.

    Картинку не храним: её собирает кабинет из бланка, имени и этих чисел.
    См. backend/certificates.py.
    """

    __tablename__ = "certificates"
    __table_args__ = (UniqueConstraint("student_id", "level", name="uq_certificate_level"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), index=True)
    # bronze | silver | gold
    level: Mapped[str] = mapped_column(String(8))
    # Столпы на момент выдачи: сертификат заверяет то, что было, а не то, что есть.
    pillars_json: Mapped[str] = mapped_column(Text, default="[]")
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Когда ученик открыл сертификат. Пусто - ещё не получен: горит уведомление.
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = ["Student", "Signal", "SignalDelivery", "SettingRow", "AuthCode", "Broadcast", "BalanceSnapshot", "CoinTransaction", "ShopItem", "ShopOrder", "ScalpTrade", "ScalpWorkspace", "ChartShot", "WeexCredential", "LiveTrade", "LeverageCap", "Entitlement", "Certificate", "utcnow"]
