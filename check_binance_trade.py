"""Проход сделкой по Binance: то, чего не видно ни в тестах, ни в пробнике.

У Binance своя особенность, которой нет у остальных: **защиту нельзя приложить
ко входу**. Стоп и цель уходят отдельными заявками следом, и между ними живёт
окно, в котором позиция стоит без стопа. Здесь проверяется, что это окно
закрывается - и что отказ в защите не отменяет уже открытую позицию.

Что проверяется, в порядке нарастания цены ошибки:

1. предел плеча и минимальный объём - без них заявка не уйдёт вовсе;
2. вход по рынку с защитой: сколько заявок встало и какими они пришли;
3. защита от сопровождения и перенос стопа в безубыток;
4. закрытие позиции: снимает ли биржа защиту сама или это делаем мы;
5. исполнения в отчёте - по ним журнал пишет настоящие числа.

**У Binance есть учебный контур**, и это единственная из наших бирж, где проход
ничего не стоит: `BINANCE_TESTNET=1` переключает и ручки, и поток на
`demo-fapi`. Ключи к нему заводятся отдельно, на testnet.binancefuture.com.

    set BINANCE_CHECK_KEY=...
    set BINANCE_CHECK_SECRET=...
    set BINANCE_TESTNET=1     # учебный контур; без него это живые деньги
    set BINANCE_TRADE_OK=1
    python check_binance_trade.py [DOGEUSDT]

Минимальная позиция у Binance - пять долларов номинала на любой монете, это её
правило `MIN_NOTIONAL`. На DOGE это около шестидесяти монет.

За собой пробник убирает: закрывает позицию и снимает всё, что осталось висеть.
"""

from __future__ import annotations

import asyncio
import os
import sys

import aiohttp
from dotenv import load_dotenv

# Ключи берём и из `.env`, как остальные пробники.
load_dotenv(override=True)

from core.binance.futures import BinanceFutures  # noqa: E402
from core.binance.stream import BinancePrivateStream  # noqa: E402
from core.weex.futures import Credentials, WeexTradeError  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "DOGEUSDT"
OK = "  ок  "
NO = " нет  "

SETTLE = 3.0


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def testnet() -> bool:
    return os.getenv("BINANCE_TESTNET", "").strip().lower() in ("1", "true", "yes")


