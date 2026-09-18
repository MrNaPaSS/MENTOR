"""Автоснимки сделок: инструмент маркета, а не бесплатная автоматика.

Снимок, приложенный руками, остаётся бесплатным - это своя картинка своей
сделки. Платит человек за то, что терминал снимает вход, каждую взятую цель и
закрытие сам, пока трейдер смотрит в стакан.
"""

from __future__ import annotations

from sqlalchemy import select

from backend import entitlements, tools
from core import db
from core.models import SettingRow, ShopItem

FEATURE = "tool_auto_shots"


def _fresh(tmp_path):
    db.init_engine(f"sqlite:///{tmp_path}/tool.sqlite3")
    db.create_all()
    return db.SessionLocal()


def test_tool_is_in_the_shop(tmp_path):
    """Товар лежит в разделе инструментов и привязан к своей функции."""
    with _fresh(tmp_path) as session:
        item = session.execute(
            select(ShopItem).where(ShopItem.feature == FEATURE)
        ).scalars().one()
        assert item.category == "tools"
        assert item.price > 0
        # Навсегда: ни зарядов, ни срока.
        assert not (item.charges or 0)
        assert not (item.duration_days or 0)


def test_filled_base_gets_the_tool_too(tmp_path):
    """База, заполненная до появления инструмента, получает его обновлением.

    Начальный список товаров заполняет только пустую таблицу: у работающей
    платформы он не добавит ничего, и без шага по версии каталога инструмента
    там не появилось бы никогда.
    """
    with _fresh(tmp_path) as session:
        session.execute(ShopItem.__table__.delete().where(ShopItem.feature == FEATURE))
        flag = session.get(SettingRow, "shop_catalog_version")
        flag.value = "9"
        session.commit()

    db.create_all()

    with db.SessionLocal() as session:
        again = session.execute(
            select(ShopItem).where(ShopItem.feature == FEATURE)
        ).scalars().one()
        assert again.title
        assert int(session.get(SettingRow, "shop_catalog_version").value) >= 10


def test_vip_opens_auto_shots(tmp_path):
    """VIP открывает инструменты раздела - и этот тоже."""
    assert FEATURE in entitlements.VIP_FEATURES
    assert FEATURE in entitlements.TOOLS


def test_right_is_checked_by_key():
    """Право читается тем же ключом, что и продаётся."""
    assert tools.AUTO_SHOTS == FEATURE
    assert tools.can_auto_shots(frozenset({FEATURE})) is True
    assert tools.can_auto_shots(frozenset()) is False
