"""Подключение к БД (единый PostgreSQL; для локальной разработки — SQLite).

URL берётся из ``DATABASE_URL`` (см. .env.example). SQLAlchemy абстрагирует СУБД, поэтому код
одинаков для Postgres и SQLite.
"""

from __future__ import annotations

import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def get_database_url() -> str:
    return os.getenv("DATABASE_URL", "sqlite:///nmnh_dev.sqlite3")


def make_engine(url: str | None = None):
    url = url or get_database_url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, connect_args=connect_args)


# Глобальные engine/Session (ленивая инициализация при первом обращении).
_engine = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


def init_engine(url: str | None = None):
    """Инициализировать engine и привязать к нему фабрику сессий."""
    global _engine
    _engine = make_engine(url)
    SessionLocal.configure(bind=_engine)
    return _engine


def get_engine():
    if _engine is None:
        init_engine()
    return _engine


def create_all() -> None:
    """Создать таблицы (для dev/тестов; в проде — миграции)."""
    from core import models  # noqa: F401 — регистрация моделей

    engine = get_engine()
    Base.metadata.create_all(engine)
    _migrate_add_columns(engine)
    _seed_chat_threads(engine)
    _seed_shop_items(engine)
    _normalize_shop_dashes(engine)
    _apply_shop_catalog_v2(engine)
    _apply_shop_catalog_v3(engine)
    _apply_shop_catalog_v4(engine)
    _apply_shop_catalog_v5(engine)
    _apply_shop_catalog_v6(engine)
    _apply_shop_catalog_v7(engine)


def _migrate_add_columns(engine) -> None:
    """Добавить новые колонки к существующим таблицам (SQLite-safe ALTER TABLE)."""
    from sqlalchemy import text, inspect

    with engine.connect() as conn:
        inspector = inspect(engine)

        existing_student_cols = {c["name"] for c in inspector.get_columns("students")}
        if "coins" not in existing_student_cols:
            conn.execute(text("ALTER TABLE students ADD COLUMN coins INTEGER DEFAULT 0 NOT NULL"))
            conn.commit()

        if "broadcasts" in inspector.get_table_names():
            existing_broadcast_cols = {c["name"] for c in inspector.get_columns("broadcasts")}
            if "symbol" not in existing_broadcast_cols:
                conn.execute(text("ALTER TABLE broadcasts ADD COLUMN symbol VARCHAR(32)"))
                conn.commit()

        if "shop_items" in inspector.get_table_names():
            existing_shop_cols = {c["name"] for c in inspector.get_columns("shop_items")}
            if "requires_tv" not in existing_shop_cols:
                conn.execute(text("ALTER TABLE shop_items ADD COLUMN requires_tv BOOLEAN DEFAULT 0 NOT NULL"))
                # уже засеянные подписки на индикатор должны требовать ник TradingView
                conn.execute(text(
                    "UPDATE shop_items SET requires_tv = 1 WHERE category = 'indicator' AND section = 'shop'"
                ))
                conn.commit()
            if "image_url" not in existing_shop_cols:
                conn.execute(text("ALTER TABLE shop_items ADD COLUMN image_url VARCHAR(500) DEFAULT '' NOT NULL"))
                conn.commit()
            # image_url теперь хранит data-URL (длинные) — расширяем тип до TEXT на Postgres.
            # SQLite не ограничивает длину VARCHAR, поэтому там менять не нужно.
            if engine.dialect.name == "postgresql":
                try:
                    conn.execute(text("ALTER TABLE shop_items ALTER COLUMN image_url TYPE TEXT"))
                    conn.commit()
                except Exception:
                    pass

        _add_missing_columns(conn, inspector, engine)


