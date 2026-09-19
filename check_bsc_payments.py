"""Приём USDT в BNB Smart Chain - живая проверка по настоящей сети.

Правило проекта: адаптер не готов, пока не прошёл по живой сети. Тесты на
записанных ответах узла ловят арифметику, но не ловят главного - что узел
отвечает, что фильтр логов составлен верно и что на адрес приёма вообще что-то
приходит.

Пробник ничего не начисляет и ничего не пишет в базу. Он читает сеть и
печатает то, что увидел бы наблюдатель:

    python check_bsc_payments.py              # последние 2000 блоков
    python check_bsc_payments.py --блоков 20000   # глубже назад
    python check_bsc_payments.py --счета      # и ожидающие счета из базы

Адрес приёма берётся из `NMNH_BSC_RECEIVER`, узел - из `NMNH_BSC_RPC`.
"""

from __future__ import annotations

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

from backend.payments import bsc  # noqa: E402
from backend.sources import session as http_session  # noqa: E402


def _arg(name: str, default: int) -> int:
    if name not in sys.argv:
        return default
    try:
        return int(sys.argv[sys.argv.index(name) + 1])
    except (IndexError, ValueError):
        return default


async def probe(depth: int) -> int:
    print(f"Узел:  {bsc.rpc_url()}")
    try:
        receiver = bsc.receiving_address()
    except RuntimeError as exc:
        print(f"Адрес приёма: {exc}")
        return 1
    print(f"Приём: {receiver}  ({bsc.NETWORK_LABEL})")

    try:
        head = await bsc.head_block()
    except bsc.RpcError as exc:
        print(f"Узел не ответил: {exc}")
        print("Напомню: bsc-dataseed.binance.org отклоняет eth_getLogs целиком.")
        return 1
    safe = head - bsc.CONFIRMATIONS
    print(f"Голова сети: {head}, с подтверждениями: {safe}")

    found = 0
    start = safe - depth
    # Узел отдаёт ограниченный диапазон за запрос - идём теми же кусками, что
    # и наблюдатель.
    while start < safe:
        finish = min(safe, start + bsc.LOG_SPAN)
        try:
            transfers = await bsc.fetch_transfers(start + 1, finish)
        except bsc.RpcError as exc:
            print(f"Сбой чтения блоков {start + 1}-{finish}: {exc}")
            return 1
        for transfer in transfers:
            found += 1
            print(
                f"  блок {transfer.block}  {bsc.format_usdt(transfer.amount_raw)} USDT"
                f"  от {transfer.from_address}  {transfer.tx_hash}"
            )
        start = finish

    print(f"Переводов за последние {depth} блоков: {found}")
    if not found:
        print("Пусто - это не ошибка: на адрес просто никто не переводил в этом окне.")
    return 0


def show_invoices() -> None:
    from sqlalchemy import select

    from core.db import SessionLocal, init_engine
    from core.models import PaymentIntent

    init_engine()
    with SessionLocal() as db:
        rows = db.scalars(
            select(PaymentIntent).order_by(PaymentIntent.created_at.desc()).limit(20)
        ).all()
    if not rows:
        print("Счетов в базе нет.")
        return
    print("\nПоследние счета:")
    for row in rows:
        print(
            f"  {row.status:<9} {bsc.format_usdt(row.amount_raw):>14} USDT"
            f"  {row.plan:<8} до {row.expires_at}"
        )


async def main() -> int:
    code = await probe(_arg("--блоков", _arg("--blocks", bsc.LOG_SPAN)))
    await http_session.close()
    if "--счета" in sys.argv or "--invoices" in sys.argv:
        show_invoices()
    return code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
