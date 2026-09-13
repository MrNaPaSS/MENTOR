"""Биржи терминала: код и подпись.

Терминал будет мультибиржевым, и каждая сделка должна помнить, где она
открыта: по этому подписываются карточки итога («WEEX Futures» под печатью),
по этому же потом будут разводиться ключи и сопровождение.

Сейчас ключи у учеников только от WEEX (WeexCredential), и сделки, которые
ведёт сервер, идут там. Новая биржа - это новая строка здесь и код биржи у её
ключа; подпись карточки подтянется сама.
"""

from __future__ import annotations

# Код биржи -> подпись на карточке. Фьючерсы: терминал торгует ими.
TITLES: dict[str, str] = {
    "weex": "WEEX Futures",
    "binance": "Binance Futures",
    "okx": "OKX Futures",
    "bybit": "Bybit Futures",
    "bitget": "Bitget Futures",
}

# Биржа по умолчанию: сделки и ключи, записанные до мультибиржи, - с неё.
KEYS_EXCHANGE = "weex"

# Биржи, ключи которых ученик может подключить. Порядок - порядок в интерфейсе.
KEY_EXCHANGES: tuple[str, ...] = ("weex", "okx")


def title_of(code: str | None) -> str:
    """Подпись биржи. Неизвестная или пустая - пустая строка: без подписи."""
    return TITLES.get((code or "").strip().lower(), "")


def exchange_code(code: str | None) -> str:
    """Код биржи ключей. Пусто - биржа по умолчанию; незнакомая - пустая строка."""
    value = (code or "").strip().lower() or KEYS_EXCHANGE
    return value if value in KEY_EXCHANGES else ""