def _add_missing_columns(conn, inspector, engine) -> None:
    """Дополнить таблицы терминала полями, появившимися в моделях позже.

    `create_all` умеет только создавать таблицы целиком: поле, добавленное в
    модель после того, как таблица уже существует, он не добавит, и первый же
    запрос падает с «нет такой колонки». Здесь это делается само — по разнице
    между моделью и базой.

    Перечень таблиц ограничен нашими: трогать чужие автоматикой не будем.
    """
    from sqlalchemy import text

    from core.models import (
        ChartShot,
        ChatBridge,
        ChatMessage,
        ChatThread,
        CoinTransaction,
        LiveTrade,
        Signal,
        ScalpTrade,
        ScalpWorkspace,
        ShopItem,
        Student,
        WeexCredential,
    )

    tables = set(inspector.get_table_names())
    for model in (
        CoinTransaction,
        ShopItem,
        ScalpTrade,
        ScalpWorkspace,
        WeexCredential,
        LiveTrade,
        ChartShot,
        ChatBridge,
        ChatMessage,
        ChatThread,
        Signal,
        Student,
    ):
        table = model.__table__
        if table.name not in tables:
            continue

        present = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present:
                continue

            kind = column.type.compile(engine.dialect)
            ddl = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {kind}"

            default = getattr(column.default, "arg", None)
            if default is not None and not callable(default):
                literal = f"'{default}'" if isinstance(default, str) else str(default)
                ddl += f" DEFAULT {literal}"

            conn.execute(text(ddl))
            conn.commit()
            logging.getLogger("nmnh.db").info(
                "Добавлена колонка %s.%s", table.name, column.name
            )


# Ветки чата - они же темы торгового форума в Telegram.
# Кортеж: (название, номер темы, порядок, ветка по умолчанию)
_DEFAULT_CHAT_THREADS = [
    ("Крипто трейд", 10, 10, True),
    ("Фулдилка", 14, 20, False),
    ("Вопрос - ответ", 8, 30, False),
    ("Марафон", 32281, 40, False),
]


def _seed_chat_threads(engine) -> None:
    """Завести ветки чата, если их ещё нет.

    Сеем по номеру темы, а не «если таблица пуста»: ветку могли завести на
    сайте раньше, чем дошли руки до этого списка, и стирать её новым разделом
    нельзя. Название существующей не трогаем - его правят в форуме.
    """
    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from core.models import ChatThread

    if "chat_threads" not in inspect(engine).get_table_names():
        return

    with Session(engine) as session:
        known = set(
            session.execute(select(ChatThread.tg_topic_id)).scalars()
        )
        added = [
            ChatThread(title=title, tg_topic_id=topic, position=order, is_default=default)
            for title, topic, order, default in _DEFAULT_CHAT_THREADS
            if topic not in known
        ]
        if not added:
            return
        session.add_all(added)
        session.commit()


