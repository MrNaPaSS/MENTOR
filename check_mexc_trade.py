"""Проход сделкой по MEXC: то, чего не видно ни в тестах, ни в обычном пробнике.

Отвечает на вопросы §5 ТЗ MEXC, которые документация не закрывает:

1. встаёт ли защита, приложенная ко входу, и какими заявками она встаёт;
2. принимает ли биржа защиту, поставленную сопровождением на уже открытую
   позицию (`place_tp_sl`), и её перенос (`modify_tp_sl`) - это перенос стопа
   в безубыток, самое частое движение терминала;
3. приходят ли события приватного потока в момент сделки;
4. снимает ли биржа оставшуюся защиту после закрытия позиции, или это делаем мы;
5. сходятся ли исполнения в отчёте с тем, что мы записываем в журнал.

**Учебного контура у MEXC нет - это живые деньги.** Поэтому объём минимальный
(один контракт: у BTC это 0.0001 монеты, около восьми долларов позиции и
полдоллара маржи при плече 20), а запуск требует явного согласия:

    set MEXC_CHECK_KEY=...
    set MEXC_CHECK_SECRET=...
    set MEXC_TRADE_OK=1
    python check_mexc_trade.py [BTCUSDT]

Без `MEXC_TRADE_OK` пробник не поставит ни одной заявки. За собой он убирает:
закрывает позицию и снимает всё, что осталось висеть, - но проверьте счёт
глазами после прогона, деньги настоящие.
"""

from __future__ import annotations

import asyncio
import os
import sys

import aiohttp
from dotenv import load_dotenv

# Ключи берём и из `.env`, как остальные пробники: набирать их руками перед
# каждым запуском - верный способ ошибиться в одном знаке и искать причину
# в бирже.
load_dotenv(override=True)

from core.mexc.futures import MexcFutures  # noqa: E402
from core.mexc.stream import MexcPrivateStream, order_event  # noqa: E402
from core.weex.futures import Credentials, WeexTradeError  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
OK = "  ок  "
NO = " нет  "

