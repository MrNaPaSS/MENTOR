"""Проход сделкой по демо-счёту BingX: то, чего не видно ни в тестах, ни в пробнике.

Отвечает на вопросы §5-§6 ТЗ, которые документация не закрывает:

1. появляется ли защита, приложенная ко входу, после исполнения - и какими
   заявками она встаёт;
2. принимает ли биржа нашу лестницу целей (той же ручкой, что и сопровождение);
3. приходят ли события приватного потока в момент сделки и есть ли в них связь
   `o.ti` - единственное, чем защита привязана ко входу;
4. снимает ли биржа оставшуюся защиту после закрытия позиции, или это делаем мы.

Работает **только на демо-контуре** (VST) и минимальным объёмом. За собой
убирает: закрывает позицию и снимает всё, что осталось висеть.

    set BINGX_CHECK_KEY=...
    set BINGX_CHECK_SECRET=...
    set BINGX_DEMO=1
    python check_bingx_trade.py
"""

from __future__ import annotations

import asyncio
import os
import sys

import aiohttp

from core.bingx.futures import BingxFutures
from core.bingx.stream import BingxPrivateStream, order_event
from core.weex.futures import Credentials, WeexTradeError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
OK = "  ок  "
NO = " нет  "


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


class Watcher:
    """Слушает приватный поток и запоминает, что пришло."""

    def __init__(self) -> None:
        self.orders: list[dict] = []
        self.rings: list[str] = []

    def ring(self, symbol: str) -> None:
        self.rings.append(symbol)


async def main() -> int:
    if os.getenv("BINGX_DEMO", "").lower() not in ("1", "true", "yes"):
        print("Только для демо-контура: задайте BINGX_DEMO=1")
        return 1

    keys = Credentials(os.environ["BINGX_CHECK_KEY"], os.environ["BINGX_CHECK_SECRET"], "")
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    client = BingxFutures(keys, factory, demo=True)
    watcher = Watcher()
    stream = BingxPrivateStream(keys, client.positions, on_orders=watcher.ring, demo=True)

    # События заявок ловим целиком: нас интересует поле связи `ti`.
    original = stream._apply_order

    def remember(payload: dict) -> None:
        watcher.orders.append(order_event(payload))
        original(payload)

    stream._apply_order = remember  # type: ignore[method-assign]

    opened = False
    try:
        price = await client.last_price(SYMBOL)
        filters = await client.symbol_filters(SYMBOL)
        if not price:
            line(NO, "цена не получена")
            return 1
        qty = max(filters["min_qty"], round(4.0 / price, 8))
        stop = round(price * 0.97, 1)
        take = round(price * 1.03, 1)
        print(f"\nрынок {price}, объём {qty}, стоп {stop}, цель {take}")

        stream.start()
        for _ in range(30):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        line(OK if stream.ready else NO, "приватный поток готов" if stream.ready else "поток не поднялся")

        # ── 1. вход по рынку с приложенной защитой ──────────────────────────
        print("\n── вход по рынку с приложенными стопом и целью ─────────────────")
        placed = await client.place_order(
            symbol=SYMBOL,
            side="BUY",
            position_side="LONG",
            quantity=str(qty),
            order_type="MARKET",
            sl_trigger=str(stop),
            tp_trigger=str(take),
            client_order_id=f"{SYMBOL}-demo-{int(price)}",
        )
        opened = True
        line(OK, f"заявка принята: {placed}")
        await asyncio.sleep(3)

        positions = await client.positions()
        mine = [p for p in positions if p["symbol"] == SYMBOL]
        line(OK if mine else NO, f"позиция на бирже: {mine[0]['size'] if mine else 'нет'}")

        plans = await client.algo_orders(SYMBOL)
        line(
            OK if plans else NO,
            f"условных заявок после входа: {len(plans)}"
            + ("" if plans else " - приложенная защита не встала"),
        )
        for one in plans:
            print(f"      {one['orderId']} {one['planType']} триггер={one['triggerPrice']} объём={one['quantity']}")

        # ── 2. наша цель той же ручкой, что у сопровождения ─────────────────
        print("\n── цель, поставленная сопровождением ──────────────────────────")
        try:
            ladder = await client.place_tp_sl(
                symbol=SYMBOL,
                plan_type="TAKE_PROFIT",
                trigger_price=str(round(price * 1.05, 1)),
                quantity=str(qty),
                position_side="LONG",
            )
            line(OK, f"цель принята: номер {ladder.get('orderId')}")
        except WeexTradeError as exc:
            line(NO, f"цель не встала: {exc}")

        await asyncio.sleep(3)
        plans = await client.algo_orders(SYMBOL)
        line(OK, f"условных заявок всего: {len(plans)}")

        # ── 3. что сказал поток ─────────────────────────────────────────────
        print("\n── приватный поток о сделке ───────────────────────────────────")
        line(OK if watcher.orders else NO, f"событий о заявках: {len(watcher.orders)}")
        for one in watcher.orders[:8]:
            print(
                f"      {one['type']} {one['status']} номер={one['orderId']} "
                f"метка={one['clientOrderId']!r} связь(ti)={one['linkedOrderId']!r}"
            )
        linked = [one for one in watcher.orders if one["linkedOrderId"]]
        line(
            OK if linked else NO,
            "связь o.ti приходит - защиту можно опознать по ней"
            if linked
            else "связи o.ti в событиях нет - опознаём защиту только номерами",
        )

        # ── 4. закрытие и уборка ────────────────────────────────────────────
        print("\n── закрытие позиции ───────────────────────────────────────────")
        held = await client.positions()
        size = next((p["size"] for p in held if p["symbol"] == SYMBOL), "0")
        if float(size) > 0:
            await client.place_order(
                symbol=SYMBOL,
                side="SELL",
                position_side="LONG",
                quantity=size,
                order_type="MARKET",
            )
            opened = False
            line(OK, f"позиция закрыта: {size}")
        await asyncio.sleep(4)

        left = await client.algo_orders(SYMBOL)
        line(
            OK if not left else NO,
            "биржа сняла защиту сама" if not left else f"защита осталась висеть: {len(left)} шт.",
        )
        for one in left:
            print(f"      {one['orderId']} {one['planType']} триггер={one['triggerPrice']}")

        fills = await client.user_trades(SYMBOL, limit=10)
        line(OK if fills else NO, f"исполнений в отчёте: {len(fills)}")
        for one in fills[:4]:
            print(
                f"      {one['side']} {one['qty']} по {one['price']} "
                f"комиссия={one['commission']} итог={one['realizedPnl']} время={one['time']}"
            )
        return 0
    except WeexTradeError as exc:
        line(NO, f"биржа отказала: {exc} | код: {exc.code}")
        return 1
    finally:
        # Убираем за собой в любом случае: позиция и висящие заявки на демо
        # мешают следующему прогону, а на бою стоили бы денег.
        try:
            if opened:
                held = await client.positions()
                size = next((p["size"] for p in held if p["symbol"] == SYMBOL), "0")
                if float(size) > 0:
                    await client.place_order(
                        symbol=SYMBOL,
                        side="SELL",
                        position_side="LONG",
                        quantity=size,
                        order_type="MARKET",
                    )
                    print("позиция закрыта при уборке")
            removed = await client.cancel_all_algo(SYMBOL)
            if removed:
                print(f"снято условных заявок при уборке: {removed}")
        except WeexTradeError as exc:
            print("УБОРКА НЕ ПРОШЛА, проверьте счёт руками:", exc)
        await stream.stop()
        await session.close()


sys.exit(asyncio.run(main()))