async def main() -> int:
    if os.getenv("BINANCE_TRADE_OK", "").lower() not in ("1", "true", "yes"):
        print(
            "Пробник ставит настоящие заявки"
            + (" на учебном контуре." if testnet() else " на БОЕВОМ счёте - это живые деньги.")
            + "\nЕсли готовы - задайте BINANCE_TRADE_OK=1."
        )
        return 1

    key = os.getenv("BINANCE_CHECK_KEY", "")
    secret = os.getenv("BINANCE_CHECK_SECRET", "")
    if not key or not secret:
        print("Нужны оба: BINANCE_CHECK_KEY и BINANCE_CHECK_SECRET")
        return 1
    if key == secret:
        # Частая ошибка при копировании из приложения: ключ есть, секрета нет.
        # Биржа ответит «Signature for this request is not valid», и причина
        # будет выглядеть как поломка подписи у нас.
        print("Ключ и секрет совпадают - это один и тот же ключ, вписанный дважды.")
        return 1

    keys = Credentials(key, secret, "")
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    client = BinanceFutures(keys, factory, testnet=testnet())
    woken: list[str] = []
    stream = BinancePrivateStream(
        keys, client.positions, on_orders=woken.append, testnet=testnet()
    )

    opened = False
    try:
        line(
            OK if testnet() else NO,
            "контур: учебный (demo-fapi)" if testnet() else "контур: БОЕВОЙ, это живые деньги",
        )

        balance = await client.balance()
        free = next((float(row.get("availableBalance") or 0) for row in balance), 0.0)
        line(OK if free > 0 else NO, f"свободно на счёте: {free} USDT")
        if free <= 0:
            print("\nБез денег на счёте заявку не поставить.")
            return 1

        mode = await client.position_mode()
        line(OK, f"режим позиций: {mode}")

        price = await client.last_price(SYMBOL)
        filters = await client.symbol_filters(SYMBOL)
        if not price:
            line(NO, "цена не получена")
            return 1

        # Пять долларов номинала - правило биржи, меньше она не примет.
        need = max(filters["min_qty"], 5.0 / price)
        step = filters["step"] or 1.0
        qty = round((int(need / step) + 1) * step, 8)
        notional = qty * price
        stop = round(price * 0.95, 6)
        take = round(price * 1.05, 6)
        print(f"\nрынок {price}, объём {qty} ({notional:.2f} USDT позиции), стоп {stop}, цель {take}")
        line(OK, f"предел плеча по паре: x{int(filters.get('max_leverage') or 0)}")

        stream.start()
        for _ in range(30):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        line(OK if stream.ready else NO, "приватный поток готов" if stream.ready else "поток не поднялся")

        # ── 1. вход по рынку с защитой ──────────────────────────────────────
        print("\n── вход по рынку: защита уходит следом, отдельными заявками ───")
        placed = await client.place_order(
            symbol=SYMBOL,
            side="BUY",
            position_side="LONG",
            quantity=str(qty),
            order_type="MARKET",
            sl_trigger=str(stop),
            tp_trigger=str(take),
            client_order_id=f"probe{int(price * 1000)}",
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
            + ("" if plans else " - защита не встала, а позиция открыта"),
        )
        for one in plans:
            print(
                f"      {one.get('orderId')} {one.get('planType')} "
                f"триггер={one.get('triggerPrice')} объём={one.get('quantity')}"
            )

        # ── 2. защита от сопровождения и перенос стопа ──────────────────────
        print("\n── защита сопровождением и перенос стопа ──────────────────────")
        try:
            ladder = await client.place_tp_sl(
                symbol=SYMBOL,
                plan_type="TAKE_PROFIT",
                trigger_price=str(round(price * 1.08, 6)),
                quantity=str(qty),
                position_side="LONG",
            )
            line(OK, f"цель принята: {ladder}")
        except WeexTradeError as exc:
            line(NO, f"цель не встала: {exc}")

        await asyncio.sleep(SETTLE)
        guard = next(
            (
                one
                for one in await client.algo_orders(SYMBOL)
                if "STOP" in str(one.get("planType") or "").upper()
            ),
            None,
        )
        if guard is None:
            line(NO, "стопа среди условных нет - переносить нечего")
        else:
            try:
                moved = await client.modify_tp_sl(
                    symbol=SYMBOL,
                    order_id=str(guard.get("orderId")),
                    trigger_price=str(round(price * 0.999, 6)),
                )
                line(OK, f"стоп перенесён в безубыток: {moved}")
            except WeexTradeError as exc:
                line(NO, f"перенос стопа не прошёл: {exc}")

        await asyncio.sleep(SETTLE)
        plans = await client.algo_orders(SYMBOL)
        line(OK, f"условных заявок всего: {len(plans)}")
        for one in plans:
            print(f"      {one.get('orderId')} {one.get('planType')} триггер={one.get('triggerPrice')}")

        # ── 3. что сказал поток ─────────────────────────────────────────────
        print("\n── приватный поток о сделке ───────────────────────────────────")
        line(
            OK if woken else NO,
            f"звонков сопровождению: {len(woken)}"
            + ("" if woken else " - события есть, а будильник молчит"),
        )
        live = stream.positions()
        line(OK if live else NO, f"позиций в потоке: {len(live)}")

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
            "биржа сняла защиту сама"
            if not left
            else f"защита осталась висеть: {len(left)} шт. - снимает сопровождение",
        )
        for one in left:
            print(f"      {one.get('orderId')} {one.get('planType')} триггер={one.get('triggerPrice')}")

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