# Стартовый каталог магазина — вставляется один раз, если таблица пуста.
# Кортеж: (title, description, price, category, section, icon, link_url, requires_tv, sort_order)
# Цены: 1 NMNH = $0.10 (индикатор/мес = $100 = 1000 NMNH, менторство = $1000 = 10000 NMNH).
_DEFAULT_SHOP_ITEMS = [
    # ── Покупка за NMNH (подписки на индикатор требуют ник TradingView) ──
    ("Подписка на индикатор - 7 дней", "Доступ к приватному индикатору NMNH на TradingView на 7 дней.", 300, "indicator", "shop", "TrendingUp", "", True, 10),
    ("Подписка на индикатор - 14 дней", "Доступ к приватному индикатору NMNH на 14 дней.", 550, "indicator", "shop", "TrendingUp", "", True, 20),
    ("Подписка на индикатор - 1 месяц", "Доступ к приватному индикатору NMNH на 30 дней. Максимальная выгода.", 1000, "indicator", "shop", "TrendingUp", "", True, 30),
    ("Индивидуальное менторство", "Персональный разбор, стратегия и сопровождение 1-на-1 с ментором.", 10000, "mentorship", "shop", "GraduationCap", "", False, 40),

    # ── Наш софт (витрина, ссылки добавляются из админки) ──
    ("Индикатор #1 - TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 100),
    ("Индикатор #2 - TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 110),
    ("Индикатор #3 - TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 120),
    ("Академия NMNH", "Обучение, торговые стратегии, AI-агент и библиотека трейдера в одной платформе.", 0, "academy", "software", "GraduationCap", "", False, 130),
    ("Алерты на TradingView", "Готовые алерты на TradingView от NMNH.", 0, "alerts", "software", "BellRing", "", False, 150),
    ("AI-агент по форексу", "AI-агент для анализа форекс-рынка.", 0, "ai", "software", "Bot", "", False, 160),
    ("Веб-расширение FOREX для Chrome", "Расширение Chrome для торговли на форексе.", 0, "extension", "software", "Chrome", "", False, 170),
    ("AI-ментор", "Персональный AI-ментор по трейдингу.", 0, "ai", "software", "Bot", "", False, 180),
    ("AI-психолог", "AI-психолог для контроля эмоций в трейдинге.", 0, "ai", "software", "Brain", "", False, 190),
    ("Алго-трейд", "Алгоритмическая торговая система NMNH.", 0, "algo", "software", "Cpu", "", False, 200),
]


def _seed_shop_items(engine) -> None:
    """Вставить стартовый каталог магазина, если таблица shop_items пуста."""
    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from core.models import ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names():
        return
    with Session(engine) as session:
        if session.execute(select(ShopItem.id).limit(1)).first():
            return
        session.add_all([
            ShopItem(title=title, description=desc, price=price, category=cat,
                     section=section, icon=icon, link_url=link, requires_tv=req_tv, sort_order=order)
            for title, desc, price, cat, section, icon, link, req_tv, order in _DEFAULT_SHOP_ITEMS
        ])
        session.commit()


def _normalize_shop_dashes(engine) -> None:
    """Привести тире в названиях товаров к дефису.

    Название товара — ключ, по которому каталог находит уже существующую
    строку. Заменить длинное тире только в коде значит порвать это
    сопоставление: обновления цен молча перестали бы находить свои товары.
    """
    from sqlalchemy import func, inspect, update
    from sqlalchemy.orm import Session
    from core.models import ShopItem

    if "shop_items" not in inspect(engine).get_table_names():
        return

    with Session(engine) as session:
        session.execute(
            update(ShopItem)
            .where(ShopItem.title.like("%—%"))
            .values(title=func.replace(ShopItem.title, "—", "-"))
        )
        session.commit()


def _apply_shop_catalog_v2(engine) -> None:
    """Одноразовая коррекция уже засеянного каталога (цены 1 NMNH = $0.10, библиотека → в академию).

    Гейт через settings-флаг ``shop_catalog_version``, поэтому выполняется один раз и не
    затирает товары при последующих рестартах. Для свежей БД сидинг уже даёт v2-цены —
    но флаг всё равно выставляется, чтобы коррекция не запускалась.
    """
    from sqlalchemy import inspect, select, update, delete
    from sqlalchemy.orm import Session
    from core.models import ShopItem, SettingRow

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 2:
            return

        # Новые цены (1 NMNH = $0.10)
        new_prices = {
            "Подписка на индикатор - 7 дней": 300,
            "Подписка на индикатор - 14 дней": 550,
            "Подписка на индикатор - 1 месяц": 1000,
            "Индивидуальное менторство": 10000,
        }
        for title, price in new_prices.items():
            session.execute(update(ShopItem).where(ShopItem.title == title).values(price=price))

        # Библиотека трейдера теперь часть Академии, а не отдельный товар
        session.execute(update(ShopItem).where(ShopItem.title == "Академия NMNH").values(
            description="Обучение, торговые стратегии, AI-агент и библиотека трейдера в одной платформе."
        ))
        session.execute(delete(ShopItem).where(ShopItem.title == "Библиотека трейдера"))

        if flag:
            flag.value = "2"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="2"))
        session.commit()


# Функции платформы за монеты: выдаются сразу, без ментора.
# Кортеж: (title, description, price, category, icon, feature, duration_days, charges, sort_order)
_SHOP_FEATURES_V3 = [
    (
        "Заморозка серии",
        "Один убыток не обрывает серию плюсов: бонусы за 3, 5 и 10 сделок подряд "
        "остаются в досягаемости. Заряд тратится сам, когда серия из двух и больше "
        "плюсов встречает убыток.",
        120, "platform", "Sparkles", "streak_freeze", 0, 1, 1,
    ),
    (
        "Удвоение бонуса за серию - 7 дней",
        "Неделю бонусы за серию плюсов идут вдвойне: 30, 60 и 200 монет вместо 15, "
        "30 и 100. Дневной потолок начислений прежний. Повторная покупка продлевает срок.",
        400, "platform", "Zap", "streak_boost", 7, 0, 2,
    ),
    (
        "Выгрузка журнала в CSV",
        "Кнопка в журнале терминала: все сделки файлом для Excel и Google Таблиц - "
        "вход, выход, объём, итог, комиссия. Покупается один раз, навсегда.",
        200, "platform", "LineChart", "journal_export", 0, 0, 3,
    ),
    (
        "Разбор сделки с ментором",
        "Ментор разбирает одну вашу сделку: вход, сопровождение, выход и что сделать "
        "иначе. В контакте укажите Telegram и какую сделку разобрать.",
        500, "mentorship", "GraduationCap", "", 0, 0, 35,
    ),
]


def _apply_shop_catalog_v3(engine) -> None:
    """Добавить в каталог функции платформы за монеты. Один раз.

    Флагом ``shop_catalog_version``, как и v2: товар, который ментор потом
    удалил или спрятал, не должен возвращаться при каждом рестарте. Товар с
    таким же названием, заведённый руками, не дублируем.
    """
    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from core.models import SettingRow, ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 3:
            return

        known = set(session.execute(select(ShopItem.title)).scalars().all())
        for title, desc, price, cat, icon, feature, days, charges, order in _SHOP_FEATURES_V3:
            if title in known:
                continue
            session.add(ShopItem(
                title=title, description=desc, price=price, category=cat, section="shop",
                icon=icon, feature=feature, duration_days=days, charges=charges, sort_order=order,
            ))

        if flag:
            flag.value = "3"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="3"))
        session.commit()


