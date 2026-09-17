"""Здоровье бирж: задержки, отказы, потоки, обходы сопровождения.

Пока всё это жило строками в окне сервера, разбор любой поломки начинался с
просьбы прислать лог, и начинался он после того, как трейдер уже потерял
деньги. Здесь те же события считаются числами, которые можно посмотреть в
любой момент: как быстро отвечает биржа, часто ли отказывает и чем, жив ли её
приватный поток, сколько длится обход сопровождения.

Память короткая и своя у каждого процесса: это не отчётность, а приборная
панель. В раздельном режиме процессов два, и панель складывает их снимки.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

# Сколько последних вызовов держим на биржу. Тысяча - это около получаса
# терминала на одной сделке и меньше сотни килобайт памяти.
DEPTH = 1000
# Окно, за которое считаются числа панели.
WINDOW = 300.0
# Как помечается событие потока, а не запроса.
STREAM = "поток"


@dataclass
class Call:
    at: float
    ms: float
    ok: bool
    code: str
    what: str


@dataclass
class Venue:
    """Что мы знаем о бирже прямо сейчас."""

    calls: deque[Call] = field(default_factory=lambda: deque(maxlen=DEPTH))
    streams_up: int = 0
    stream_drops: int = 0
    stream_since: float = 0.0
    last_error: str = ""
    last_error_at: float = 0.0


_venues: dict[str, Venue] = {}

# ── сам сервер: паузы и запросы ─────────────────────────────────────────────
#
# Биржи отвечают быстро, а терминал у учеников всё равно замирал и показывал
# «сервер обновляется». Значит, замирал сам сервер: один процесс держит и
# сайт, и терминалы всех учеников, и поток Binance в тысячи сообщений в
# секунду. Здесь - насколько он замирает и кто его занимает.

# Замирание дольше этого терминал уже видит: круг его опроса - три секунды.
STALL_MS = 1000.0
# Ответ дольше этого пишем в журнал поимённо.
SLOW_MS = 2000.0
# Замирание дольше этого пишем в журнал сразу, с ролью процесса.
LOUD_STALL_MS = 2000.0

# Пауза цикла событий: (когда, насколько опоздал проснуться, мс).
_lags: deque[tuple[float, float]] = deque(maxlen=2 * DEPTH)
# Все ответы за окно: (когда, ручка, мс). Пять минут при двадцати запросах в
# секунду - шесть тысяч строк по три числа, это мало.
_requests: deque[tuple[float, str, float]] = deque(maxlen=6 * DEPTH)
# Длительность обходов сопровождения: не по биржам, а по всему кругу.
_passes: deque[float] = deque(maxlen=DEPTH)


def _venue(exchange: str) -> Venue:
    name = str(exchange or "").lower() or "?"
    if name not in _venues:
        _venues[name] = Venue()
    return _venues[name]


def note_call(exchange: str, ms: float, ok: bool, what: str = "", code: str = "") -> None:
    """Запомнить вызов биржи: сколько занял и чем кончился."""
    venue = _venue(exchange)
    venue.calls.append(Call(at=time.time(), ms=ms, ok=ok, code=str(code or ""), what=what))
    if not ok:
        venue.last_error = f"{what}: {code}" if what else str(code)
        venue.last_error_at = time.time()


def note_stream(exchange: str, up: bool) -> None:
    """Приватный поток биржи поднялся или оборвался."""
    venue = _venue(exchange)
    if up:
        venue.streams_up += 1
        venue.stream_since = time.time()
        return
    venue.streams_up = max(0, venue.streams_up - 1)
    venue.stream_drops += 1


def note_lag(ms: float, at: float | None = None) -> None:
    """Насколько цикл событий опоздал проснуться. Ноль - сервер свободен."""
    _lags.append((at if at is not None else time.time(), max(0.0, float(ms))))


def note_request(route: str, ms: float, at: float | None = None) -> None:
    """Ответ на запрос: какая ручка и сколько занял."""
    _requests.append((at if at is not None else time.time(), str(route or "?"), float(ms)))


def server_snapshot(window: float = WINDOW, now: float | None = None) -> dict[str, Any]:
    """Паузы процесса и нагрузка на его ручки за окно."""
    moment = now if now is not None else time.time()
    edge = moment - window
    lags = [ms for at, ms in _lags if at >= edge]
    asked = [(route, ms) for at, route, ms in _requests if at >= edge]

    by_route: dict[str, list[float]] = {}
    for route, ms in asked:
        by_route.setdefault(route, []).append(ms)
    minutes = window / 60 if window > 0 else 1.0
    routes = [
        {
            "route": route,
            "per_min": round(len(times) / minutes, 1),
            "ms_median": percentile(times, 0.5),
            "ms_worst": percentile(times, 1.0),
        }
        for route, times in by_route.items()
    ]
    busiest = sorted(routes, key=lambda row: row["per_min"], reverse=True)[:8]
    slowest = sorted(
        (row for row in routes if row["ms_worst"] >= SLOW_MS),
        key=lambda row: row["ms_worst"],
        reverse=True,
    )[:5]
    return {
        "lag_worst_ms": percentile(lags, 1.0),
        "lag_median_ms": percentile(lags, 0.5),
        "stalls": sum(1 for ms in lags if ms >= STALL_MS),
        "per_min": round(len(asked) / minutes, 1),
        "busiest": busiest,
        "slowest": slowest,
    }


async def watch_loop(role_name: str, step: float = 0.5) -> None:
    """Сторож цикла событий: засыпает на полсекунды и меряет, насколько проспал.

    Проспал - значит, всё это время процесс был занят чем-то одним и никому не
    отвечал: ни терминалу, ни сопровождению. Долгое замирание пишем в журнал
    сразу, с временем - по нему и разбираем.
    """
    import asyncio

    loop = asyncio.get_running_loop()
    log = logging.getLogger("nmnh.trading")
    while True:
        started = loop.time()
        await asyncio.sleep(step)
        lag = (loop.time() - started - step) * 1000
        note_lag(lag)
        if lag >= LOUD_STALL_MS:
            log.warning("Сервер замер на %.1f с (роль %s)", lag / 1000, role_name)


class RequestTimer:
    """Меряет каждый ответ сервера и пишет его в панель под именем ручки.

    Под именем ручки, а не адреса: `/api/scalping/klines/{symbol}` одна ручка,
    сколько бы монет по ней ни спрашивали. Медленный ответ - сразу в журнал.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        started = time.monotonic()
        try:
            await self.app(scope, receive, send)
        finally:
            ms = (time.monotonic() - started) * 1000
            route = getattr(scope.get("route"), "path", None) or scope.get("path", "?")
            method = scope.get("method", "")
            if method != "OPTIONS":
                note_request(f"{method} {route}", ms)
                if ms >= SLOW_MS:
                    logging.getLogger("nmnh.trading").warning(
                        "Медленный ответ: %s %s - %.1f с", method, scope.get("path", "?"), ms / 1000
                    )


