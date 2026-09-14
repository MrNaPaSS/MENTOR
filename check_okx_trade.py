"""Проход сделкой по OKX: то, чего не видно ни в тестах, ни в обычном пробнике.

Отвечает на вопросы, которые документация не закрывает, а чек-лист
`check_okx.py` оставляет «проверить руками»:

1. встаёт ли защита, приложенная ко входу, и какими заявками она встаёт;
2. **ставится ли она при неполном исполнении** - OKX прикладывает стоп только
   после ПОЛНОГО исполнения лимитки, и это то место, где сопровождение обязано
   поставить стоп само (`watcher._ensure_stop`);
3. принимает ли биржа защиту от сопровождения и её перенос в безубыток;
4. снимает ли биржа защиту после закрытия позиции (`cxlOnClosePos`);
5. как ведёт себя односторонний режим (`net_mode`): закрытие обязано быть
   сокращающим, а сторона позиции в заявке не указывается.

Учебный контур у OKX есть, но ключи к нему **отдельные**: с боевым ключом он не
работает. Поэтому пробник рассчитан на оба случая и по умолчанию не ставит
ничего - запуск требует явного согласия:

    set OKX_CHECK_KEY=...
    set OKX_CHECK_SECRET=...
    set OKX_CHECK_PASSPHRASE=...
    set OKX_DEMO=1            # если ключи от демо-счёта
    set OKX_TRADE_OK=1
    python check_okx_trade.py [DOGEUSDT]

Монета по умолчанию - DOGE: у неё самый дешёвый контракт из ликвидных, меньше
доллара позиции. У BTC контракт равен 0.01 монеты, то есть около восьмисот
долларов, и проверять на нём дорого.

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

from core.okx.futures import OkxFutures, load_instruments  # noqa: E402
from core.okx.stream import OkxPrivateStream  # noqa: E402
from core.weex.futures import Credentials, WeexTradeError  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

SYMBOL = sys.argv[1] if len(sys.argv) > 1 else "DOGEUSDT"
OK = "  ок  "
NO = " нет  "

# Сколько ждём биржу после заявки: позиция и условные появляются в её выдаче не
# в тот же миг.
SETTLE = 3.0


def line(mark: str, text: str) -> None:
    print(f"[{mark}] {text}")


def demo() -> bool:
    return os.getenv("OKX_DEMO", "").strip().lower() in ("1", "true", "yes")


async def main() -> int:
    if os.getenv("OKX_TRADE_OK", "").lower() not in ("1", "true", "yes"):
        print(
            "Пробник ставит настоящие заявки"
            + (" на демо-счёте." if demo() else " на БОЕВОМ счёте - это живые деньги.")
            + "\nЕсли готовы - задайте OKX_TRADE_OK=1."
        )
        return 1

    key = os.getenv("OKX_CHECK_KEY", "")
    secret = os.getenv("OKX_CHECK_SECRET", "")
    phrase = os.getenv("OKX_CHECK_PASSPHRASE", "")
    if not key or not secret or not phrase:
        print("Нужны все три: OKX_CHECK_KEY, OKX_CHECK_SECRET, OKX_CHECK_PASSPHRASE")
        return 1

    keys = Credentials(key, secret, phrase)
    session = aiohttp.ClientSession()

    async def factory() -> aiohttp.ClientSession:
        return session

    client = OkxFutures(keys, factory, demo=demo())
    woken: list[str] = []

    # Поток OKX просит не снимок позиций, а справочник инструментов: позиции он
    # собирает сам из канала, а размер контракта нужен, чтобы перевести их в
    # монеты. Так же его кормит и боевой код (`backend/trading/private_ws.py`).
    async def specs() -> dict:
        return await load_instruments(session)

    stream = OkxPrivateStream(keys, specs, on_orders=woken.append, demo=demo())

    opened = False
    pending = ""
    try:
        line(OK if demo() else NO, "контур: учебный" if demo() else "контур: БОЕВОЙ, это живые деньги")

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

        qty = filters["min_qty"]
        notional = qty * price
        stop = round(price * 0.95, 6)
        take = round(price * 1.05, 6)
        print(f"\nрынок {price}, объём {qty} ({notional:.2f} USDT позиции), стоп {stop}, цель {take}")
        if notional > free * 5:
            line(NO, "минимальная позиция велика для этого счёта - возьмите монету дешевле")
            return 1

        stream.start()
        for _ in range(30):
            await asyncio.sleep(0.5)
            if stream.ready:
                break
        line(OK if stream.ready else NO, "приватный поток готов" if stream.ready else "поток не поднялся")

        # ── 1. лимитка далеко от рынка: защита ждёт полного исполнения ──────
        print("\n── лимитка с защитой: встаёт ли стоп до исполнения ────────────")
        far = round(price * 0.90, 6)
        try:
            waiting = await client.place_order(
                symbol=SYMBOL,
                side="BUY",
                position_side="LONG",
                quantity=str(qty),
                order_type="LIMIT",
                price=str(far),
                sl_trigger=str(round(far * 0.95, 6)),
                tp_trigger=str(round(far * 1.05, 6)),
            )
            pending = str(waiting.get("orderId") or "")
            line(OK, f"лимитка принята: {waiting}")
            await asyncio.sleep(SETTLE)
            plans = await client.algo_orders(SYMBOL)
            line(
                OK,
                f"условных заявок при неисполненной лимитке: {len(plans)}"
                + (" - защита ждёт исполнения, как и сказано в документации" if not plans else ""),
            )
        except WeexTradeError as exc:
            line(NO, f"лимитка не встала: {exc}")
        finally:
            if pending:
                try:
                    await client.cancel_order(SYMBOL, pending)
                    line(OK, "лимитка снята")
                    pending = ""
                except WeexTradeError as exc:
                    line(NO, f"лимитку не снять: {exc}")

        # ── 2. вход по рынку с приложенной защитой ──────────────────────────
        print("\n── вход по рынку с приложенными стопом и целью ─────────────────")
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
            + ("" if plans else " - приложенная защита не встала"),
        )
        for one in plans:
            print(
                f"      {one.get('orderId')} {one.get('planType')} "
                f"триггер={one.get('triggerPrice')} объём={one.get('quantity')}"
            )

        # ── 3. защита от сопровождения и перенос стопа ──────────────────────
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
                if str(one.get("planType") or "").upper() in ("STOP_LOSS", "STOP", "LOSS")
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

        # ── 4. что сказал поток ─────────────────────────────────────────────
        print("\n── приватный поток о сделке ───────────────────────────────────")
        line(
            OK if woken else NO,
            f"звонков сопровождению: {len(woken)}"
            + ("" if woken else " - события есть, а будильник молчит"),
        )
        live = stream.positions()
        line(OK if live else NO, f"позиций в потоке: {len(live)}")

        # ── 5. закрытие и уборка ────────────────────────────────────────────
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
        # Убираем за собой в любом случае: на боевом счёте висящая позиция
        # стоит денег, а висящая защита сработает не вовремя.
        try:
            if pending:
                await client.cancel_order(SYMBOL, pending)
                print("лимитка снята при уборке")
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