# Рамки аватара. Кортеж: (title, description, price, feature, sort_order)
_SHOP_FRAMES_V4 = [
    ("Рамка «Неон»", "Тёмный обод с зелёными неоновыми дугами и короной NMNH снизу. "
     "Видна в чате, профиле и лидерборде.", 150, "frame_neon", 50),
    ("Рамка «Карбон»", "Стальной обод с косыми сколами и зелёной подсветкой изнутри.",
     250, "frame_carbon", 51),
    ("Рамка «Пульс»", "Двойное кольцо с бегущим пунктиром, как лента котировок.",
     250, "frame_pulse", 52),
    ("Рамка «Свечи»", "Обод со свечами графика по бокам - для тех, кто живёт в стакане.",
     350, "frame_candles", 53),
    ("Рамка «Корона»", "Металлический обод с короной NMNH сверху. Самая заметная рамка "
     "маркета.", 500, "frame_crown", 54),
]


def _apply_shop_catalog_v4(engine) -> None:
    """Добавить в каталог рамки аватара. Один раз, флагом, как v3."""
    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from core.models import SettingRow, ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 4:
            return

        known = set(session.execute(select(ShopItem.title)).scalars().all())
        for title, desc, price, feature, order in _SHOP_FRAMES_V4:
            if title in known:
                continue
            session.add(ShopItem(
                title=title, description=desc, price=price, category="frame", section="shop",
                icon="Crown", feature=feature, sort_order=order,
            ))

        if flag:
            flag.value = "4"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="4"))
        session.commit()


