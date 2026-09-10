"""Монеты NMNH за результат сделки.

Плюсовая сделка приносит монеты, минусовая их отнимает, серия плюсов сверх
того даёт бонус. Смысл не в награде за прибыль как таковую: монета - цена
дисциплины, поэтому серия из трёх аккуратных сделок стоит дороже одной
крупной, а слитая сделка стоит денег.

Начисляем только по сделкам, подтверждённым биржей (`from_exchange`).
Терминал пишет сделку сразу, своей оценкой, чтобы она не пропала при обрыве
связи, и этой оценкой распоряжается клиент: принимать её за основание для
выплаты значит раздать монеты каждому, кто откроет консоль браузера. Настоящие
числа приходят следом с биржи - вот они и считаются.

Повторное начисление невозможно по устройству: идентификатор сделки становится
`ref` транзакции, а на паре «ученик + ref» в базе стоит уникальный индекс.
Пересчёт журнала, повторная доставка отчёта и одновременная запись из двух мест
упрутся в него, а не удвоят баланс.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.models import CoinTransaction, ScalpTrade, Student, utcnow

logger = logging.getLogger("nmnh.trading.rewards")

# ── Ставки ──────────────────────────────────────────────────────────────────
#
# Для масштаба: недельная подписка в магазине стоит 300 монет, месячная 1000.
# Месяц ровной работы окупает подписку, месяц слива - нет, и это то
# соотношение, которое нужно.

# Сколько монет приносит закрытие в плюс.
WIN_COINS = 10

# Сколько снимается за убыток. Меньше, чем даётся за плюс, намеренно: цель -
# чтобы слив ощущался, а не чтобы человек боялся открыть сделку.
LOSS_COINS = 5

# Бонус за серию плюсовых подряд: длина серии -> сколько монет сверх обычных.
# Ступени редкие и растущие - за десять подряд платится больше, чем за три
# серии по три, потому что удержать десять несравнимо труднее.
STREAK_BONUS: dict[int, int] = {3: 15, 5: 30, 10: 100}

# Сделки меньше этого объёма (цена входа * количество) не считаются вовсе.
# Без порога монеты фармятся сделками на доллар: открыл, закрыл в плюс на цент,
# получил десять монет.
MIN_NOTIONAL = 20.0

# Потолок начислений за сутки. Ограничивает не торговлю, а выгоду от неё:
# набить норму можно и честно, но дальше монеты за день не идут.
DAILY_EARN_CAP = 150

# Сколько последних сделок смотрим, считая серию. Глубже десятой ступени
# бонусов нет, поэтому и заглядывать дальше незачем.
STREAK_LOOKBACK = 20

REASON_WIN = "trade_win"
REASON_LOSS = "trade_loss"
REASON_STREAK = "trade_streak"


def award_trade_coins(session, trade: ScalpTrade) -> int:
    """Начислить или снять монеты за закрытую сделку.

    Возвращает изменение баланса: положительное за плюсовую сделку с бонусом,
    отрицательное за убыток, ноль - если сделка не подходит под правила или
    уже была учтена.

    Транзакции добавляются в переданную сессию, коммит остаётся за вызывающим:
    начисление обязано попасть в базу той же операцией, что и сама сделка,
    иначе найдётся способ получить монеты за сделку, которой нет.
    """
    if not getattr(trade, "from_exchange", False):
        return 0

    # Сделка без ученика или без идентификатора - не сделка: начислять некому
    # и не за что, а `ref` без идентификатора совпал бы у всех записей разом.
    student_id = getattr(trade, "student_id", None)
    client_id = getattr(trade, "client_id", None)
    if student_id is None or not client_id:
        return 0

    pnl = float(trade.pnl or 0)
    if pnl == 0:
        # Ноль в ноль - не победа и не поражение. Такое бывает при закрытии
        # руками сразу после входа, и платить тут не за что.
        return 0

    if _notional(trade) < MIN_NOTIONAL:
        return 0

    ref = f"trade_{client_id}"
    if _already_counted(session, student_id, ref):
        return 0

    student = session.get(Student, student_id)
    if student is None:
        return 0

    if pnl < 0:
        return _apply(session, student, [(REASON_LOSS, ref, -LOSS_COINS)])

    # Плюс: обычное начисление и, если серия дотянула до ступени, бонус.
    entries: list[tuple[str, str, int]] = [(REASON_WIN, ref, WIN_COINS)]

    streak = _win_streak(session, trade)
    bonus = STREAK_BONUS.get(streak, 0)
    if bonus:
        entries.append((REASON_STREAK, f"streak_{client_id}_{streak}", bonus))

    earned_today = _earned_today(session, student.id)
    room = max(0, DAILY_EARN_CAP - earned_today)
    if room == 0:
        logger.info("Монеты за сделку %s не начислены: дневной потолок", client_id)
        return 0

    # Потолок режет последнюю запись, а не отменяет всё: половина бонуса
    # честнее, чем молчаливый ноль после серии из десяти.
    trimmed: list[tuple[str, str, int]] = []
    left = room
    for reason, entry_ref, amount in entries:
        if left <= 0:
            break
        take = min(amount, left)
        trimmed.append((reason, entry_ref, take))
        left -= take

    return _apply(session, student, trimmed)


def _notional(trade: ScalpTrade) -> float:
    """Объём сделки в долларах: по нему решается, считать её вообще или нет."""
    try:
        return abs(float(trade.entry or 0) * float(trade.qty or 0))
    except (TypeError, ValueError):
        return 0.0


def _already_counted(session, student_id: int, ref: str) -> bool:
    return session.execute(
        select(CoinTransaction.id)
        .where(CoinTransaction.student_id == student_id)
        .where(CoinTransaction.ref == ref)
        .limit(1)
    ).scalar_one_or_none() is not None


def _earned_today(session, student_id: int) -> int:
    """Сколько монет за сделки уже начислено с начала суток.

    Считаются только начисления, снятия за убыток в потолок не входят: он
    ограничивает выгоду, а не наказание.
    """
    since = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = session.execute(
        select(CoinTransaction.amount)
        .where(CoinTransaction.student_id == student_id)
        .where(CoinTransaction.reason.in_((REASON_WIN, REASON_STREAK)))
        .where(CoinTransaction.created_at >= since)
    ).scalars().all()
    return sum(int(a) for a in rows if a and int(a) > 0)


def _win_streak(session, trade: ScalpTrade) -> int:
    """Длина серии плюсовых сделок, оканчивающейся этой.

    Считается по журналу, а не по счётчику в профиле: счётчик пришлось бы
    чинить руками после каждого пересчёта журнала, а журнал - это и есть
    история, по которой серия определена однозначно.
    """
    session.flush()

    rows = session.execute(
        select(ScalpTrade.pnl, ScalpTrade.closed_at, ScalpTrade.client_id)
        .where(ScalpTrade.student_id == trade.student_id)
        .where(ScalpTrade.from_exchange.is_(True))
        .where(ScalpTrade.closed_at <= trade.closed_at)
        .order_by(ScalpTrade.closed_at.desc(), ScalpTrade.id.desc())
        .limit(STREAK_LOOKBACK)
    ).all()

    streak = 0
    for pnl, _closed_at, _client_id in rows:
        if float(pnl or 0) > 0:
            streak += 1
        else:
            break
    return streak


def _apply(session, student: Student, entries: list[tuple[str, str, int]]) -> int:
    """Записать транзакции и подвинуть баланс.

    Баланс не уходит в минус: долг по монетам нечем отдать, а отрицательное
    число на витрине магазина не значит ничего, кроме сломанного экрана.
    """
    if not entries:
        return 0

    delta = 0
    for reason, ref, amount in entries:
        if amount == 0:
            continue
        session.add(
            CoinTransaction(
                student_id=student.id,
                amount=amount,
                reason=reason,
                ref=ref,
            )
        )
        delta += amount

    if delta == 0:
        return 0

    balance = int(student.coins or 0)
    student.coins = max(0, balance + delta)
    # Если списание упёрлось в ноль, в истории останется полная сумма, а
    # баланс просто не уйдёт ниже. Правдой считается баланс.
    applied = student.coins - balance

    try:
        session.flush()
    except IntegrityError:
        # Ту же сделку успели учесть парой строк выше по стеку или в соседнем
        # процессе: уникальный индекс на «ученик + ref» сработал как задумано.
        session.rollback()
        logger.info("Монеты за сделку уже начислены другим потоком, пропускаем")
        return 0

    return applied