def note_pass(seconds: float) -> None:
    """Длительность обхода сопровождения."""
    _passes.append(float(seconds))


def percentile(values: list[float], share: float, digits: int = 1) -> float:
    """Значение, ниже которого лежит эта доля. Пусто - ноль.

    Точность разная по смыслу числа. Задержки считаны в миллисекундах, и
    десятой доли там хватает с запасом. Обход сопровождения считан в секундах,
    и та же десятая доля округляла быстрый обход до нуля: панель писала
    «обычный занимает 0 мс» о работе, которая идёт.
    """
    if not values:
        return 0.0
    ordered = sorted(values)
    place = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * share)))
    return round(ordered[place], digits)


def snapshot(window: float = WINDOW, now: float | None = None) -> dict[str, Any]:
    """Числа панели за последнее окно."""
    moment = now if now is not None else time.time()
    edge = moment - window

    venues = []
    for name, venue in sorted(_venues.items()):
        fresh = [call for call in venue.calls if call.at >= edge]
        # Обрыв потока - не запрос: у него нет ни задержки, ни отказа биржи.
        # Смешав их, панель показывала «ответ обычно 43 секунды» - это была
        # длительность жизни оборванного соединения, а не ответ на запрос.
        drops = [call for call in fresh if call.what == STREAM]
        asked = [call for call in fresh if call.what != STREAM]
        # Мгновенные вызовы в задержку не берём: это ответ из памяти клиента,
        # а не поход на биржу, и он занижал бы её вдвое.
        times = [call.ms for call in asked if call.ms > 0]
        bad = [call for call in asked if not call.ok]
        venues.append(
            {
                "exchange": name,
                "calls": len(asked),
                "errors": len(bad),
                "error_share": round(len(bad) / len(asked), 3) if asked else 0.0,
                "ms_median": percentile(times, 0.5),
                "ms_worst": percentile(times, 0.95),
                "codes": _top_codes(bad),
                "streams": venue.streams_up,
                # Обрывы за окно и всего с запуска: рядом с «числа за 5 минут»
                # общий счёт читался как недавние обрывы и пугал зря.
                "stream_drops": len(drops),
                "stream_drops_total": venue.stream_drops,
                "stream_minutes": round((moment - venue.stream_since) / 60, 1)
                if venue.stream_since and venue.streams_up
                else 0.0,
                "last_error": venue.last_error,
                "last_error_ago": round(moment - venue.last_error_at)
                if venue.last_error_at
                else None,
            }
        )

    passes = list(_passes)
    return {
        "window": window,
        "server": server_snapshot(window, moment),
        "venues": venues,
        "watcher": {
            "passes": len(passes),
            "seconds_median": percentile(passes, 0.5, digits=3),
            "seconds_worst": percentile(passes, 0.95, digits=3),
        },
    }


