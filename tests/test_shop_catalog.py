"""Цены подписки на индикатор: поднятые в базе, где каталог уже лежит.

Начальный список товаров заполняет только пустую таблицу, поэтому поднять
цены в работающей базе может лишь обновление каталога по версии. Проверяется
именно это: и свежая база, и уже заполненная, и то, что правку наставника
повторный запуск не затирает.
"""

from __future__ import annotations

from sqlalchemy import select, update

from core import db
from core.models import SettingRow, ShopItem

NEW = {
    "Подписка на индикатор - 7 дней": 450,
    "Подписка на индикатор - 14 дней": 800,
    "Подписка на индикатор - 1 месяц": 1500,
}


def _prices(session) -> dict[str, int]:
    rows = session.execute(select(ShopItem.title, ShopItem.price).where(ShopItem.title.in_(NEW))).all()
    return {title: int(price) for title, price in rows}


def _fresh(tmp_path):
    db.init_engine(f"sqlite:///{tmp_path}/shop.sqlite3")
    db.create_all()
    return db.SessionLocal()


def test_fresh_base_gets_new_prices(tmp_path):
    with _fresh(tmp_path) as session:
        assert _prices(session) == NEW


def test_filled_base_on_old_version_is_raised(tmp_path):
    with _fresh(tmp_path) as session:
        # Как на сервере до обновления: каталог версии 8 со старыми ценами.
        for title, price in {"Подписка на индикатор - 7 дней": 300, "Подписка на индикатор - 14 дней": 550,
                             "Подписка на индикатор - 1 месяц": 1000}.items():
            session.execute(update(ShopItem).where(ShopItem.title == title).values(price=price))
        session.get(SettingRow, "shop_catalog_version").value = "8"
        session.commit()

    db.create_all()
    with db.SessionLocal() as session:
        assert _prices(session) == NEW
        assert session.get(SettingRow, "shop_catalog_version").value == "9"


def test_mentor_price_survives_restart(tmp_path):
    with _fresh(tmp_path) as session:
        session.execute(
            update(ShopItem).where(ShopItem.title == "Подписка на индикатор - 7 дней").values(price=777)
        )
        session.commit()

    db.create_all()
    with db.SessionLocal() as session:
        assert _prices(session)["Подписка на индикатор - 7 дней"] == 777
