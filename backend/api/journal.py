"""Журнал сделок скальпинг-терминала и сохранённое рабочее место.

Журнал — это факт: сюда попадает только закрытая сделка, с ценой выхода и
результатом в деньгах. Незакрытые живут на клиенте, потому что до закрытия у
них нет итога, а статистика по намерениям никому не нужна.

Записи идентифицируются идентификатором с клиента: страница может отправить
сделку повторно после обрыва связи, и дубликат исказил бы и журнал, и календарь
прибыли. Повторная отправка обновляет существующую запись, а не создаёт вторую.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_, select

from backend import entitlements
from core.exchanges import KEYS_EXCHANGE, TITLES
from core.models import (
    iso,
    JournalExport,
    LiveTrade,
    ScalpTrade,
    ScalpWorkspace,
    Student,
    TradeShot,
    WeekPlan,
    utcnow,
)
from backend.api.shots import keep_picture
from backend.config import BackendConfig
from backend.deps import get_config, get_current_student, get_session

router = APIRouter(prefix="/api/journal", tags=["journal"])

# Сколько сделок отдаём за раз. Скальпер делает десятки сделок в день, и без
# потолка ответ вырастет до мегабайтов на длинной истории.
MAX_TRADES = 500

# Сколько сделок в работе показываем. Больше десятка открытых разом не бывает
# даже на пяти биржах, а потолок нужен, чтобы запись, застрявшая «в работе»
# из-за отключённого счёта, не превратила список в ленту.
MAX_LIVE = 20

# Потолок сохранённого рабочего места. Настройки — это десяток чисел и флагов;
# всё, что крупнее, приехало не из интерфейса.
MAX_WORKSPACE_BYTES = 16_384

SIDES = {"long", "short"}
OUTCOMES = {"stop", "take", "manual"}

# Как в запросе называется «сделка без биржи»: учебная, по стакану, без
# подключённого счёта. Пустая строка в параметре не годится - её не отличить
# от «биржу не спрашивали».
NO_VENUE = "none"


def _venue(code: str | None) -> str:
    """Код биржи из запроса. Незнакомая или пустая - пусто: сделка без биржи."""
    value = (code or "").strip().lower()
    return value if value in TITLES else ""


def _exchange_of(trade: ScalpTrade) -> str:
    """Биржа записи.

    У сделок, записанных сопровождением до появления поля, биржа - та, чьи
    ключи тогда подключали: других в терминале не было. У записей с экрана
    биржи может не быть вовсе - это торговля по стакану без счёта.
    """
    return (trade.exchange or "").strip().lower() or (
        KEYS_EXCHANGE if trade.from_exchange else ""
    )


# Код биржи в выборке: у старых строк колонка может быть пустой или NULL.
_VENUE_COLUMN = func.coalesce(ScalpTrade.exchange, "")


def _venue_clause(code: str):
    """Условие отбора по бирже.

    Записи сопровождения без кода биржи относим к WEEX по той же причине, по
    которой её подставляет `_exchange_of`: до мультибиржи других счетов не
    было, и прятать эту историю от фильтра значит показать ученику пустой
    журнал там, где у него год торговли.
    """
    if code == NO_VENUE:
        return and_(_VENUE_COLUMN == "", ScalpTrade.from_exchange.is_(False))
    if code == KEYS_EXCHANGE:
        return or_(
            _VENUE_COLUMN == KEYS_EXCHANGE,
            and_(_VENUE_COLUMN == "", ScalpTrade.from_exchange.is_(True)),
        )
    return _VENUE_COLUMN == code


def _asked_venue(code: str | None) -> str | None:
    """Биржа из параметра запроса. `None` - не спрашивали, значит все.

    Незнакомый код - отказ, а не молчаливый показ всего: ученик, открывший
    журнал с опечаткой в ссылке, должен увидеть ошибку, а не чужие суммы под
    видом своей биржи.
    """
    if code is None:
        return None
    value = code.strip().lower()
    if not value:
        return None
    if value != NO_VENUE and not _venue(value):
        raise HTTPException(422, "Неизвестная биржа")
    return value


def _by_venue(session, *conditions) -> list[dict[str, Any]]:
    """Разрез по биржам: сколько сделок и с каким итогом на каждой.

    Считается всегда по всему отбору, а не по выбранной бирже: по этому списку
    рисуется сам переключатель, и биржа, которую только что отфильтровали, не
    должна из него исчезать.

    Суммы разных бирж здесь не складываются намеренно - это требование учёта:
    одна строка отчёта принадлежит одной бирже.
    """
    rows = session.execute(
        select(
            _VENUE_COLUMN,
            ScalpTrade.from_exchange,
            func.count(ScalpTrade.id),
            func.sum(ScalpTrade.pnl),
            func.sum(case((ScalpTrade.pnl > 0, 1), else_=0)),
            func.sum(case((ScalpTrade.pnl < 0, 1), else_=0)),
        )
        .where(*conditions)
        .group_by(_VENUE_COLUMN, ScalpTrade.from_exchange)
    ).all()

    out: dict[str, dict[str, Any]] = {}
    for code, from_exchange, count, pnl, wins, losses in rows:
        key = (code or "").strip().lower() or (KEYS_EXCHANGE if from_exchange else NO_VENUE)
        cell = out.setdefault(key, {"exchange": key, "count": 0, "pnl": 0.0, "wins": 0, "losses": 0})
        cell["count"] += int(count or 0)
        cell["pnl"] += float(pnl or 0)
        cell["wins"] += int(wins or 0)
        cell["losses"] += int(losses or 0)

    for cell in out.values():
        cell["pnl"] = round(cell["pnl"], 8)
    # Сначала та, где торговали больше: переключатель читается слева направо.
    return sorted(out.values(), key=lambda cell: (-cell["count"], cell["exchange"]))


class TradeIn(BaseModel):
    """Закрытая сделка с клиента."""

    client_id: str = Field(min_length=1, max_length=64)
    symbol: str = Field(min_length=1, max_length=32)
    side: str
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    exit_price: float | None = Field(default=None, gt=0)
    qty: float = Field(gt=0)
    margin: float = Field(gt=0)
    # Как у входа: MEXC даёт x500, и такая сделка не записывалась в журнал.
    leverage: int = Field(ge=1, le=500)
    takes_hit: int = Field(default=0, ge=0, le=10)
    # Комиссия обеих ног: по ней видно, почему на счёт пришло меньше.
    fee: float = Field(default=0, ge=0)
    targets: list[float] = Field(default_factory=list, max_length=10)
    outcome: str
    pnl: float
    opened_at: datetime | None = None
    closed_at: datetime
    note: str = Field(default="", max_length=255)
    # Где сделка шла. Терминал знает свою биржу и без счёта: стакан и лента
    # идут с неё же. Пусто - торговля по стакану общей биржи, без своего счёта.
    exchange: str = Field(default="", max_length=16)


def _validate(trade: TradeIn) -> None:
    if trade.side not in SIDES:
        raise HTTPException(422, "Сторона сделки: long или short")
    if trade.outcome not in OUTCOMES:
        raise HTTPException(422, "Итог сделки: stop, take или manual")


def _as_utc(value: datetime | None) -> datetime | None:
    """Привести время к UTC: без часового пояса день в календаре уедет."""
    if value is None:
        return None
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    """Время наружу — всегда с зоной.

    SQLite хранит дату строкой и часовой пояс теряет. Отдать такую строку как
    есть значит заставить браузер прочитать её как местное время: у трейдера в
    другом поясе сделка уехала бы в соседний день календаря.
    """
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _live_stops(session, student_id: int, client_ids: list[str]) -> dict[str, float]:
    """Где стоит стоп прямо сейчас - по сделкам, которые ведёт сопровождение."""
    if not client_ids:
        return {}
    rows = session.execute(
        select(LiveTrade.client_id, LiveTrade.current_stop)
        .where(LiveTrade.student_id == student_id)
        .where(LiveTrade.client_id.in_(client_ids))
        .where(LiveTrade.status.in_(("waiting", "open")))
    ).all()
    return {str(client_id): float(stop or 0) for client_id, stop in rows}


def _row(
    trade: ScalpTrade,
    stop_now: float | None = None,
    shots: list[dict] | None = None,
) -> dict[str, Any]:
    return {
        "id": trade.id,
        "client_id": trade.client_id,
        "symbol": trade.symbol,
        "side": trade.side,
        "entry": float(trade.entry),
        "stop": float(trade.stop),
        "exit_price": float(trade.exit_price) if trade.exit_price is not None else None,
        "qty": float(trade.qty),
        "margin": float(trade.margin),
        "leverage": trade.leverage,
        "takes_hit": trade.takes_hit,
        "fee": float(trade.fee or 0),
        "targets": json.loads(trade.targets_json or "[]"),
        "outcome": trade.outcome,
        "pnl": float(trade.pnl),
        "opened_at": _iso(trade.opened_at),
        "closed_at": _iso(trade.closed_at),
        "note": trade.note,
        # Сделка ещё идёт: `pnl` у неё - только зафиксированное взятыми
        # целями, а плавающее по остатку живёт в терминале.
        "live": trade.closed_at is None,
        "closed_qty": float(getattr(trade, "closed_qty", 0) or 0),
        # Стоп, который стоит на бирже сейчас. Есть только у идущей: у
        # закрытой в `stop` записан тот, с которым она задумывалась.
        **({"stop_now": stop_now} if stop_now else {}),
        # Снимки разбора: пусто - строка их не показывает.
        "shots": shots or [],
        # Где открыта. У записей с биржи, сделанных до этого поля, - биржа
        # ключей: других тогда не было.
        "exchange": _exchange_of(trade),
    }


# Сколько выгрузок журнала в месяц даёт купленная функция. Выгрузка - это
# отчёт с диаграммами по году сделок, и три в месяц хватает: в начале месяца,
# в середине и на разбор после тяжёлой недели.
EXPORTS_PER_MONTH = 3

# Сколько дней истории уходит в отчёт: год, как и потолок журнала.
EXPORT_DAYS = 365


def _month_start(now: datetime) -> datetime:
    """Начало календарного месяца по UTC: лимит обновляется первого числа."""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month(now: datetime) -> datetime:
    start = _month_start(now)
    return (start + timedelta(days=32)).replace(day=1)


def _quota(session, student_id: int) -> dict[str, Any]:
    now = utcnow()
    used = session.execute(
        select(func.count(JournalExport.id))
        .where(JournalExport.student_id == student_id)
        .where(JournalExport.created_at >= _month_start(now))
    ).scalar_one()
    return {
        "owned": entitlements.has_feature(session, student_id, "journal_export"),
        "limit": EXPORTS_PER_MONTH,
        "used": int(used),
        "left": max(0, EXPORTS_PER_MONTH - int(used)),
        "resets_at": _iso(_next_month(now)),
    }


@router.get("/export")
async def export_quota(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сколько выгрузок осталось в этом месяце. Для подписи у кнопки."""
    return _quota(session, student.id)


