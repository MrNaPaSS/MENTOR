"""Как разговор с сайта выглядит в форуме.

Telegram принимает узкое подмножество HTML, и весь смысл этого модуля в том,
чтобы собрать из сообщения чата ровно такую разметку - и ни знаком больше.

Отдельно от доставки намеренно. Доставка знает про сеть, очередь и частоту, а
здесь только текст; проверять оформление карточки, поднимая сеть, не нужно.
"""

from __future__ import annotations

import html
import json
from typing import Any

# Что написать вместо текста, когда его нет, а ссылка есть. Слово короткое:
# оно занимает место подписи, а не сообщения.
LINK_LABEL = "график"

def esc(value: Any) -> str:
    """Обезвредить чужой текст перед разметкой."""
    return html.escape(str(value), quote=False)


def link_ranges(links_json: str) -> list[dict]:
    """Отрезки со ссылками из строки JSON. Битую строку считаем пустой."""
    if not links_json:
        return []
    try:
        rows = json.loads(links_json)
    except ValueError:
        return []
    if not isinstance(rows, list):
        return []

    clean = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url", ""))
        if not url.lower().startswith(("http://", "https://")):
            continue
        try:
            offset = int(row.get("offset", 0))
            length = int(row.get("length", 0))
        except (TypeError, ValueError):
            continue
        if offset < 0 or length <= 0:
            continue
        clean.append({"offset": offset, "length": length, "url": url})
    return sorted(clean, key=lambda r: r["offset"])


def text_html(text: str, links: list[dict]) -> str:
    """Текст, в котором отрезки стали ссылками.

    Отрезки Telegram считает по знакам, а не по байтам, - так же считает и
    Python, поэтому резать можно прямо срезами.

    Наложившиеся отрезки пропускаем: ссылка внутри ссылки в разметке невозможна,
    и попытка её собрать даёт сломанный HTML, на котором Telegram отказывает
    всему сообщению целиком.
    """
    if not text:
        return ""
    if not links:
        return esc(text)

    out: list[str] = []
    at = 0
    for row in links:
        start, end = row["offset"], row["offset"] + row["length"]
        if start < at or start >= len(text):
            continue
        end = min(end, len(text))
        out.append(esc(text[at:start]))
        label = esc(text[start:end]) or LINK_LABEL
        out.append(f'<a href="{html.escape(row["url"], quote=True)}">{label}</a>')
        at = end
    out.append(esc(text[at:]))
    return "".join(out)


# ── Карточка сделки ──
#
# Та же, что в чате: направление, плечо, состояние, результат и цифры входа.
# Цифры идут моноширинным блоком - иначе колонки разъезжаются, и карточка
# перестаёт читаться с одного взгляда.


def trade_html(trade: dict, url: str = "") -> str:
    """Сделка или заявка так, как она выглядит в форуме.

    ``url`` - выложенная карточка. Если он есть, первая строка становится
    спрятанной ссылкой на неё: «BTC · SHORT · ×100» нажимается и открывает
    заверенный печатью бланк, а сообщение остаётся коротким.
    """
    symbol = esc(str(trade.get("symbol", "")).upper().replace("USDT", "") or "?")
    side = "SHORT" if str(trade.get("side", "")).lower() == "short" else "LONG"
    state = str(trade.get("state", ""))

    try:
        leverage = max(1, int(trade.get("leverage") or 1))
    except (TypeError, ValueError):
        leverage = 1

    mark = "\U0001f534" if side == "SHORT" else "\U0001f7e2"
    if state == "planned":
        mark, note = "\u23f3", "ждёт входа"
    elif state == "open":
        note = "в рынке"
    else:
        note = "закрыта"

    head = f"<b>{symbol}</b> · {side} · ×{leverage} · {note}"
    if url.lower().startswith(("http://", "https://")):
        head = f'<a href="{html.escape(url, quote=True)}">{head}</a>'
    lines = [f"{mark} {head}"]

    # Результат показываем только там, где он есть. У ждущей заявки его нет, и
    # нуль на её месте обещал бы итог, которого не было.
    pnl = trade.get("pnl")
    if state != "planned" and isinstance(pnl, (int, float)):
        margin = trade.get("margin")
        share = ""
        if isinstance(margin, (int, float)) and margin:
            share = f" · {pnl / margin * 100:+.1f} % от маржи"
        lines.append("")
        lines.append(f"<b>{pnl:+.2f} $</b>{share}")

    return "\n".join(lines)


def message_html(author: str, text: str, links: list[dict], attach: dict | None) -> str:
    """Сообщение чата целиком: кто написал, что написал и что приложил.

    Имя отдельной строкой, потому что писать будет бот. От имени человека
    Telegram отправлять не даёт, и подпись - единственный способ не превратить
    разговор нескольких людей в монолог бота.
    """
    head = f"<b>{esc(author)}</b>"
    body = text_html(text, links)

    kind = str((attach or {}).get("kind", ""))
    if kind == "trade" and isinstance(attach.get("trade"), dict):
        card = trade_html(attach["trade"], str(attach.get("url", "")))
        return f"{head}\n{body}\n\n{card}" if body else f"{head}\n\n{card}"

    if kind == "shot":
        # Снимок уходит спрятанной ссылкой: подписью служит сам текст
        # сообщения, а если его нет - короткое слово. Так «BTC 1m» остаётся
        # «BTC 1m», а не превращается в простыню из адреса.
        url = str(attach.get("url", ""))
        if url.lower().startswith(("http://", "https://")) and not links:
            label = esc(text) or LINK_LABEL
            href = html.escape(url, quote=True)
            return f'{head}\n<a href="{href}">{label}</a>'

    return f"{head}\n{body}" if body else head
