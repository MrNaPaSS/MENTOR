"""Одна заявка на демо-счёте: проверка подписи с JSON и приложенной защиты.

Лимитка ставится далеко от рынка и снимается сразу же - позиция не
открывается. Проверяется ровно то, чего не видно ни в тестах, ни в пробнике:
принимает ли биржа наш `stopLoss` строкой с JSON внутри и сходится ли подпись
запроса, в котором этот JSON есть.

Запуск (ключи - в окружении, только демо-контур):

    set BINGX_CHECK_KEY=...
    set BINGX_CHECK_SECRET=...
    set BINGX_DEMO=1
    python check_bingx_order.py
"""

from __future__ import annotations

import asyncio
import os
import sys

import aiohttp

from core.bingx.futures import BingxFutures
from core.weex.futures import Credentials, WeexTradeError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
# Насколько ниже рынка ставим лимитку: так далеко, что исполниться она не может.
FAR = 0.7


async def main() -> int:
    if os.getenv("BINGX_DEMO", "").lower() not in ("1", "true", "yes"):
        print("Только для демо-контура: задайте BINGX_DEMO=1")
        return 1

    keys = Credentials(os.environ["BINGX_CHECK_KEY"], os.environ["BINGX_CHECK_SECRET"], "")
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    client = BingxFutures(keys, factory, demo=True)
    order_id = ""
    try:
        price = await client.last_price(SYMBOL)
        filters = await client.symbol_filters(SYMBOL)
        if not price:
            print("цена не получена")
            return 1
        entry = round(price * FAR, 1)
        stop = round(entry * 0.95, 1)
        qty = max(filters["min_qty"], round(3.0 / entry, 6))
        print(f"рынок {price}, ставим лимитку {entry}, стоп {stop}, объём {qty}")

        placed = await client.place_order(
            symbol=SYMBOL,
            side="BUY",
            position_side="LONG",
            quantity=str(qty),
            order_type="LIMIT",
            price=str(entry),
            sl_trigger=str(stop),
            client_order_id=f"{SYMBOL}-проверка-{int(price)}",
        )
        order_id = str(placed.get("orderId") or "")
        print("биржа приняла заявку:", placed)

        orders = await client.open_orders(SYMBOL)
        print("висящих обычных заявок:", len(orders))
        for one in orders:
            print(f"   {one['orderId']} {one['type']} {one['price']} метка={one['clientOrderId']!r}")
        plans = await client.algo_orders(SYMBOL)
        print("висящих условных заявок:", len(plans))
        for one in plans:
            print(f"   {one['orderId']} {one['planType']} триггер={one['triggerPrice']}")
        return 0
    except WeexTradeError as exc:
        print("биржа отказала:", exc, "| код:", exc.code)
        return 1
    finally:
        if order_id:
            try:
                await client.cancel_order(SYMBOL, order_id)
                print("заявка снята")
            except WeexTradeError as exc:
                print("СНЯТЬ НЕ УДАЛОСЬ, снимите руками:", order_id, exc)
        await session.close()


sys.exit(asyncio.run(main()))