@router.post("/export")
async def export_journal(
    symbol: str | None = Query(None, max_length=32),
    exchange: str | None = Query(None, max_length=16),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Выгрузить журнал: сделки за год для отчёта - и засчитать выгрузку.

    Счёт на сервере, а не в браузере: лимит, который держит сама страница,
    обходится очисткой хранилища. Засчитывается только выгрузка, которая
    состоялась: сделки собраны и отданы.

    Отчёт наследует биржу того экрана, с которого его заказали: смешать в нём
    два счёта значит выдать ученику бумагу, в которой итог не сходится ни с
    одной биржей.
    """
    venue = _asked_venue(exchange)
    quota = _quota(session, student.id)
    if not quota["owned"]:
        raise HTTPException(403, "Выгрузка журнала продаётся в маркете, в разделе «Инструменты»")
    if quota["left"] <= 0:
        raise HTTPException(429, "Выгрузки этого месяца закончились - новые будут первого числа")

    query = (
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= utcnow() - timedelta(days=EXPORT_DAYS))
        .order_by(ScalpTrade.closed_at.desc())
        # Потолок выше, чем у списка на экране: отчёт берут целиком, но
        # безразмерным он быть не должен.
        .limit(MAX_TRADES * 4)
    )
    if symbol:
        query = query.where(ScalpTrade.symbol == symbol.upper())
    if venue:
        query = query.where(_venue_clause(venue))
    trades = session.execute(query).scalars().all()

    session.add(JournalExport(student_id=student.id, trades=len(trades)))
    session.commit()
    return {"trades": [_row(t) for t in trades], "quota": _quota(session, student.id)}


# ── снимки сделки ───────────────────────────────────────────────────────────
#
# Разбор сделки задним числом - это разговор о картинке: где был вход, что
# стояло в стакане, как выглядел график до и после. Снимки уже умели жить на
# сервере (`backend/api/shots.py`), не хватало связи со сделкой.

# Сколько снимков держим на одну сделку.
#
# Шести хватает на разбор: до входа, вход, в позиции, выход и пара мест по
# дороге. Потолок нужен не ради диска, а ради самого разбора: два десятка
# картинок в ленте - это уже не разбор, а свалка.
MAX_SHOTS = 6


class ShotAttachIn(BaseModel):
    """Что прикрепляют к сделке: новая картинка или уже готовый снимок."""

    # Картинка с экрана: снимок графика или вставленный из буфера обмена.
    image: str | None = Field(default=None, min_length=64)
    # Или опознаватель снимка, который уже лежит на сервере.
    shot_id: str | None = Field(default=None, max_length=22)
    note: str = Field(default="", max_length=140)


def _shot_rows(session, student_id: int, client_ids: list[str]) -> dict[str, list[dict]]:
    """Снимки по сделкам: сделка - список снимков, свежие последними."""
    if not client_ids:
        return {}
    rows = session.execute(
        select(TradeShot)
        .where(TradeShot.student_id == student_id)
        .where(TradeShot.client_id.in_(client_ids))
        .order_by(TradeShot.id.asc())
    ).scalars().all()
    out: dict[str, list[dict]] = {}
    for row in rows:
        out.setdefault(str(row.client_id), []).append(
            {"id": row.id, "shot_id": row.shot_id, "note": row.note}
        )
    return out


@router.post("/trades/{client_id}/shots", status_code=201)
def attach_shot(
    client_id: str,
    body: ShotAttachIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Прикрепить снимок к сделке - своей, и только к ней.

    Сделку ищем и среди записей журнала, и среди живых: снимок делают в
    работе, а не после закрытия, и ждать конца сделки, чтобы его приложить,
    было бы странно.
    """
    known = session.execute(
        select(ScalpTrade.id)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.client_id == client_id)
    ).scalar_one_or_none()
    if known is None:
        known = session.execute(
            select(LiveTrade.id)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.client_id == client_id)
        ).scalar_one_or_none()
    if known is None:
        raise HTTPException(404, "Такой сделки нет")

    have = session.execute(
        select(func.count(TradeShot.id))
        .where(TradeShot.student_id == student.id)
        .where(TradeShot.client_id == client_id)
    ).scalar_one()
    if have >= MAX_SHOTS:
        raise HTTPException(409, f"К сделке уже прикреплено {MAX_SHOTS} снимков")

    shot_id = (body.shot_id or "").strip()
    if body.image:
        shot_id = keep_picture(session, body.image, symbol="TRADE", kind="photo")
    if not shot_id:
        raise HTTPException(400, "Нужна картинка или опознаватель снимка")

    row = TradeShot(
        student_id=student.id,
        client_id=client_id,
        shot_id=shot_id,
        note=body.note.strip(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"id": row.id, "shot_id": row.shot_id, "note": row.note}


@router.delete("/shots/{shot_row_id}", status_code=204)
def detach_shot(
    shot_row_id: int,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Открепить снимок от сделки.

    Сам файл остаётся: на него могла уйти ссылка в чат, и обрывать её из-за
    того, что картинку убрали из разбора, незачем.
    """
    row = session.get(TradeShot, shot_row_id)
    if row is None or row.student_id != student.id:
        raise HTTPException(404, "Снимка нет")
    session.delete(row)
    session.commit()


# ── план на неделю ──────────────────────────────────────────────────────────


def week_of(at: datetime) -> str:
    """Неделя по ISO: `2026-W38`.

    Не датой начала: неделя у разных стран начинается по-разному, а
    ISO-номер один и тот же везде.
    """
    year, number, _day = at.isocalendar()
    return f"{year:04d}-W{number:02d}"


class WeekPlanIn(BaseModel):
    """План на неделю: что торгуем и по каким правилам."""

    week: str = Field(default="", pattern=r"^$|^\d{4}-W\d{2}$")
    text: str = Field(default="", max_length=4000)


@router.get("/plan")
def read_plan(
    week: str = Query("", pattern=r"^$|^\d{4}-W\d{2}$"),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """План трейдера на неделю. Пусто - значит ещё не писал."""
    key = week or week_of(utcnow())
    row = session.execute(
        select(WeekPlan)
        .where(WeekPlan.student_id == student.id)
        .where(WeekPlan.week == key)
    ).scalar_one_or_none()
    return {
        "week": key,
        "text": row.text if row else "",
        "updated_at": _iso(row.updated_at) if row else None,
    }


@router.put("/plan")
def write_plan(
    body: WeekPlanIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Записать план недели. Одна запись на неделю - её правят, а не плодят."""
    key = body.week or week_of(utcnow())
    row = session.execute(
        select(WeekPlan)
        .where(WeekPlan.student_id == student.id)
        .where(WeekPlan.week == key)
    ).scalar_one_or_none()
    text = body.text.strip()
    if row is None:
        row = WeekPlan(student_id=student.id, week=key, text=text)
        session.add(row)
    else:
        row.text = text
    session.commit()
    session.refresh(row)
    return {"week": key, "text": row.text, "updated_at": _iso(row.updated_at)}


@router.get("/trades")
async def list_trades(
    days: int = Query(90, ge=1, le=365),
    symbol: str | None = Query(None, max_length=32),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    exchange: str | None = Query(None, max_length=16),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Закрытые сделки за период, свежие первыми.

    `date` спрашивает один календарный день и отменяет `days`: в календаре
    нажимают на клетку, а не на «последние девяносто дней». День берётся
    целиком по UTC - в том же поясе, в котором календарь их и раскладывал, иначе
    сделка на границе суток попала бы в соседнюю клетку.

    `exchange` оставляет одну биржу. Итог в `summary` всегда про то, что
    отобрано: складывать в одну строку счета разных бирж нельзя, поэтому
    разрез по каждой идёт отдельным списком `by_exchange` - по нему страница и
    рисует переключатель.
    """
    venue = _asked_venue(exchange)
    # Итоги периода считаются по закрытым. Сделка в работе засчитана лишь
    # частью: её результат ещё изменится, и в проценте прибыльных ей места
    # нет. Идёт она отдельным списком `live`.
    scope: list[Any] = [
        ScalpTrade.student_id == student.id,
        ScalpTrade.closed_at.is_not(None),
    ]
    if date:
        start = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        scope.append(ScalpTrade.closed_at >= start)
        scope.append(ScalpTrade.closed_at < start + timedelta(days=1))
    else:
        scope.append(ScalpTrade.closed_at >= utcnow() - timedelta(days=days))
    if symbol:
        scope.append(ScalpTrade.symbol == symbol.upper())

    query = (
        select(ScalpTrade).where(*scope).order_by(ScalpTrade.closed_at.desc()).limit(MAX_TRADES)
    )
    if venue:
        query = query.where(_venue_clause(venue))

    trades = session.execute(query).scalars().all()
    wins = [t for t in trades if float(t.pnl) > 0]
    losses = [t for t in trades if float(t.pnl) < 0]
    total = sum(float(t.pnl) for t in trades)

    live_scope: list[Any] = [
        ScalpTrade.student_id == student.id,
        ScalpTrade.closed_at.is_(None),
    ]
    if symbol:
        live_scope.append(ScalpTrade.symbol == symbol.upper())
    live_query = select(ScalpTrade).where(*live_scope).order_by(ScalpTrade.opened_at.desc())
    if venue:
        live_query = live_query.where(_venue_clause(venue))
    live = session.execute(live_query.limit(MAX_LIVE)).scalars().all()
    # Текущий стоп идущих сделок: в журнале записан первый - по нему считается
    # риск, - а карточке нужен тот, что стоит на бирже сейчас. Переехавший в
    # безубыток стоп это первое, что на ней хотят видеть.
    stops = _live_stops(session, student.id, [t.client_id for t in live])
    # Снимки разбора: и у закрытых, и у идущих. Ими сделку и разбирают потом.
    shots = _shot_rows(
        session,
        student.id,
        [t.client_id for t in trades] + [t.client_id for t in live],
    )

    return {
        "trades": [_row(t, shots=shots.get(t.client_id)) for t in trades],
        # Сделки в работе: журнал показывает их первыми строками, и в итоги
        # периода они не входят.
        "live": [
            _row(t, stops.get(t.client_id), shots.get(t.client_id)) for t in live
        ],
        "by_exchange": _by_venue(session, *scope),
        # Биржа, на которую уходят новые сделки: с неё страница и открывается,
        # когда ученик ещё ничего не выбирал.
        "active": (student.active_exchange or "").strip().lower(),
        "summary": {
            "count": len(trades),
            "pnl": round(total, 8),
            "wins": len(wins),
            "losses": len(losses),
            # Доля прибыльных считается от сделок с результатом: безубыток —
            # это не победа и не поражение, и в проценте ему места нет.
            "win_rate": round(len(wins) / max(1, len(wins) + len(losses)) * 100, 1),
            "best": round(max((float(t.pnl) for t in trades), default=0.0), 8),
            "worst": round(min((float(t.pnl) for t in trades), default=0.0), 8),
        },
    }


@router.post("/trades", status_code=201)
async def add_trade(
    body: TradeIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Записать закрытую сделку. Повторная отправка обновляет запись."""
    _validate(body)

    trade = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.client_id == body.client_id)
    ).scalar_one_or_none()

    if trade is None:
        trade = ScalpTrade(student_id=student.id, client_id=body.client_id)
        session.add(trade)

    # Запись, собранную из исполнений биржи, оценкой с экрана не переписываем.
    #
    # Терминал пишет сделку сразу, как только позиция пропала: если сервер до
    # неё не дойдёт, она не должна потеряться. Но его числа - оценка по цене
    # стакана, без проскальзывания и комиссии, а сопровождение следом кладёт
    # настоящие, с биржи. Кто напишет последним, того и цифры - и последним
    # оказывался терминал. Именно так в журнале появлялись +487 там, где на
    # счёт пришло +519.
    #
    # Но это про **закрытые** записи. Сделку в работе сопровождение заводит
    # само, с той же отметкой, и запретить её закрывать с экрана значило бы
    # оставить её «в работе» навсегда, если до сервера дело не дошло: счёт
    # отключили, ключи протухли, процесс не поднялся. Оценку с экрана
    # сопровождение потом всё равно поправит своими числами.
    if getattr(trade, "from_exchange", False) and trade.closed_at is not None:
        session.commit()
        session.refresh(trade)
        return _row(trade)
    # Числа теперь с экрана: пусть сопровождение перепишет их, когда доедет.
    trade.from_exchange = False

    trade.symbol = body.symbol.upper()
    trade.side = body.side
    trade.entry = body.entry
    trade.stop = body.stop
    trade.exit_price = body.exit_price
    trade.qty = body.qty
    trade.margin = body.margin
    trade.leverage = body.leverage
    trade.takes_hit = body.takes_hit
    trade.fee = body.fee
    trade.targets_json = json.dumps(body.targets)
    trade.outcome = body.outcome
    trade.pnl = body.pnl
    trade.opened_at = _as_utc(body.opened_at)
    trade.closed_at = _as_utc(body.closed_at) or utcnow()
    trade.note = body.note
    # Биржу с экрана берём только знакомую и только когда она названа: пустое
    # поле у старого клиента не должно стирать уже проставленную биржу.
    venue = _venue(body.exchange)
    if venue:
        trade.exchange = venue

    session.commit()
    session.refresh(trade)
    return _row(trade)


def is_admin(student: Student, config: BackendConfig) -> bool:
    """Наставник это или обычный ученик.

    По учётной записи, а не по отдельному входу с паролем: наставник открывает
    терминал под собой, и заставлять его логиниться вторым способом ради одной
    кнопки незачем.
    """
    return bool(config.admin_tg_id) and student.tg_id == config.admin_tg_id


@router.delete("/trades/{trade_id}")
async def delete_trade(
    trade_id: int,
    student: Student = Depends(get_current_student),
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
):
    """Убрать запись из журнала. Тот, кому это разрешено поимённо.

    Журнал - это статистика, по которой ученик и наставник судят о торговле.
    Право стереть из неё неудачную сделку обесценивает её целиком: остаётся
    красивый список, из которого ничего не следует. Поэтому по умолчанию оно
    закрыто и выдаётся поимённо, в панели наставника.

    Право смотрим по флагу у всех, наставника включая. Раньше наставнику оно
    полагалось самим званием, и выключить его себе он не мог: снятый в панели
    флажок ничего не менял - кнопка оставалась, и записи стирались. Звание
    теперь решает только одно: чей журнал разрешено разбирать.

    Ученик с этим правом убирает только свои записи. Проверка на владельца тут
    не формальность: до сих пор её не было вовсе, потому что дойти сюда мог
    один наставник, а ему чужие записи и положены. Стоит открыть дверь шире -
    и без неё любой допущенный стирал бы чужой журнал по номеру сделки.
    """
    mentor = is_admin(student, config)
    if not student.journal_delete_allowed:
        raise HTTPException(403, "Убирать записи из журнала вам не разрешено")
    trade = session.get(ScalpTrade, trade_id)
    if trade is None:
        raise HTTPException(404, "Сделка не найдена")
    if not mentor and trade.student_id != student.id:
        # Ответ тот же, что и у несуществующей записи: чужой номер сделки не
        # должен отвечать «есть такая, но не ваша».
        raise HTTPException(404, "Сделка не найдена")
    session.delete(trade)
    session.commit()
    return {"ok": True}


@router.get("/calendar")
async def calendar(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    exchange: str | None = Query(None, max_length=16),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Прибыль журнала по дням месяца.

    Считается на месте, а не хранится: сделок за месяц сотни, а не миллионы, и
    отдельная таблица итогов означала бы ещё одно место, где данные расходятся.

    `exchange` оставляет одну биржу: клетка месяца - это отчёт, а в одной
    строке отчёта суммы разных счетов не живут.
    """
    venue = _asked_venue(exchange)
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    scope: list[Any] = [
        ScalpTrade.student_id == student.id,
        ScalpTrade.closed_at >= start,
        ScalpTrade.closed_at < end,
    ]

    query = select(ScalpTrade).where(*scope)
    if venue:
        query = query.where(_venue_clause(venue))
    trades = session.execute(query).scalars().all()

    days: dict[str, dict[str, float]] = {}
    for trade in trades:
        key = _as_utc(trade.closed_at).strftime("%Y-%m-%d")  # type: ignore[union-attr]
        day = days.setdefault(key, {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0})
        day["pnl"] += float(trade.pnl)
        day["trades"] += 1
        if float(trade.pnl) > 0:
            day["wins"] += 1
        elif float(trade.pnl) < 0:
            day["losses"] += 1

    return {
        "year": year,
        "month": month,
        "by_exchange": _by_venue(session, *scope),
        "days": [
            {"date": key, "pnl": round(v["pnl"], 8), **{k: int(v[k]) for k in ("trades", "wins", "losses")}}
            for key, v in sorted(days.items())
        ],
        "total": round(sum(float(t.pnl) for t in trades), 8),
    }


@router.get("/workspace")
async def get_workspace(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранённый шаблон рабочего места. Пустой объект — значит не сохранял."""
    row = session.execute(
        select(ScalpWorkspace).where(ScalpWorkspace.student_id == student.id)
    ).scalar_one_or_none()
    if row is None:
        return {"payload": None, "updated_at": None}
    try:
        payload = json.loads(row.payload)
    except ValueError:
        payload = None
    return {"payload": payload, "updated_at": iso(row.updated_at)}


@router.put("/workspace")
async def save_workspace(
    payload: dict[str, Any],
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранить шаблон, чтобы он открывался на любом устройстве."""
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw.encode("utf-8")) > MAX_WORKSPACE_BYTES:
        raise HTTPException(413, "Настройки слишком большие")

    row = session.execute(
        select(ScalpWorkspace).where(ScalpWorkspace.student_id == student.id)
    ).scalar_one_or_none()
    if row is None:
        row = ScalpWorkspace(student_id=student.id)
        session.add(row)
    row.payload = raw
    row.updated_at = utcnow()
    session.commit()
    return {"ok": True, "updated_at": iso(row.updated_at)}
