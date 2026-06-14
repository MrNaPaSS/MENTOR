"""Рендер сообщения сигнала из результата калькулятора (ТЗ §9.1–9.3)."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from core.calculator import CalcResult, Mode


def fmt_money(value: Decimal, decimals: int = 1) -> str:
    """Денежная сумма с разделителями тысяч: 1260 → '1,260', 18.9 → '18.9'."""
    q = Decimal(10) ** -decimals
    v = Decimal(value).quantize(q, rounding=ROUND_HALF_UP)
    sign = "-" if v < 0 else ""
    v = abs(v)
    int_part, _, frac = f"{v:f}".partition(".")
    int_fmt = f"{int(int_part):,}"
    if decimals > 0 and frac:
        frac = frac.rstrip("0")
        return f"{sign}{int_fmt}.{frac}" if frac else f"{sign}{int_fmt}"
    return f"{sign}{int_fmt}"


def fmt_price(value: Decimal) -> str:
    """Цена с разумной точностью (мелкие — больше знаков)."""
    v = Decimal(value)
    av = abs(v)
    if av == 0:
        return "0"
    if av >= 100:
        q = Decimal("0.01")
    elif av >= 1:
        q = Decimal("0.0001")
    else:
        q = Decimal("0.00000001")
    s = f"{v.quantize(q):f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def weex_trade_url(symbol: str, lang: str = "ru") -> str:
    """Ссылка кнопки «Войти в сделку» (ТЗ §9.3)."""
    seg = "ru" if lang == "ru" else "en"
    return f"https://www.weex.com/{seg}/futures/{symbol}"


_L = {
    "ru": {
        "moderate": "Умеренный",
        "turbo": "ТУРБО",
        "entry": "Вход",
        "market": "по рынку",
        "limit": "лимит",
        "stop": "Стоп",
        "calc": "Твой расчёт (депо {bal} USDT)",
        "margin": "Маржа",
        "position": "Объём позиции",
        "risk": "Риск",
        "of_margin": "от маржи",
        "goals": "Цели",
        "to_margin": "к марже",
        "footer": "⚡ No Money No Honey",
        "enter": "🚀 Войти в сделку",
    },
    "en": {
        "moderate": "Moderate",
        "turbo": "TURBO",
        "entry": "Entry",
        "market": "market",
        "limit": "limit",
        "stop": "Stop",
        "calc": "Your setup (deposit {bal} USDT)",
        "margin": "Margin",
        "position": "Position size",
        "risk": "Risk",
        "of_margin": "of margin",
        "goals": "Targets",
        "to_margin": "to margin",
        "footer": "⚡ No Money No Honey",
        "enter": "🚀 Enter trade",
    },
}


def render_signal(
    calc: CalcResult,
    symbol: str,
    entry_type: str = "market",
    lang: str = "ru",
) -> str:
    """Собрать текст сообщения ученику по расчёту.

    Возвращает текст без кнопки (кнопку добавляет слой доставки через ``weex_trade_url``).
    """
    lang = lang if lang in _L else "ru"
    t = _L[lang]
    icon = "📊" if calc.mode == Mode.MODERATE else "⚡"
    mode_name = t["moderate"] if calc.mode == Mode.MODERATE else t["turbo"]

    entry_word = t["market"] if entry_type == "market" else t["limit"]
    sl_dist = calc.sl_percent
    sl_sign = "-"  # дистанция стопа всегда «вниз по убытку»

    lines = []
    lines.append(f"{icon} {symbol} | {calc.direction.value} | x{calc.leverage} | {mode_name}")
    lines.append("")
    lines.append(f"{t['entry']}: {entry_word} (~{fmt_price(calc.entry_price)}$)")
    lines.append(f"{t['stop']}: {fmt_price(calc.sl_price)}$ ({sl_sign}{fmt_money(sl_dist, 2)}%)")
    lines.append("")

    bal = fmt_money(calc.balance, 0)
    risk_of_margin = (calc.risk_usd / calc.margin_usd * 100) if calc.margin_usd else Decimal(0)
    icon2 = "📈" if calc.mode == Mode.MODERATE else "🚀"
    lines.append(f"{icon2} {t['calc'].format(bal=bal)}:")
    lines.append(f"• {t['margin']}: {fmt_money(calc.margin_usd)}$")
    lines.append(f"• {t['position']}: {fmt_money(calc.position_size)}$")
    lines.append(
        f"• {t['risk']}: {fmt_money(calc.risk_usd)}$ "
        f"(-{fmt_money(risk_of_margin, 1)}% {t['of_margin']})"
    )
    lines.append("")
    lines.append(f"🎯 {t['goals']}:")
    for tp in calc.take_profits:
        pct_to_margin = (tp.profit_usd / calc.margin_usd * 100) if calc.margin_usd else Decimal(0)
        lines.append(
            f"TP{tp.index}: {fmt_price(tp.price)}$ → +{fmt_money(tp.profit_usd)}$ "
            f"(+{fmt_money(pct_to_margin, 0)}% {t['to_margin']})"
        )

    if calc.warnings:
        lines.append("")
        for w in calc.warnings:
            lines.append(w)

    lines.append("")
    lines.append(t["footer"])
    return "\n".join(lines)
