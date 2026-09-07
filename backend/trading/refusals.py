"""Отказы биржи человеческими словами.

Биржа отвечает по-английски и служебно: «FAILED_PRECONDITION: If order is
filled, may lead to position exceed max size 53.82 for leverage '100'». Трейдер
в этот момент смотрит на график и хочет знать одно - что ему сделать. Разбирать
код ошибки посреди сделки он не должен.

Числа из ответа сохраняем: они и есть ответ. Незнакомый отказ отдаём как есть -
выдумывать объяснение тому, чего мы не поняли, хуже, чем показать оригинал.
"""

from __future__ import annotations

import re

# Предел размера позиции на выбранном плече. У биржи он свой на каждую ступень
# плеча: чем выше плечо, тем меньше позволенная позиция.
_MAX_SIZE = re.compile(
    r"exceed\s+max\s+size\s+([\d.]+).*?leverage\s*'?(\d+)'?",
    re.IGNORECASE | re.DOTALL,
)

# Сокращающий ордер на позицию, где весь объём уже зарезервирован защитой.
_REDUCE_ONLY = re.compile(r"reduce[\s_-]?only", re.IGNORECASE)

# Объём не кратен шагу лота.
_STEP = re.compile(r"step\s*size|must\s+match\s+step", re.IGNORECASE)

# Цена не кратна шагу цены.
_TICK = re.compile(r"tick\s*size|price\s+precision", re.IGNORECASE)

_FUNDS = re.compile(r"insufficient|not\s+enough\s+(balance|margin)", re.IGNORECASE)

_LEVERAGE = re.compile(r"leverage.*(not\s+support|invalid|exceed)", re.IGNORECASE)


def explain(message: str) -> str:
    """Отказ биржи одной понятной фразой. Незнакомый - без изменений."""
    text = (message or "").strip()
    if not text:
        return "Биржа отказала без объяснения"

    found = _MAX_SIZE.search(text)
    if found:
        size, leverage = found.group(1), found.group(2)
        return (
            f"На плече ×{leverage} биржа держит позицию не больше {size}. "
            "Уменьшите сумму или плечо - либо снимите лишние заявки по этой монете: "
            "предел считается по всем сразу, а не по одной."
        )

    if _REDUCE_ONLY.search(text):
        return (
            "Биржа не принимает сокращающий ордер: весь объём позиции уже "
            "зарезервирован под стоп и цели. Снимите лишнюю защиту и повторите."
        )

    if _FUNDS.search(text):
        return "На счёте не хватает средств под эту сумму с этим плечом"

    if _STEP.search(text):
        return "Объём не кратен шагу лота этой монеты - измените сумму"

    if _TICK.search(text):
        return "Цена не кратна шагу цены этой монеты"

    if _LEVERAGE.search(text):
        return "Биржа не даёт такое плечо на этой монете - выберите меньше"

    return f"Биржа: {text}"
