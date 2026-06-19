"""Подключение к БД (единый PostgreSQL; для локальной разработки — SQLite).

URL берётся из ``DATABASE_URL`` (см. .env.example). SQLAlchemy абстрагирует СУБД, поэтому код
одинаков для Postgres и SQLite.
"""

from __future__ import annotations

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
    _seed_shop_items(engine)
    _apply_shop_catalog_v2(engine)


def _migrate_add_columns(engine) -> None:
    """Добавить новые колонки к существующим таблицам (SQLite-safe ALTER TABLE)."""
    from sqlalchemy import text, inspect

    with engine.connect() as conn:
        inspector = inspect(engine)

        existing_student_cols = {c["name"] for c in inspector.get_columns("students")}
        if "coins" not in existing_student_cols:
            conn.execute(text("ALTER TABLE students ADD COLUMN coins INTEGER DEFAULT 0 NOT NULL"))
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


# Стартовый каталог магазина — вставляется один раз, если таблица пуста.
# Кортеж: (title, description, price, category, section, icon, link_url, requires_tv, sort_order)
# Цены: 1 NMNH = $0.10 (индикатор/мес = $100 = 1000 NMNH, менторство = $1000 = 10000 NMNH).
_DEFAULT_SHOP_ITEMS = [
    # ── Покупка за NMNH (подписки на индикатор требуют ник TradingView) ──
    ("Подписка на индикатор — 7 дней", "Доступ к приватному индикатору NMNH на TradingView на 7 дней.", 300, "indicator", "shop", "TrendingUp", "", True, 10),
    ("Подписка на индикатор — 14 дней", "Доступ к приватному индикатору NMNH на 14 дней.", 550, "indicator", "shop", "TrendingUp", "", True, 20),
    ("Подписка на индикатор — 1 месяц", "Доступ к приватному индикатору NMNH на 30 дней. Максимальная выгода.", 1000, "indicator", "shop", "TrendingUp", "", True, 30),
    ("Индивидуальное менторство", "Персональный разбор, стратегия и сопровождение 1-на-1 с ментором.", 10000, "mentorship", "shop", "GraduationCap", "", False, 40),

    # ── Наш софт (витрина, ссылки добавляются из админки) ──
    ("Индикатор #1 — TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 100),
    ("Индикатор #2 — TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 110),
    ("Индикатор #3 — TradingView", "Приватный индикатор NMNH на TradingView.", 0, "indicator", "software", "TrendingUp", "", False, 120),
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
            "Подписка на индикатор — 7 дней": 300,
            "Подписка на индикатор — 14 дней": 550,
            "Подписка на индикатор — 1 месяц": 1000,
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
