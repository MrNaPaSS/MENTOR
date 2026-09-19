"""BNB Smart Chain: переводы USDT на адрес приёма.

Перенос рабочего наблюдателя из соседнего проекта (`E:\\Новый проэкт АДРЕСА`,
`apps/web/lib/server/payments.ts`) на Python. Шлюза и посредника нет:
плательщику показывают адрес и точную сумму, а мы читаем события `Transfer`
контракта USDT и находим свой платёж по сумме.

Три места, где ошибка стоит дня работы или денег:

1. **18 знаков, а не 6.** USDT в BSC - это не тот же USDT, что в Ethereum и
   TRON. Ошибка в `DECIMALS` разошлась бы в триллион раз.
2. **Узел `bsc-dataseed.binance.org` не умеет `eth_getLogs`** - отклоняет
   запрос целиком, и наблюдатель на нём не работает вовсе. Рабочий узел -
   `bsc-rpc.publicnode.com`, он отдаёт до 5000 блоков за запрос; мы просим
   2000 с запасом.
3. **Адрес приёма живёт в окружении**, не в коде: `NMNH_BSC_RECEIVER`.

Суммы здесь везде целые в минимальных единицах и наружу отдаются строкой:
49 USDT - это двадцатизначное число, и хранить его числом с плавающей точкой
нельзя (см. докстринг `core/models/subscription.py`).
"""

from __future__ import annotations

import logging
import os
import re
import secrets
from dataclasses import dataclass

from backend.sources import session

log = logging.getLogger("nmnh.payments")

NETWORK = "bep20"
# Название сети для человека. Пишется в счёте дважды: оплата не в ту сеть -
# самая частая потеря денег, и «USDT» без сети ни о чём не говорит.
NETWORK_LABEL = "BNB Smart Chain (BEP-20)"

USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"
# Проверено чтением `decimals()` у контракта. НЕ 6.
DECIMALS = 18
UNIT = 10**DECIMALS

DEFAULT_RPC = "https://bsc-rpc.publicnode.com"

# Блок в BSC раз в три секунды: 15 подтверждений - около сорока пяти секунд.
CONFIRMATIONS = 15
# Запас под лимит узла: реальный потолок 5000 блоков за запрос.
LOG_SPAN = 2000

# keccak256("Transfer(address,address,uint256)")
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


class RpcError(RuntimeError):
    """Узел не ответил или ответил ошибкой. Проход пропускается, курсор стоит."""


@dataclass(frozen=True)
class Transfer:
    """Один перевод USDT на адрес приёма."""

    tx_hash: str
    block: int
    # Отправитель. Чаще всего горячий кошелёк биржи, а не кошелёк человека.
    from_address: str
    # Сумма в минимальных единицах, строкой без ведущих нулей.
    amount_raw: str


def receiving_address() -> str:
    """Адрес приёма из окружения, в нижнем регистре.

    Нет адреса - нет приёма: молча принимать оплату «в никуда» хуже, чем
    остановиться на запуске.
    """
    value = (os.getenv("NMNH_BSC_RECEIVER") or "").strip()
    if not ADDRESS.match(value):
        raise RuntimeError("NMNH_BSC_RECEIVER не задан или не похож на адрес BSC")
    return value.lower()


def rpc_url() -> str:
    return (os.getenv("NMNH_BSC_RPC") or "").strip() or DEFAULT_RPC


def enabled() -> bool:
    """Настроен ли приём. Без адреса наблюдатель не запускается."""
    return bool(ADDRESS.match((os.getenv("NMNH_BSC_RECEIVER") or "").strip()))


def unique_amount(price_usd: float | int) -> str:
    """Цена с случайным хвостом меньше цента: 49 USDT -> 49.004173.

    Так плательщик опознаётся суммой, и адрес приёма остаётся один на всех.
    Хвост из `secrets`, а не из `random`: предсказуемость хвоста ничего
    серьёзного не даёт, но и повода брать слабый источник нет.
    """
    base = int(round(float(price_usd) * 10**6)) * 10 ** (DECIMALS - 6)
    tail = (secrets.randbelow(999_999) + 1) * 10 ** (DECIMALS - 12)
    return str(base + tail)


def format_usdt(amount_raw: str | int) -> str:
    """Сумма для человека: шесть знаков после запятой, как в счёте."""
    amount = int(amount_raw)
    whole, frac = divmod(amount, UNIT)
    return f"{whole}.{str(frac).zfill(DECIMALS)[:6]}"


def _topic_address(address: str) -> str:
    """Адрес как тема лога: 32 байта с ведущими нулями."""
    return "0x" + address[2:].lower().rjust(64, "0")


def _address_from_topic(topic: str) -> str:
    return "0x" + topic[-40:].lower()


async def _rpc(method: str, params: list) -> object:
    """Запрос к узлу. Любой сбой - `RpcError`, решает его вызывающий."""
    http = await session.get()
    try:
        async with http.post(
            rpc_url(),
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        ) as response:
            payload = await response.json(content_type=None)
    except Exception as exc:  # noqa: BLE001 - сеть, таймаут, разрыв
        raise RpcError(f"{method}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RpcError(f"{method}: неожиданный ответ узла")
    if payload.get("error"):
        raise RpcError(f"{method}: {payload['error']}")
    if "result" not in payload:
        raise RpcError(f"{method}: пустой ответ")
    return payload["result"]


async def head_block() -> int:
    """Последний блок сети."""
    result = await _rpc("eth_blockNumber", [])
    return int(str(result), 16)


async def safe_head() -> int:
    """Последний блок, который уже не переиграется: голова минус подтверждения."""
    return await head_block() - CONFIRMATIONS


async def fetch_transfers(from_block: int, to_block: int) -> tuple[Transfer, ...]:
    """Переводы USDT на адрес приёма в диапазоне блоков, включая оба края."""
    if to_block < from_block:
        return ()
    receiver = receiving_address()
    logs = await _rpc(
        "eth_getLogs",
        [
            {
                "address": USDT_CONTRACT,
                # Третья тема - получатель. Отправителя не фильтруем: платят с
                # бирж, и адрес отправителя человеку не принадлежит.
                "topics": [TRANSFER_TOPIC, None, _topic_address(receiver)],
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
            }
        ],
    )
    if not isinstance(logs, list):
        raise RpcError("eth_getLogs: ответ не список")
    return tuple(found for found in (_parse_log(one) for one in logs) if found is not None)


def _parse_log(entry: object) -> Transfer | None:
    """Разбор одного лога. Кривой лог пропускаем, а не роняем проход."""
    if not isinstance(entry, dict):
        return None
    topics = entry.get("topics") or []
    data = entry.get("data") or "0x"
    tx_hash = str(entry.get("transactionHash") or "")
    if len(topics) < 3 or not tx_hash:
        return None
    try:
        amount = int(str(data), 16)
        block = int(str(entry.get("blockNumber") or "0x0"), 16)
    except ValueError:
        log.warning("Непонятный лог перевода %s", tx_hash)
        return None
    return Transfer(
        tx_hash=tx_hash.lower(),
        block=block,
        from_address=_address_from_topic(str(topics[1])),
        amount_raw=str(amount),
    )