# Сколько ждём биржу после заявки. MEXC отвечает быстро, но позиция и условные
# заявки появляются в её выдаче не в тот же миг.
SETTLE = 3.0


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
    if os.getenv("MEXC_TRADE_OK", "").lower() not in ("1", "true", "yes"):
        print(
            "Учебного контура у MEXC нет: этот пробник торгует живыми деньгами.\n"
            "Если счёт пополнен и вы готовы - задайте MEXC_TRADE_OK=1."
        )
        return 1

    key, secret = os.getenv("MEXC_CHECK_KEY", ""), os.getenv("MEXC_CHECK_SECRET", "")
    if not key or not secret:
        print("Нет ключей: MEXC_CHECK_KEY и MEXC_CHECK_SECRET")
        return 1

    keys = Credentials(key, secret, "")
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    client = MexcFutures(keys, factory)
    watcher = Watcher()
    stream = MexcPrivateStream(keys, client.positions, on_orders=watcher.ring)

    # События заявок ловим целиком: по ним видно, чем биржа отвечает на вход.
    original = stream._apply_order

    def remember(payload) -> None:
        try:
            watcher.orders.append(order_event(payload))
        except Exception:  # noqa: BLE001 - разбор события не должен ронять прогон
            pass
        original(payload)

    stream._apply_order = remember  # type: ignore[method-assign]

    opened = False
    try:
        # ── деньги на счёте ─────────────────────────────────────────────────
        balance = await client.balance()
        # Поле то же, что у WEEX: клиент приводит ответ MEXC к её именам.
        free = next((float(row.get("availableBalance") or 0) for row in balance), 0.0)
        line(OK if free > 0 else NO, f"свободно на счёте: {free} USDT")
        if free <= 0:
            print("\nБез денег на счёте заявку не поставить: пополните 5-10 USDT.")
            return 1

        price = await client.last_price(SYMBOL)
        filters = await client.symbol_filters(SYMBOL)
        if not price:
            line(NO, "цена не получена")
            return 1

        # Минимальный объём биржи, а не наш: меньше него заявку не примут.
        qty = filters["min_qty"]
        notional = qty * price
        stop = round(price * 0.97, 1)
        take = round(price * 1.03, 1)
        print(
            f"\nрынок {price}, объём {qty} ({notional:.2f} USDT позиции), "
            f"стоп {stop}, цель {take}"
        )
        if notional > 50:
            line(NO, f"минимальная позиция дороже пятидесяти долларов - возьмите монету дешевле")
            return 1

        stream.start()
        for _ in range(30):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        line(
            OK if stream.ready else NO,
            "приватный поток готов" if stream.ready else "поток не поднялся",
        )

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
            client_order_id=f"probe{int(price)}",
        )
        opened = True
        line(OK, f"заявка принята: {placed}")
        await asyncio.sleep(SETTLE)

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
            print(
                f"      {one.get('orderId')} {one.get('planType')} "
                f"триггер={one.get('triggerPrice')} объём={one.get('quantity')}"
            )

        # ── 2. защита от сопровождения и перенос стопа ──────────────────────
        print("\n── защита сопровождением и перенос стопа ──────────────────────")
        ladder_id = ""
        try:
            ladder = await client.place_tp_sl(
                symbol=SYMBOL,
                plan_type="TAKE_PROFIT",
                trigger_price=str(round(price * 1.05, 1)),
                quantity=str(qty),
                position_side="LONG",
            )
            ladder_id = str(ladder.get("orderId") or "")
            line(OK, f"цель принята: номер {ladder_id}")
        except WeexTradeError as exc:
            line(NO, f"цель не встала: {exc}")

        # Перенос стопа в безубыток - то самое движение, ради которого держится
        # сопровождение. У MEXC для этого одна ручка, и окна без защиты нет:
        # биржа меняет цену на месте, а не снимает и ставит заново.
        current = await client.algo_orders(SYMBOL)
        guard = next(
            (one for one in current if str(one.get("planType") or "").upper() == "STOP_LOSS"),
            None,
        )
        if guard is None:
            line(NO, "стопа среди условных нет - переносить нечего")
        else:
            try:
                moved = await client.modify_tp_sl(
                    symbol=SYMBOL,
                    order_id=str(guard.get("orderId")),
                    trigger_price=str(round(price * 0.999, 1)),
                )
                line(OK, f"стоп перенесён в безубыток: {moved}")
            except WeexTradeError as exc:
                line(NO, f"перенос стопа не прошёл: {exc}")

        await asyncio.sleep(SETTLE)
        plans = await client.algo_orders(SYMBOL)
        line(OK, f"условных заявок всего: {len(plans)}")

        # ── 3. что сказал поток ─────────────────────────────────────────────
        print("\n── приватный поток о сделке ───────────────────────────────────")
        line(OK if watcher.orders else NO, f"событий о заявках: {len(watcher.orders)}")
        for one in watcher.orders[:8]:
            print(
                f"      {one.get('type')} {one.get('status')} номер={one.get('orderId')} "
                f"метка={one.get('clientOrderId')!r}"
            )
        line(
            OK if watcher.rings else NO,
            f"звонков сопровождению: {len(watcher.rings)}"
            + ("" if watcher.rings else " - события есть, а будильник молчит"),
        )

        # ── 4. закрытие и уборка ────────────────────────────────────────────
        print("\n── закрытие позиции ───────────────────────────────────────────")
        held = await client.positions()
        size = next((p["size"] for p in held if p["symbol"] == SYMBOL), "0")
        if float(size or 0) > 0:
            await client.place_order(
                symbol=SYMBOL,
                side="SELL",
                position_side="LONG",
                quantity=str(size),
                order_type="MARKET",
                reduce_only=True,
            )
            opened = False
            line(OK, f"позиция закрыта: {size}")
        await asyncio.sleep(SETTLE + 1)

        left = await client.algo_orders(SYMBOL)
        line(
            OK if not left else NO,
            "биржа сняла защиту сама" if not left else f"защита осталась висеть: {len(left)} шт.",
        )
        for one in left:
            print(f"      {one.get('orderId')} {one.get('planType')} триггер={one.get('triggerPrice')}")

        # ── 5. отчёт биржи против нашего журнала ────────────────────────────
        fills = await client.user_trades(SYMBOL, limit=10)
        line(OK if fills else NO, f"исполнений в отчёте: {len(fills)}")
        for one in fills[:4]:
            print(
                f"      {one.get('side')} {one.get('qty')} по {one.get('price')} "
                f"комиссия={one.get('commission')} итог={one.get('realizedPnl')} "
                f"время={one.get('time')}"
            )
        return 0
    except WeexTradeError as exc:
        line(NO, f"биржа отказала: {exc} | код: {getattr(exc, 'code', '')}")
        return 1
    finally:
        # Убираем за собой в любом случае: на живом счёте висящая позиция
        # стоит денег, а висящая защита сработает не вовремя.
        try:
            if opened:
                held = await client.positions()
                size = next((p["size"] for p in held if p["symbol"] == SYMBOL), "0")
                if float(size or 0) > 0:
                    await client.place_order(
                        symbol=SYMBOL,
                        side="SELL",
                        position_side="LONG",
                        quantity=str(size),
                        order_type="MARKET",
                        reduce_only=True,
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
