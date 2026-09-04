"""NMNH Coin API — начисление и просмотр баланса монет (ТЗ §rewards)."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from core.models import CoinTransaction, Student
from backend.config import BackendConfig
from backend.deps import get_config, get_session, get_current_student
from backend.schemas import (
    CoinBalanceOut, CoinGrantIn, CoinGrantOut, CoinsBalance, CoinSyncIn, CoinSyncOut,
    CoinTxOut,
)

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

    # ── Учебные достижения (академия) ──
    # Ученик один и тот же, монеты общие: за уроки платим так же, как за торговлю.
    "academy_joined":      "common",     # первый заход в академию
    "module_completed":    "common",     # модуль пройден
    "test_passed":         "rare",       # тест сдан
    "course_completed":    "epic",       # курс целиком
    "verification":        "rare",       # верификация ученика
    "friend_invited":      "rare",       # приглашённый друг дошёл до регистрации
    "friend_verified":     "epic",       # приглашённый друг верифицировался
    "homework_accepted":   "common",     # домашка принята
    "streak_lessons_7":    "rare",       # неделя занятий без пропуска
    "streak_lessons_30":   "legendary",  # месяц занятий без пропуска
}

# Тарифы для служебных начислений из академии. Ключ — reason, а не ref:
# модулей много, событие одно. Если reason незнаком, берётся ставка common.
ACADEMY_REWARDS: dict[str, int] = {
    "academy_joined":    10,
    "module_completed":  15,
    "test_passed":       25,
    "course_completed":  100,
    "verification":      50,
    "friend_invited":    25,
    "friend_verified":   75,
    "homework_accepted": 10,
    "lesson_watched":    5,
}


def academy_amount(reason: str) -> int:
    """Сколько монет положено за учебное событие."""
    if reason in ACADEMY_REWARDS:
        return ACADEMY_REWARDS[reason]
    rarity = ACHIEVEMENT_RARITY.get(reason)
    if rarity:
        return RARITY_COINS[rarity]
    return RARITY_COINS["common"]


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


# ── Служебная ручка для сервера академии ────────────────────────────────────

def require_service_key(
    x_service_key: str = Header(default="", alias="X-Service-Key"),
    config: BackendConfig = Depends(get_config),
) -> None:
    """Пускать только по общему секрету.

    Ходит сервер академии, а не браузер ученика, поэтому JWT здесь не подходит.
    Пустой SERVICE_API_KEY означает, что интеграцию не настраивали — ручку
    в этом случае держим закрытой, иначе любой смог бы начислять себе монеты.
    """
    if not config.service_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Интеграция не настроена: SERVICE_API_KEY не задан",
        )
    if not secrets.compare_digest(x_service_key, config.service_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный служебный ключ")


def find_or_create_student(
    session, *, tg_id: int | None, weex_uid: str | None, username: str | None,
) -> tuple[Student, bool]:
    """Найти ученика по любому из ключей, при отсутствии — завести.

    Человек может пройти половину академии, ни разу не открыв кабинет.
    Начислять монеты всё равно надо, поэтому запись создаём сами; в кабинет
    он войдёт позже по тому же UID и увидит накопленное.
    """
    student = None
    if tg_id is not None:
        student = session.execute(
            select(Student).where(Student.tg_id == tg_id)
        ).scalar_one_or_none()
    if student is None and weex_uid:
        student = session.execute(
            select(Student).where(Student.weex_uid == weex_uid)
        ).scalar_one_or_none()

    if student is not None:
        # Второй ключ мог появиться позже — дописываем, чтобы связка окрепла.
        if tg_id is not None and student.tg_id is None:
            student.tg_id = tg_id
        if weex_uid and not student.weex_uid:
            student.weex_uid = weex_uid
        if username and not student.username:
            student.username = username
        return student, False

    student = Student(
        tg_id=tg_id,
        weex_uid=weex_uid,
        username=username,
        created_via="academy",
        # Доступ к сигналам подтверждает ментор — академия его не выдаёт.
        is_approved=False,
        is_active=True,
    )
    session.add(student)
    session.flush()
    return student, True


@router.post("/grant", response_model=CoinGrantOut, dependencies=[Depends(require_service_key)])
def grant_coins(body: CoinGrantIn, session=Depends(get_session)):
    """Начислить монеты за учебное событие. Повторный вызов с тем же ref — не начисляет."""
    if body.tg_id is None and not body.weex_uid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нужен tg_id или weex_uid",
        )
    if body.amount is not None and body.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "amount должен быть больше нуля")

    student, created = find_or_create_student(
        session,
        tg_id=body.tg_id,
        weex_uid=(body.weex_uid or "").strip() or None,
        username=body.username,
    )

    amount = body.amount if body.amount is not None else academy_amount(body.reason)

    tx = CoinTransaction(
        student_id=student.id,
        amount=amount,
        reason=body.reason[:32],
        ref=body.ref[:64],
    )
    session.add(tx)
    student.coins = (student.coins or 0) + amount

    try:
        session.commit()
    except IntegrityError:
        # Такой ref у этого ученика уже есть — событие пришло повторно.
        # Уникальный индекс ловит и гонку двух одновременных запросов.
        session.rollback()
        fresh = session.get(Student, student.id)
        return CoinGrantOut(
            student_id=fresh.id,
            balance=fresh.coins or 0,
            added=0,
            granted=False,
            student_created=False,
        )

    session.refresh(student)
    return CoinGrantOut(
        student_id=student.id,
        balance=student.coins,
        added=amount,
        granted=True,
        student_created=created,
    )


@router.get(
    "/balance",
    response_model=CoinBalanceOut,
    dependencies=[Depends(require_service_key)],
)
def service_balance(
    tg_id: int | None = None,
    weex_uid: str | None = None,
    session=Depends(get_session),
):
    """Баланс ученика по служебному ключу — для мини-аппа академии.

    У бота нет JWT ученика, поэтому обычная ``GET /api/coins`` ему недоступна.
    Ученика ищем по любому из ключей связки.
    """
    if tg_id is None and not weex_uid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужен tg_id или weex_uid")

    student = None
    if tg_id is not None:
        student = session.execute(
            select(Student).where(Student.tg_id == tg_id)
        ).scalar_one_or_none()
    if student is None and weex_uid:
        student = session.execute(
            select(Student).where(Student.weex_uid == weex_uid.strip())
        ).scalar_one_or_none()

    if student is None:
        # Не 404: для мини-аппа «ещё нет записи» — обычное состояние новичка,
        # а не сбой. Отличить его от найденного ученика даёт поле exists.
        return CoinBalanceOut(exists=False)

    return CoinBalanceOut(
        exists=True,
        student_id=student.id,
        balance=student.coins or 0,
        tg_id=student.tg_id,
        weex_uid=student.weex_uid,
        created_via=student.created_via or "bot",
        first_login_at=student.first_login_at.isoformat() if student.first_login_at else None,
    )