def _top_codes(bad: list[Call], limit: int = 3) -> list[dict[str, Any]]:
    """Самые частые причины отказов: по ним видно, чинить нам или бирже."""
    counted: dict[str, int] = {}
    for call in bad:
        key = call.code or "без кода"
        counted[key] = counted.get(key, 0) + 1
    top = sorted(counted.items(), key=lambda pair: pair[1], reverse=True)[:limit]
    return [{"code": code, "times": times} for code, times in top]


def merge(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """Сложить снимки процессов в один.

    В раздельном режиме терминал и сопровождение живут порознь, и биржа у них
    одна: панель обязана показывать её целиком, а не половину.
    """
    if not snapshots:
        return {"window": WINDOW, "venues": [], "watcher": {}, "processes": []}

    by_name: dict[str, dict[str, Any]] = {}
    for shot in snapshots:
        for venue in shot.get("venues") or []:
            name = str(venue.get("exchange") or "?")
            have = by_name.get(name)
            if have is None:
                by_name[name] = dict(venue)
                continue
            calls = int(have.get("calls", 0)) + int(venue.get("calls", 0))
            errors = int(have.get("errors", 0)) + int(venue.get("errors", 0))
            # Задержку берём худшую из процессов: панель должна показывать
            # беду, а не усреднять её до незаметной.
            have.update(
                calls=calls,
                errors=errors,
                error_share=round(errors / calls, 3) if calls else 0.0,
                ms_median=max(have.get("ms_median", 0), venue.get("ms_median", 0)),
                ms_worst=max(have.get("ms_worst", 0), venue.get("ms_worst", 0)),
                streams=int(have.get("streams", 0)) + int(venue.get("streams", 0)),
                stream_drops=int(have.get("stream_drops", 0)) + int(venue.get("stream_drops", 0)),
                stream_drops_total=int(have.get("stream_drops_total", 0))
                + int(venue.get("stream_drops_total", 0)),
                stream_minutes=max(have.get("stream_minutes", 0), venue.get("stream_minutes", 0)),
            )
            if venue.get("last_error") and not have.get("last_error"):
                have["last_error"] = venue["last_error"]
                have["last_error_ago"] = venue.get("last_error_ago")

    # Обход сопровождения есть только у одного процесса - берём непустой.
    watcher: dict[str, Any] = {}
    for shot in snapshots:
        one = shot.get("watcher") or {}
        if one.get("passes"):
            watcher = one
            break

    # Сервер - по процессам, не складывая: замирает каждый сам по себе, и
    # сумма пауз двух процессов не говорит ни о котором из них.
    processes = [
        {"role": str(shot.get("role") or "all"), **(shot.get("server") or {})}
        for shot in snapshots
        if shot.get("server")
    ]

    return {
        "window": snapshots[0].get("window", WINDOW),
        "venues": sorted(by_name.values(), key=lambda row: str(row.get("exchange"))),
        "watcher": watcher,
        "processes": sorted(processes, key=lambda row: row["role"]),
    }


def clear() -> None:
    """Забыть всё. Нужно тестам."""
    _venues.clear()
    _passes.clear()
    _lags.clear()
    _requests.clear()


# ── снимок в базу: процессов два, панель одна ───────────────────────────────

# Ключ в таблице настроек: по одному на роль процесса.
ROW = "health:"
# Снимок старше этого срока не показываем: процесс, скорее всего, не жив.
FRESH = 60.0


def role() -> str:
    """Роль этого процесса: `all`, `api`, `watcher` или `market`."""
    try:
        from backend.main import process_role

        return process_role()
    except Exception:  # noqa: BLE001 - без приложения читаем окружение
        import os

        return (os.getenv("NMNH_ROLE") or "all").strip().lower() or "all"


def publish(session, role: str, now: float | None = None) -> None:
    """Положить свой снимок в базу под своей ролью.

    В раздельном режиме терминал и сопровождение живут порознь, и панель без
    этого показывала бы половину биржи.
    """
    import json

    from core.models import SettingRow

    shot = snapshot(now=now)
    shot["role"] = str(role or "all")
    shot["at"] = now if now is not None else time.time()
    key = f"{ROW}{shot['role']}"
    row = session.get(SettingRow, key)
    if row is None:
        session.add(SettingRow(key=key, value=json.dumps(shot, ensure_ascii=False)))
    else:
        row.value = json.dumps(shot, ensure_ascii=False)
    session.commit()


def published(session, now: float | None = None) -> list[dict[str, Any]]:
    """Свежие снимки всех процессов. Протухшие пропускаем."""
    import json

    from sqlalchemy import select

    from core.models import SettingRow

    moment = now if now is not None else time.time()
    out: list[dict[str, Any]] = []
    rows = session.execute(
        select(SettingRow).where(SettingRow.key.like(f"{ROW}%"))
    ).scalars().all()
    for row in rows:
        try:
            shot = json.loads(row.value or "{}")
        except ValueError:
            continue
        if moment - float(shot.get("at") or 0) <= FRESH:
            out.append(shot)
    return out
