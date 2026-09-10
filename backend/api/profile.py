"""Профиль ученика и личная аналитика (ТЗ §15.6, §15.4)."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from core.weex.uid import clean_uid
from core.models import BalanceSnapshot, ScalpTrade, SignalDelivery, Student
from backend.trading.funds import trade_roi, trade_volume
from backend.api.journal import is_admin
from backend.trading.funds import balance_by_keys
from backend.config import BackendConfig
from backend.deps import get_config, get_current_student, get_session, get_weex
from backend.schemas import ProfileOut, ProfilePatch, AnalyticsMe

router = APIRouter(prefix="/api", tags=["profile"])


def _profile(s: Student, admin: bool = False) -> ProfileOut:
    return ProfileOut(
        id=s.id, username=s.username, weex_uid=s.weex_uid, mode=s.mode,
        language=s.language, risk_percent=s.risk_percent, turbo_leverage=s.turbo_leverage,
        balance_usdt=s.balance_usdt, balance_source=s.balance_source,
        avatar_url=s.avatar_url, avatar_frame=s.avatar_frame or "", card_name=s.card_name,
        copy_allowed=bool(s.copy_allowed),
        journal_delete_allowed=bool(s.journal_delete_allowed),
        is_admin=admin,
    )


@router.get("/profile", response_model=ProfileOut)
def get_profile(
    student: Student = Depends(get_current_student),
    config: BackendConfig = Depends(get_config),
):
    # Права наставника отдаём вместе с профилем: интерфейсу надо знать их до
    # того, как он нарисует кнопку, которой у ученика быть не должно.
    return _profile(student, is_admin(student, config))


@router.patch("/profile", response_model=ProfileOut)
def patch_profile(
    body: ProfilePatch,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    fresh = session.get(Student, student.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        # Пустая подпись на карточке - это отказ от своего варианта: дальше её
        # берут из ника Telegram. Хранить пустую строку вместо этого значит
        # подписывать карточку пустотой.
        if field == "card_name":
            value = (value or "").strip() or None
        setattr(fresh, field, value)
    session.commit()
    return _profile(fresh)


@router.get("/profile/balance", response_model=ProfileOut)
async def refresh_balance(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    """Обновить баланс: сначала по ключам ученика, потом по UID.

    Ключи дают ту же цифру, что ученик видит у себя в приложении биржи. Ручка
    по UID - взгляд наставника со стороны: она приходит с задержкой и живёт
    сборщиком, а не торговлей. Подключил ключи - значит дальше считаем по ним.
    """
    fresh = session.get(Student, student.id)

    balance = await balance_by_keys(session, fresh)
    if balance is not None:
        fresh.balance_usdt = balance
        fresh.balance_source = "api_keys"
        session.commit()
        return _profile(fresh)

    if fresh.weex_uid:
        balance = await weex.get_affiliate_balance(fresh.weex_uid)
        if balance is not None:
            fresh.balance_usdt = balance
            fresh.balance_source = "affiliate_api"
            session.commit()
    return _profile(fresh)


@router.get("/analytics/me", response_model=AnalyticsMe)
def analytics_me(student: Student = Depends(get_current_student), session=Depends(get_session)):
    def count(status: str | None = None) -> int:
        stmt = select(func.count()).select_from(SignalDelivery).where(
            SignalDelivery.student_id == student.id
        )
        if status:
            stmt = stmt.where(SignalDelivery.status == status)
        return session.execute(stmt).scalar_one()

    return AnalyticsMe(
        signals_received=count(), sent=count("sent"),
        skipped=count("skipped"), failed=count("failed"),
    )


@router.get("/analytics/calendar")
async def analytics_calendar(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    """Календарь активности: PnL по снимкам баланса + сигналы + сделки + депозиты."""
    from calendar import monthrange

    prefix = f"{year:04d}-{month:02d}"
    _, days_in_month = monthrange(year, month)

    # ── DB: снимки баланса ──────────────────────────────────────────────────
    snapshots = session.execute(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.student_id == student.id)
        .where(BalanceSnapshot.date.like(f"{prefix}-%"))
        .order_by(BalanceSnapshot.date.asc())
    ).scalars().all()

    balance_by_date: dict[str, Decimal] = {s.date: Decimal(str(s.balance_usdt)) for s in snapshots}

    # ── DB: сигналы ─────────────────────────────────────────────────────────
    deliveries = session.execute(
        select(
            func.strftime("%Y-%m-%d", SignalDelivery.delivered_at).label("d"),
            func.count().label("n"),
        )
        .where(SignalDelivery.student_id == student.id)
        .where(SignalDelivery.status == "sent")
        .where(func.strftime("%Y-%m", SignalDelivery.delivered_at) == prefix)
        .group_by("d")
    ).all()
    signals_by_date: dict[str, int] = {row.d: row.n for row in deliveries if row.d}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    last_day = min(days_in_month, int(today[8:10])) if today.startswith(prefix) else days_in_month

    # ── WEEX: депозиты (live) ───────────────────────────────────────────────
    deposit_dates: set[str] = set()
    if student.weex_uid:
        uid = clean_uid(student.weex_uid) or str(student.weex_uid).strip()
        try:
            assets = await weex.get_agency_assert(uid)
            for dep in assets.get("depositList", []):
                ts = dep.get("updateTime", 0)
                if not ts:
                    continue
                dep_date = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                if dep_date.startswith(prefix):
                    deposit_dates.add(dep_date)
        except Exception:
            pass

    # ── Объёмы торгов — из снимков в БД (заполняет balance_collector каждый час) ──
    volume_by_date: dict[str, float] = {}
    for snap in snapshots:
        if snap.futures_volume is not None or snap.spot_volume is not None:
            volume_by_date[snap.date] = float(snap.futures_volume or 0) + float(snap.spot_volume or 0)

    # ── Журнал скальпинга: прибыль по дням ──────────────────────────────────
    #
    # Календарь до этого знал только про изменение баланса на бирже, а оно
    # приходит снимками раз в час и молчит, если ученик торгует со своего счёта.
    # Журнал терминала — это прибыль, посчитанная по самим сделкам.
    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    journal = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= month_start)
        .where(ScalpTrade.closed_at < month_end)
    ).scalars().all()

    journal_by_date: dict[str, dict[str, float]] = {}
    for t in journal:
        closed = t.closed_at if t.closed_at.tzinfo else t.closed_at.replace(tzinfo=timezone.utc)
        cell = journal_by_date.setdefault(
            closed.strftime("%Y-%m-%d"),
            {"pnl": 0.0, "roi": 0.0, "volume": 0.0, "trades": 0},
        )
        cell["pnl"] += float(t.pnl)
        cell["roi"] += trade_roi(float(t.pnl), float(t.margin or 0))
        cell["volume"] += trade_volume(
            float(t.qty or 0), float(t.entry or 0), float(t.exit_price or 0) or None
        )
        cell["trades"] += 1

    # ── Строим список дней ──────────────────────────────────────────────────
    #
    # Процент дня - сумма процентов закрытых сделок.
    #
    # Именно сумма, а не общий доход на общий залог. Это разные числа, когда
    # залоги разные: три сделки на +12%, +21% и +5% дают в день +38%, и ровно
    # эти три числа ученик видел на своих карточках. Взвешивание по залогу
    # дало бы четвёртое, которого он нигде не встречал.
    #
    # Процент каждой сделки - от её залога, как на карточке: плечо превращает
    # движение цены в проценты на залог, и меньшая цифра выглядела бы обманом
    # в обратную сторону.
    #
    # Число прошло две ошибки, и обе стоит помнить. Сперва оно было разностью
    # соседних снимков баланса: снимок пишется первым прогоном сборщика после
    # полуночи и в течение суток не обновляется, поэтому сегодняшняя клетка
    # стояла нулём при любом числе закрытых сделок. Потом - прибылью журнала от
    # баланса: формула стала честной, но знаменатель по-прежнему приходил с
    # биржи, и у ученика с несвежим снимком дневная прибыль делилась на чужую
    # цифру - +474 на депозит в 177 давали +266% за день.
    #
    # Теперь баланса в расчёте нет вовсе. Он остаётся отдельной цифрой на
    # бейдже дня, и врать ею он может только про себя.
    days_out = []
    for d in range(1, last_day + 1):
        date_str = f"{prefix}-{d:02d}"
        balance = balance_by_date.get(date_str)

        cell = journal_by_date.get(date_str, {})
        day_pnl = float(cell.get("pnl", 0.0))
        day_trades = int(cell.get("trades", 0))
        pnl_pct = float(cell.get("roi", 0.0))

        vol = volume_by_date.get(date_str, 0.0)
        days_out.append({
            "date": date_str,
            "signals": signals_by_date.get(date_str, 0),
            "balance": float(balance) if balance is not None else None,
            "pnl_pct": pnl_pct,
            "trades": 1 if vol > 0 else 0,        # был ли торговый объём за день
            "trade_volume": vol,
            "has_deposit": date_str in deposit_dates,
            "journal_pnl": round(day_pnl, 2),
            "journal_volume": round(float(cell.get("volume", 0.0)), 2),
            "journal_trades": day_trades,
        })

    return {"days": days_out}