# Мерч NMNH: физические товары, едут почтой, выдаёт ментор.
# Цены высокие намеренно: мерч - цель на месяцы работы, а не на неделю.
# Кортеж: (title, description, price, image, options, sort_order)
_COLORS = ["Чёрный", "Белый"]
_SIZES = ["S", "M", "L", "XL", "XXL"]
_SHOP_MERCH_V5 = [
    ("Торговый пульт NMNH",
     "Макропад для терминала: кнопки BUY, SELL, OPEN, CLOSE и крутилка с экраном свечей. "
     "Металлический корпус, неоновая подсветка по краю, плетёный кабель. Главный трофей маркета.",
     25000, "/merch/keypad.webp", {"color": _COLORS}, 60),
    ("Комплект: футболка + шорты",
     "Футболка и шорты NMNH TRADE одного цвета: свечи графика, горы и «Better trader, a brighter you» "
     "на спине, молнии на карманах. Дешевле, чем по отдельности.",
     12000, "/merch/set.webp", {"color": _COLORS, "size": _SIZES}, 61),
    ("Футболка NMNH TRADE",
     "Оверсайз-футболка: крупный логотип и свечи спереди, горы и слоган на спине, "
     "«Discipline creates freedom» на рукаве.",
     7000, "/merch/tshirt.webp", {"color": _COLORS, "size": _SIZES}, 62),
    ("Шорты NMNH TRADE",
     "Шорты с логотипом и свечами, карманы на молнии с короной, металлические наконечники шнурка.",
     6000, "/merch/shorts.webp", {"color": _COLORS, "size": _SIZES}, 63),
    ("Кепка NMNH TRADE",
     "Объёмная вышивка логотипа, свечи на козырьке с неоновым кантом, металлическая пряжка с короной.",
     5500, "/merch/cap.webp", {"color": _COLORS}, 64),
    ("Торговый журнал с ручкой",
     "Журнал сделок в твёрдой обложке: на каждой странице вход, выход, результат, эмоции и уроки. "
     "Ручка и закладка NMNH в комплекте.",
     4500, "/merch/journal.webp", {"color": _COLORS}, 65),
    ("Термобутылка NMNH",
     "Стальная термобутылка с защёлкой: свечи графика поднимаются над горами, "
     "«Discipline creates freedom» по низу.",
     4000, "/merch/bottle.webp", {"color": _COLORS}, 66),
    ("Брелок NMNH",
     "Кожаный ремешок, металлическая пластина с логотипом и жетон со свечами и короной.",
     2500, "/merch/keychain.webp", {"color": _COLORS}, 67),
]


def _apply_shop_catalog_v5(engine) -> None:
    """Добавить в каталог мерч NMNH. Один раз, флагом, как v3 и v4."""
    import json

    from sqlalchemy import inspect, select
    from sqlalchemy.orm import Session
    from core.models import SettingRow, ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 5:
            return

        known = set(session.execute(select(ShopItem.title)).scalars().all())
        for title, desc, price, image, options, order in _SHOP_MERCH_V5:
            if title in known:
                continue
            session.add(ShopItem(
                title=title, description=desc, price=price, category="merch", section="shop",
                icon="Gift", image_url=image, options=json.dumps(options, ensure_ascii=False),
                sort_order=order,
            ))

        if flag:
            flag.value = "5"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="5"))
        session.commit()


