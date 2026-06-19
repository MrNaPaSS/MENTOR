"""NMNH Coin API — начисление и просмотр баланса монет (ТЗ §rewards)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from core.models import CoinTransaction, Student
from backend.deps import get_session, get_current_student
from backend.schemas import CoinsBalance, CoinSyncIn, CoinSyncOut, CoinTxOut

router = APIRouter(prefix="/api/coins", tags=["coins"])

# Сколько монет даётся за каждую редкость достижения
RARITY_COINS: dict[str, int] = {
    "common": 10,
    "rare": 25,
    "epic": 50,
    "legendary": 100,
}

# Монеты за вехи объёма
VOLUME_MILESTONE_COINS: dict[str, int] = {
    "50K":  25,
    "100K": 50,
    "500K": 150,
    "1M":   250,
    "5M":   500,
    "10M":  750,
    "25M":  1500,
}

# Редкость каждого достижения (копия из фронтенда)
ACHIEVEMENT_RARITY: dict[str, str] = {
    "vol_10k":      "common",
    "vol_50k":      "common",
    "vol_100k":     "rare",
    "vol_500k":     "rare",
    "vol_1m":       "epic",
    "vol_5m":       "epic",
    "vol_10m":      "legendary",
    "vol_25m":      "legendary",
    "first_trade":  "common",
    "streak_3":     "common",
    "streak_7":     "rare",
    "streak_14":    "epic",
    "streak_30":    "legendary",
    "days_15":      "rare",
    "days_20":      "epic",
    "days_25":      "legendary",
    "first_profit": "common",
    "profit_5":     "rare",
    "profit_10":    "epic",
    "hot_day_3":    "rare",
    "hot_day_5":    "epic",
    "hot_day_10":   "legendary",
    "month_plus":   "epic",
    "goal_days_10": "epic",
    "dep_first":    "common",
    "dep_500":      "rare",
    "dep_1k":       "rare",
    "dep_5k":       "epic",
    "dep_10k":      "legendary",
    "dep_3plus":    "rare",
    "joined":       "common",
    "level_5":      "rare",
    "level_10":     "epic",
    "level_20":     "legendary",
    "all_goals":    "epic",
    "vol_250k_mo":  "epic",
}


def _tx_to_out(tx: CoinTransaction) -> CoinTxOut:
    return CoinTxOut(
        id=tx.id,
        amount=tx.amount,
        reason=tx.reason,
        ref=tx.ref,
        created_at=tx.created_at.isoformat(),
    )


@router.get("", response_model=CoinsBalance)
def get_coins(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    txs = session.execute(
        select(CoinTransaction)
        .where(CoinTransaction.student_id == student.id)
        .order_by(CoinTransaction.created_at.desc())
        .limit(50)
    ).scalars().all()
    return CoinsBalance(balance=student.coins, transactions=[_tx_to_out(t) for t in txs])


@router.post("/sync", response_model=CoinSyncOut)
def sync_coins(
    body: CoinSyncIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    fresh = session.get(Student, student.id)

    # Уже зачисленные рефы (по типу)
    existing_refs = set(
        session.execute(
            select(CoinTransaction.ref)
            .where(CoinTransaction.student_id == fresh.id)
        ).scalars().all()
    )

    new_txs: list[CoinTransaction] = []

    # Достижения
    for ach_id in body.earned_achievement_ids:
        if ach_id in existing_refs:
            continue
        rarity = ACHIEVEMENT_RARITY.get(ach_id, "common")
        amount = RARITY_COINS[rarity]
        tx = CoinTransaction(
            student_id=fresh.id,
            amount=amount,
            reason="achievement",
            ref=ach_id,
        )
        new_txs.append(tx)

    # Уровни (за каждый уровень до текущего)
    for lvl in range(2, body.current_level + 1):
        ref = f"level_{lvl}"
        if ref in existing_refs:
            continue
        tx = CoinTransaction(
            student_id=fresh.id,
            amount=lvl * 10,
            reason="level_up",
            ref=ref,
        )
        new_txs.append(tx)

    # Вехи объёма
    for milestone_label in body.reached_volume_milestones:
        ref = f"vol_milestone_{milestone_label}"
        if ref in existing_refs:
            continue
        amount = VOLUME_MILESTONE_COINS.get(milestone_label, 0)
        if amount == 0:
            continue
        tx = CoinTransaction(
            student_id=fresh.id,
            amount=amount,
            reason="volume_milestone",
            ref=ref,
        )
        new_txs.append(tx)

    if new_txs:
        session.add_all(new_txs)
        added = sum(t.amount for t in new_txs)
        fresh.coins = (fresh.coins or 0) + added
        session.commit()
        for t in new_txs:
            session.refresh(t)
    else:
        added = 0

    return CoinSyncOut(
        balance=fresh.coins,
        added=added,
        new_transactions=[_tx_to_out(t) for t in new_txs],
    )
