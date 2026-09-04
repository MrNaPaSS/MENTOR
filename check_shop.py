"""Проверка магазина: есть ли активные товары, на что тратить монеты.

Монеты начисляются и за торговлю, и за учёбу в академии. Если активных
товаров нет, вся механика повисает — этим скриптом проверяем, что всё на месте.

Запуск:  python check_shop.py
"""

from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from core.db import SessionLocal, create_all, init_engine
from core.models import CoinTransaction, ShopItem, ShopOrder


def main() -> int:
    init_engine()
    create_all()

    with SessionLocal() as session:
        items = session.execute(select(ShopItem)).scalars().all()
        active = [i for i in items if i.is_active]
        orders = session.execute(select(ShopOrder)).scalars().all()
        granted = session.execute(select(CoinTransaction.amount)).scalars().all()

        print(f"Товаров: {len(items)}, активных: {len(active)}")
        for item in sorted(items, key=lambda i: (i.sort_order, i.id)):
            mark = "+" if item.is_active else "-"
            print(f"  {mark} {item.title} — {item.price} монет [{item.category}/{item.section}]")

        if active:
            prices = [i.price for i in active if i.price > 0]
            if prices:
                print(f"\nЦены: от {min(prices)} до {max(prices)} монет")
        else:
            print("\nАктивных товаров нет — монеты тратить некуда.")

        by_status = Counter(o.status for o in orders)
        print(f"\nЗаказов всего: {len(orders)}" + (f" ({dict(by_status)})" if orders else ""))
        print(f"Монет начислено всего: {sum(granted)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