# Инструменты терминала: раздел маркета «Инструменты». Покупаются один раз,
# навсегда, и работают сразу - без ментора. Цены выше, чем у прочих функций
# платформы: это то, чем работают каждый день.
# Кортеж: (title, description, price, icon, feature, sort_order)
_SHOP_TOOLS_V6 = [
    ("NMNH VISION",
     "Разметка графика одной покупкой: тренд, структура рынка, ордер-блоки, FVG и "
     "зоны. Полки ликвидности, объём и EMA остаются бесплатными. Навсегда.",
     3000, "Eye", "tool_vision", 1),
    ("Кластерная свеча",
     "Разбор любой свечи по уровням: сколько купили и продали на каждой цене, где "
     "перевес и где объём встал стеной. Навсегда.",
     2000, "ScanSearch", "tool_footprint", 2),
    ("Объёмные свечи",
     "Ширина свечи - её объём: крупные деньги видно сразу, без гистограммы под "
     "графиком. Навсегда.",
     1500, "BarChart3", "tool_volume_candles", 3),
    ("Стакан 60 и 100 строк",
     "Стакан глубже рабочих тридцати строк: видно плиты и полки далеко от цены, "
     "до которых ещё не дошли. Навсегда.",
     1200, "Rows3", "tool_dom_depth", 4),
    ("Шаг стакана ×25",
     "Самый крупный шаг сетки стакана: мелкие заявки складываются в уровни, и на "
     "быстрых монетах видна настоящая стена, а не пыль. Навсегда.",
     800, "Layers", "tool_dom_step25", 5),
]

# Выгрузка журнала переезжает в «Инструменты» и становится отчётом.
_JOURNAL_EXPORT_V6 = (
    "Выгрузка журнала: отчёт с диаграммами",
    "Три выгрузки в месяц: оформленный отчёт по сделкам - кривая капитала, итог по "
    "дням и монетам, винрейт, профит-фактор, просадка, комиссии - и таблица сделок "
    "с кнопкой CSV для Excel. Покупается один раз, навсегда.",
    2500,
)


def _apply_shop_catalog_v6(engine) -> None:
    """Раздел «Инструменты»: функции терминала за монеты. Один раз, флагом.

    Выгрузка журнала переезжает туда же - с новой ценой и описанием: теперь это
    отчёт с диаграммами и три выгрузки в месяц. Купившие раньше её не теряют:
    доступ записан у них, а не у товара.
    """
    from sqlalchemy import inspect, select, update
    from sqlalchemy.orm import Session
    from core.models import SettingRow, ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 6:
            return

        known_features = set(
            session.execute(select(ShopItem.feature).where(ShopItem.feature != "")).scalars().all()
        )
        for title, desc, price, icon, feature, order in _SHOP_TOOLS_V6:
            if feature in known_features:
                continue
            session.add(ShopItem(
                title=title, description=desc, price=price, category="tool", section="tools",
                icon=icon, feature=feature, sort_order=order,
            ))

        title, desc, price = _JOURNAL_EXPORT_V6
        session.execute(
            update(ShopItem)
            .where(ShopItem.feature == "journal_export")
            .values(title=title, description=desc, price=price, category="tool",
                    section="tools", sort_order=6)
        )
        if "journal_export" not in known_features:
            session.add(ShopItem(
                title=title, description=desc, price=price, category="tool", section="tools",
                icon="LineChart", feature="journal_export", sort_order=6,
            ))

        if flag:
            flag.value = "6"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="6"))
        session.commit()


def _apply_shop_catalog_v7(engine) -> None:
    """EMA стала бесплатной: описание NMNH VISION больше её не обещает. Один раз.

    Каталог, заведённый v6, уже лежит в базе со старым описанием - правим его
    там, где товар есть. Цена не меняется: остальная разметка на месте.
    """
    from sqlalchemy import inspect, update
    from sqlalchemy.orm import Session
    from core.models import SettingRow, ShopItem

    inspector = inspect(engine)
    if "shop_items" not in inspector.get_table_names() or "settings" not in inspector.get_table_names():
        return

    with Session(engine) as session:
        flag = session.get(SettingRow, "shop_catalog_version")
        if flag and (flag.value or "").isdigit() and int(flag.value) >= 7:
            return

        description = next(desc for _, desc, _, _, feature, _ in _SHOP_TOOLS_V6 if feature == "tool_vision")
        session.execute(
            update(ShopItem).where(ShopItem.feature == "tool_vision").values(description=description)
        )

        if flag:
            flag.value = "7"
        else:
            session.add(SettingRow(key="shop_catalog_version", value="7"))
        session.commit()
