"""Реализация гибкого парсера сигнала.

Поддерживает форматы из ТЗ §7.2 — от минимального ``XLM LONG`` до полного с плечом, входом,
стопом, тейками, типом маржи и типом входа. Русские и английские ключевые слова, латинская ``x``
и кириллическая ``х`` в плече.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional


# Слова, которые не могут быть тикером.
_STOPWORDS = {
    "long", "short", "лонг", "шорт",
    "плечо", "leverage", "lev",
    "вход", "entry", "вх",
    "стоп", "sl", "стоплосс",
    "тп", "tp", "тейк", "take",
    "кросс", "cross", "изол", "изолированная", "isolated",
    "рынок", "market", "лимит", "limit", "по",
}

_DIRECTION_RE = re.compile(r"\b(long|short|лонг|шорт)\b", re.IGNORECASE)
_LEVERAGE_RE = re.compile(
    r"(?:плечо|leverage|lev)\s*[:=]?\s*(\d{1,3})"
    r"|(\d{1,3})\s*[xх]\b"
    r"|[xх]\s*(\d{1,3})\b",
    re.IGNORECASE,
)
_ENTRY_RE = re.compile(r"(?:вход|entry|вх)\s*[:=]?\s*([\d]+[.,]?[\d]*)", re.IGNORECASE)
_STOP_RE = re.compile(r"(?:стоп[\s-]*лосс|стоп|sl)\s*[:=]?\s*([\d]+[.,]?[\d]*)", re.IGNORECASE)
_TP_RE = re.compile(r"(?:тп|tp|тейк|take)\s*([1-3])?\s*[:=]?\s*([\d]+[.,]?[\d]*)", re.IGNORECASE)
_BARE_NUM_RE = re.compile(r"(?<![\w.])(\d+[.,]\d+)(?![\w])")
_TICKER_RE = re.compile(r"\b([A-Za-z]{2,15})\b")

_DIRECTION_MAP = {"long": "LONG", "лонг": "LONG", "short": "SHORT", "шорт": "SHORT"}


@dataclass
class ParsedSignal:
    symbol: Optional[str] = None
    direction: Optional[str] = None
    leverage: Optional[int] = None
    entry_price: Optional[Decimal] = None
    entry_type: str = "market"
    stop_loss: Optional[Decimal] = None
    take_profits: list = field(default_factory=list)  # [tp1, tp2, tp3] (Decimal)
    margin_type: str = "cross"
    found_fields: set = field(default_factory=set)
    errors: list = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        """Сигнал валиден, если есть обязательные пара и направление."""
        return self.symbol is not None and self.direction is not None and not self.errors


def _to_decimal(raw: str) -> Optional[Decimal]:
    try:
        return Decimal(raw.replace(",", "."))
    except (InvalidOperation, AttributeError):
        return None


def _normalize_symbol(token: str) -> str:
    sym = token.upper()
    # Уже полная пара (заканчивается на котируемую валюту) — оставляем.
    if sym.endswith(("USDT", "USDC", "USD")):
        return sym
    return sym + "USDT"


def parse_signal(text: str) -> ParsedSignal:
    """Разобрать текст сигнала в структуру ``ParsedSignal``.

    Возвращает результат даже при отсутствии обязательных полей — с заполненным ``errors``.
    """
    result = ParsedSignal()
    if not text or not text.strip():
        result.errors.append("Пустой сигнал.")
        return result

    # ── Направление ──
    m = _DIRECTION_RE.search(text)
    if m:
        result.direction = _DIRECTION_MAP[m.group(1).lower()]
        result.found_fields.add("direction")

    # ── Тикер: первый латинский токен, не являющийся ключевым словом ──
    for tok in _TICKER_RE.findall(text):
        if tok.lower() in _STOPWORDS:
            continue
        result.symbol = _normalize_symbol(tok)
        result.found_fields.add("symbol")
        break

    # ── Плечо ──
    m = _LEVERAGE_RE.search(text)
    if m:
        lev = next((g for g in m.groups() if g), None)
        if lev:
            result.leverage = int(lev)
            result.found_fields.add("leverage")

    # ── Вход (по ключевому слову) ──
    m = _ENTRY_RE.search(text)
    if m:
        val = _to_decimal(m.group(1))
        if val is not None:
            result.entry_price = val
            result.found_fields.add("entry_price")

    # ── Стоп ──
    m = _STOP_RE.search(text)
    if m:
        val = _to_decimal(m.group(1))
        if val is not None:
            result.stop_loss = val
            result.found_fields.add("stop_loss")

    # ── Тейки (с индексом и без) ──
    indexed: dict = {}
    sequential: list = []
    for idx, num in _TP_RE.findall(text):
        val = _to_decimal(num)
        if val is None:
            continue
        if idx:
            indexed[int(idx)] = val
        else:
            sequential.append(val)
    tps: list = [None, None, None]
    for i, val in indexed.items():
        if 1 <= i <= 3:
            tps[i - 1] = val
    seq_iter = iter(sequential)
    for i in range(3):
        if tps[i] is None:
            tps[i] = next(seq_iter, None)
    result.take_profits = [v for v in tps if v is not None]
    for i, v in enumerate(tps):
        if v is not None:
            result.found_fields.add(f"tp{i + 1}")

    # ── Тип маржи ──
    low = text.lower()
    if "изол" in low or "isolated" in low:
        result.margin_type = "isolated"
        result.found_fields.add("margin_type")
    elif "кросс" in low or "cross" in low:
        result.margin_type = "cross"
        result.found_fields.add("margin_type")

    # ── Тип входа ──
    if "лимит" in low or "limit" in low:
        result.entry_type = "limit"
        result.found_fields.add("entry_type")
    elif "по рынку" in low or "market" in low or "рынок" in low:
        result.entry_type = "market"
        result.found_fields.add("entry_type")

    # ── Голый одиночный номер как вход (если вход не указан явно) ──
    if result.entry_price is None and "entry_price" not in result.found_fields:
        # Убираем уже распознанные числа (стоп/тейки) из рассмотрения.
        used = set()
        if result.stop_loss is not None:
            used.add(result.stop_loss)
        used.update(result.take_profits)
        bare = [
            d for d in (_to_decimal(x) for x in _BARE_NUM_RE.findall(text))
            if d is not None and d not in used
        ]
        if len(bare) == 1:
            result.entry_price = bare[0]
            result.found_fields.add("entry_price")

    # ── Валидация обязательных полей ──
    if result.symbol is None:
        result.errors.append("Не найден тикер пары.")
    if result.direction is None:
        result.errors.append("Не найдено направление (LONG/SHORT).")

    return result
