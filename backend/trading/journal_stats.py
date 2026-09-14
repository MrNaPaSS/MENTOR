"""Сводка по журналу терминала: винрейт, профит-фактор, разрезы по дням и биржам.

Считается на месте по выбранным сделкам, а не хранится отдельной таблицей: за
месяц их сотни, а лишняя таблица итогов - это ещё одно место, где данные
расходятся с журналом.

Формулы повторяют те, по которым живёт раздел аналитики кабинета
(`webapp/lib/analytics/advanced.ts`). Это не случайное совпадение, а
требование: один и тот же человек видит свои цифры и в кабинете, и в академии,
и разный винрейт на двух экранах читается как сломанные данные.

Модуль ничего не знает про базу и про запросы - на вход идёт готовый список
сделок. Так его считают и с выборки за месяц, и с выборки за год, и в тестах
без базы вовсе.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from backend.trading.funds import trade_volume
from core.exchanges import KEYS_EXCHANGE

# Сколько последних сделок показываем списком. Раздел академии - витрина, а не
# журнал: там нужно «что было только что», а вся история живёт в кабинете.
DEFAULT_LAST = 10

MINUTE = 60.0


def _f(value: Any) -> float:
    """Число из базы. `Numeric` приезжает `Decimal`, а наружу нужен float."""
    return float(value or 0)


def _at(value: datetime | None) -> datetime | None:
    """Время с зоной. SQLite хранит дату строкой и пояс теряет.

    Наивную дату считали бы по местному времени сервера, и день в календаре
    уезжал бы на разницу поясов.
    """
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def exchange_of(trade: Any) -> str:
    """Биржа записи.

    У сделок, записанных сопровождением до появления поля, биржа - та, чьи
    ключи тогда подключали: других в терминале не было. У записей с экрана
    биржи может не быть вовсе - это торговля по стакану без счёта.
    """
    return (getattr(trade, "exchange", "") or "").strip().lower() or (
        KEYS_EXCHANGE if getattr(trade, "from_exchange", False) else ""
    )


def risk(trade: Any) -> float:
    """Риск сделки: расстояние до стопа, взятое объёмом."""
    distance = abs(_f(trade.entry) - _f(trade.stop))
    value = distance * _f(trade.qty)
    return value if value > 0 else 0.0


def r_multiple(trade: Any) -> float | None:
    """Результат сделки в риске. `None` - риск неизвестен, стоп не проставлен."""
    base = risk(trade)
    return _f(trade.pnl) / base if base > 0 else None


def volume(trade: Any) -> float:
    """Оборот сделки: вход и выход вместе - с них берут комиссию."""
    return trade_volume(_f(trade.qty), _f(trade.entry), _f(trade.exit_price) or None)


def hold_minutes(trade: Any) -> float | None:
    """Сколько минут сделка жила. `None` - время открытия не записано."""
    start, end = _at(trade.opened_at), _at(trade.closed_at)
    if start is None or end is None or end < start:
        return None
    return (end - start).total_seconds() / MINUTE


def drawdown(trades: Sequence[Any]) -> tuple[float, float]:
    """Худшее падение накопленного итога и его доля от пика.

    Доля считается от пика, а не от итога: просадка в сто долларов после
    тысячи заработанных и после ста - разные вещи. Пик ниже нуля доли не даёт:
    делить на отрицательное бессмысленно.
    """
    running = peak = worst = worst_pct = 0.0
    for trade in sorted(trades, key=lambda t: _at(t.closed_at) or datetime.min.replace(tzinfo=timezone.utc)):
        running += _f(trade.pnl)
        peak = max(peak, running)
        fall = peak - running
        if fall > worst:
            worst = fall
            worst_pct = fall / peak if peak > 0 else 0.0
    return worst, worst_pct


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def summarize(trades: Sequence[Any]) -> dict[str, Any]:
    """Плитки раздела: всё, что о наборе сделок стоит знать одним числом."""
    wins = [t for t in trades if _f(t.pnl) > 0]
    losses = [t for t in trades if _f(t.pnl) < 0]
    flat = len(trades) - len(wins) - len(losses)

    gross = sum(_f(t.pnl) for t in wins)
    drawn = abs(sum(_f(t.pnl) for t in losses))
    net = sum(_f(t.pnl) for t in trades)
    # Винрейт - от решённых сделок: выход в ноль не победа и не поражение, и в
    # знаменателе он занижал бы обе доли сразу.
    decided = len(wins) + len(losses)

    rs = [r for r in (r_multiple(t) for t in trades) if r is not None]
    held = [m for m in (hold_minutes(t) for t in trades) if m is not None]
    fall, fall_pct = drawdown(trades)

    return {
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "flat": flat,
        "win_rate": round(len(wins) / decided, 6) if decided else 0.0,
        "gross": round(gross, 8),
        "drawn": round(drawn, 8),
        "net": round(net, 8),
        "fees": round(sum(_f(t.fee) for t in trades), 8),
        # Без убытков делить не на что, и выдумывать число нельзя: ноль тут
        # означал бы «плохо», а бесконечность не переживёт JSON.
        "profit_factor": round(gross / drawn, 6) if drawn > 0 else None,
        "avg_win": round(gross / len(wins), 8) if wins else 0.0,
        "avg_loss": round(drawn / len(losses), 8) if losses else 0.0,
        "expectancy": round(net / len(trades), 8) if trades else 0.0,
        "best": round(max((_f(t.pnl) for t in trades), default=0.0), 8),
        "worst": round(min((_f(t.pnl) for t in trades), default=0.0), 8),
        "volume": round(sum(volume(t) for t in trades), 2),
        "avg_r": round(_mean(rs), 4) if rs else None,
        "drawdown": round(fall, 8),
        "drawdown_pct": round(fall_pct, 6),
        "hold_minutes": round(_mean(held), 2) if held else None,
    }


def _cell(key_name: str, key: str) -> dict[str, Any]:
    return {key_name: key, "trades": 0, "wins": 0, "losses": 0, "pnl": 0.0, "volume": 0.0}


def _fill(cell: dict[str, Any], trade: Any) -> None:
    pnl = _f(trade.pnl)
    cell["trades"] += 1
    cell["pnl"] += pnl
    cell["volume"] += volume(trade)
    if pnl > 0:
        cell["wins"] += 1
    elif pnl < 0:
        cell["losses"] += 1


def _rounded(cells: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for cell in cells:
        cell["pnl"] = round(cell["pnl"], 8)
        cell["volume"] = round(cell["volume"], 2)
        out.append(cell)
    return out


def by_day(trades: Sequence[Any]) -> list[dict[str, Any]]:
    """Итог по дням, по UTC.

    День берётся тот же, что в календаре прибыли кабинета. Если академия рисует
    дни по местному времени ученика, границы разъедутся - об этом сказано в
    документе интеграции.
    """
    days: dict[str, dict[str, Any]] = {}
    for trade in trades:
        closed = _at(trade.closed_at)
        if closed is None:
            continue
        key = closed.strftime("%Y-%m-%d")
        _fill(days.setdefault(key, _cell("date", key)), trade)
    return _rounded(days[key] for key in sorted(days))


def by_exchange(trades: Sequence[Any]) -> list[dict[str, Any]]:
    """Разрез по биржам. Суммы разных счетов не складываются - это учёт."""
    cells: dict[str, dict[str, Any]] = {}
    for trade in trades:
        key = exchange_of(trade)
        _fill(cells.setdefault(key, _cell("exchange", key)), trade)
    # Сначала та, где торговали больше: список читается сверху вниз.
    return _rounded(sorted(cells.values(), key=lambda c: (-c["trades"], c["exchange"])))


def top_symbols(trades: Sequence[Any], limit: int = 5) -> list[dict[str, Any]]:
    """Пары, на которых ученик торгует чаще всего."""
    cells: dict[str, dict[str, Any]] = {}
    for trade in trades:
        key = (trade.symbol or "").upper()
        _fill(cells.setdefault(key, _cell("symbol", key)), trade)
    ranked = sorted(cells.values(), key=lambda c: (-c["trades"], -c["pnl"], c["symbol"]))
    return _rounded(ranked[:limit])


def last_trades(trades: Sequence[Any], limit: int = DEFAULT_LAST) -> list[dict[str, Any]]:
    """Последние сделки - свежая сверху.

    Отдаём только то, что ученик и так видит у себя: пару, сторону, итог и
    время. Цены входа и стопа - это его торговая схема, академии она не нужна.
    """
    fresh = sorted(
        trades,
        key=lambda t: _at(t.closed_at) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return [
        {
            "symbol": trade.symbol,
            "side": trade.side,
            "outcome": trade.outcome,
            "pnl": round(_f(trade.pnl), 8),
            "exchange": exchange_of(trade),
            "closed_at": (_at(trade.closed_at) or datetime.now(timezone.utc)).isoformat(),
        }
        for trade in fresh[:limit]
    ]
