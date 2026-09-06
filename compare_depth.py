"""Сравнение глубины стакана: Binance против WEEX.

Терминал рисует стакан по данным Binance, а торгует на WEEX. Вопрос,
насколько это честно, сводится к одному: столько же ликвидности стоит в
одинаковом коридоре цен у обеих бирж или порядки разные.

Считаем не «сколько строк вернул сервер» — у бирж разная нарезка и разные
лимиты, — а деньги: сумму цена×объём в коридорах ±0.05%, ±0.1%, ±0.25%,
±0.5% и ±1% от середины рынка. Это единственная величина, которую можно
сравнивать напрямую.

Несколько снимков подряд, потому что один снимок — это не измерение:
крупная заявка приходит и уходит за секунды.

Запуск:  python compare_depth.py  [BTCUSDT ETHUSDT ...]
"""

from __future__ import annotations

import json
import ssl
import sys
import time
import urllib.error
import urllib.request

BINANCE = "https://fapi.binance.com/fapi/v1/depth"
WEEX = "https://api-contract.weex.com/capi/v3/market/depth"

# WEEX принимает не любой limit: 15 — короткий стакан, 200 — глубокий.
WEEX_LIMIT = 200
BINANCE_LIMIT = 1000

BANDS = (0.0005, 0.001, 0.0025, 0.005, 0.01)
SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
SAMPLES = 4
PAUSE = 1.5

_ctx = ssl.create_default_context()


def fetch(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=20, context=_ctx) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, ValueError, TimeoutError) as exc:
        print(f"  ! {url.split('//')[1][:40]}: {exc}")
        return None


def levels(book: dict, side: str) -> list[tuple[float, float]]:
    """Стакан в виде пар (цена, объём в монете)."""
    out = []
    for row in book.get(side, []):
        try:
            out.append((float(row[0]), float(row[1])))
        except (TypeError, ValueError, IndexError):
            continue
    return out


def notional(rows: list[tuple[float, float]], low: float, high: float) -> float:
    """Деньги, стоящие в коридоре цен: сумма цена×объём."""
    return sum(p * q for p, q in rows if low <= p <= high)


def snapshot(symbol: str) -> dict | None:
    """Один одновременный снимок обеих бирж."""
    b = fetch(f"{BINANCE}?symbol={symbol}&limit={BINANCE_LIMIT}")
    w = fetch(f"{WEEX}?symbol={symbol}&limit={WEEX_LIMIT}")
    if not b or not w:
        return None

    books = {}
    for name, raw in (("binance", b), ("weex", w)):
        bids, asks = levels(raw, "bids"), levels(raw, "asks")
        if not bids or not asks:
            return None
        books[name] = {
            "bids": sorted(bids, key=lambda r: -r[0]),
            "asks": sorted(asks, key=lambda r: r[0]),
        }

    # Середина рынка берётся по Binance: это опорная биржа терминала, и
    # считать коридоры от разных середин значит сравнивать разные коридоры.
    mid = (books["binance"]["bids"][0][0] + books["binance"]["asks"][0][0]) / 2

    weex_mid = (books["weex"]["bids"][0][0] + books["weex"]["asks"][0][0]) / 2
    result = {"mid": mid, "gap": weex_mid - mid}
    for name, book in books.items():
        best_bid, best_ask = book["bids"][0], book["asks"][0]
        result[name] = {
            "spread": best_ask[0] - best_bid[0],
            "best_bid_usd": best_bid[0] * best_bid[1],
            "best_ask_usd": best_ask[0] * best_ask[1],
            "levels": len(book["bids"]) + len(book["asks"]),
            "reach": (best_bid[0] - book["bids"][-1][0]) / mid,
            "bands": [
                notional(book["bids"], mid * (1 - band), mid)
                + notional(book["asks"], mid, mid * (1 + band))
                for band in BANDS
            ],
        }
    return result


def money(value: float) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return f"{value:.0f}"


def average(samples: list[dict], name: str, key: str) -> float:
    return sum(s[name][key] for s in samples) / len(samples)


def report(symbol: str, samples: list[dict]) -> None:
    mid = sum(s["mid"] for s in samples) / len(samples)
    print(f"\n=== {symbol} · середина рынка {mid:,.2f} · снимков {len(samples)} ===")

    print(
        f"  {'':22} {'Binance':>12} {'WEEX':>12} {'WEEX/Binance':>14}"
    )
    rows = [
        ("спред, $", "spread", lambda v: f"{v:.2f}"),
        ("лучший бид, $", "best_bid_usd", money),
        ("лучший аск, $", "best_ask_usd", money),
        ("уровней в ответе", "levels", lambda v: f"{v:.0f}"),
    ]
    for label, key, fmt in rows:
        b = average(samples, "binance", key)
        w = average(samples, "weex", key)
        ratio = f"{w / b:.2f}×" if b else "—"
        print(f"  {label:22} {fmt(b):>12} {fmt(w):>12} {ratio:>14}")

    reach_b = average(samples, "binance", "reach") * 100
    reach_w = average(samples, "weex", "reach") * 100
    print(f"  {'глубина ответа, %':22} {reach_b:>11.2f}% {reach_w:>11.2f}%")

    gap = sum(x["gap"] for x in samples) / len(samples)
    print(f"  {'цена WEEX минус Binance':22} {gap:>+11.2f}$ {gap / mid * 100:>+11.3f}%")

    print(f"\n  Деньги в коридоре вокруг середины (бид+аск):")
    for i, band in enumerate(BANDS):
        b = sum(s["binance"]["bands"][i] for s in samples) / len(samples)
        w = sum(s["weex"]["bands"][i] for s in samples) / len(samples)
        ratio = f"{w / b * 100:.0f}%" if b else "—"
        print(f"  ±{band * 100:>5.2f}% {'':10} {money(b):>12} {money(w):>12} {ratio:>14}")


def main() -> int:
    symbols = tuple(a.upper() for a in sys.argv[1:]) or SYMBOLS
    print(
        "Стакан Binance Futures против WEEX Futures.\n"
        "Объёмы приведены к деньгам (цена×объём), коридоры одинаковые для обеих бирж."
    )

    for symbol in symbols:
        samples = []
        for i in range(SAMPLES):
            shot = snapshot(symbol)
            if shot:
                samples.append(shot)
            if i + 1 < SAMPLES:
                time.sleep(PAUSE)
        if not samples:
            print(f"\n=== {symbol}: данных нет ===")
            continue
        report(symbol, samples)

    print(
        "\nОбъёмы WEEX считаны как объём в монете — так их отдаёт /capi/v3/market/depth.\n"
        "Если у инструмента контракт не равен монете, доли по нему смотреть нельзя."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
