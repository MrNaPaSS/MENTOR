"""Сведение разошедшихся записей одного ученика.

Цена ошибки здесь - чужая история в чужом кабинете, поэтому проверяем не только
то, что перенос случился, но и то, что он **не** случается там, где сводить
нельзя: два кабинета с Telegram - это два человека, а не дубль.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.models import (
    AcademyUid,
    Base,
    CoinTransaction,
    ExchangeAccount,
    ScalpWorkspace,
    Student,
)

import merge_students


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as db:
        yield db


def coins(student_id: int, ref: str) -> CoinTransaction:
    return CoinTransaction(student_id=student_id, amount=10, reason="lesson", ref=ref)


def test_old_record_without_telegram_joins_the_live_one(session):
    """Номер один, Telegram есть у второй записи - она и остаётся."""
    old = Student(weex_uid="PO1043261310")          # как записал бот с приставкой
    live = Student(tg_id=474381080, weex_uid="1043261310", username="Alexey")
    session.add_all([old, live])
    session.commit()
    session.add_all([coins(old.id, "старые"), coins(live.id, "новые")])
    session.commit()

    found = merge_students.pairs(session)
    assert [(a.id, b.id) for a, b in found] == [(old.id, live.id)]

    merge_students.merge(session, old, live, apply=True)
    session.commit()

    # История собралась в живом кабинете, лишняя запись ушла.
    moved = session.execute(
        select(CoinTransaction).where(CoinTransaction.student_id == live.id)
    ).scalars().all()
    assert {row.ref for row in moved} == {"старые", "новые"}
    left = session.execute(text("SELECT id FROM students")).scalars().all()
    assert left == [live.id]


def test_two_cabinets_with_telegram_are_left_alone(session):
    """Два Telegram на одном счёте - не дубль. Такое сводить нельзя."""
    first = Student(tg_id=8590579043, weex_uid="6067083524", username="Alex")
    second = Student(tg_id=8423955910, weex_uid="6067083524", username="Maks")
    session.add_all([first, second])
    session.commit()

    assert merge_students.pairs(session) == []
    assert session.get(Student, first.id) is not None
    assert session.get(Student, second.id) is not None


def test_account_of_the_same_exchange_does_not_break_the_merge(session):
    """Счёт той же биржи есть у обеих записей: живой остаётся, лишний уходит.

    Пара «ученик и биржа» в счетах уникальна, и перенос поверх занятой пары
    уронил бы всё сведение на запрете базы.
    """
    old = Student(weex_uid="6322313641")
    live = Student(tg_id=942285735, weex_uid="6322313641", username="maximus")
    session.add_all([old, live])
    session.commit()
    session.add_all(
        [
            ExchangeAccount(
                student_id=old.id,
                exchange="weex",
                api_key_enc="старый",
                secret_enc="s",
                passphrase_enc="p",
            ),
            ExchangeAccount(
                student_id=live.id,
                exchange="weex",
                api_key_enc="живой",
                secret_enc="s",
                passphrase_enc="p",
            ),
            ExchangeAccount(
                student_id=old.id,
                exchange="okx",
                api_key_enc="оксовый",
                secret_enc="s",
                passphrase_enc="p",
            ),
            AcademyUid(student_id=old.id, exchange="okx", uid="551122"),
        ]
    )
    session.commit()

    merge_students.merge(session, old, live, apply=True)
    session.commit()

    rows = {
        row.exchange: row.api_key_enc
        for row in session.execute(
            select(ExchangeAccount).where(ExchangeAccount.student_id == live.id)
        ).scalars()
    }
    assert rows == {"weex": "живой", "okx": "оксовый"}
    assert session.execute(select(AcademyUid)).scalars().one().student_id == live.id


def test_workspace_of_the_extra_record_is_dropped_not_moved(session):
    """Рабочее место у ученика одно: чужое не переносим, а убираем."""
    old = Student(weex_uid="7700")
    live = Student(tg_id=11, weex_uid="7700")
    session.add_all([old, live])
    session.commit()
    session.add_all(
        [
            ScalpWorkspace(student_id=old.id, payload='{"старое": 1}'),
            ScalpWorkspace(student_id=live.id, payload='{"живое": 1}'),
        ]
    )
    session.commit()

    merge_students.merge(session, old, live, apply=True)
    session.commit()

    kept = session.execute(select(ScalpWorkspace)).scalars().all()
    assert len(kept) == 1
    assert kept[0].student_id == live.id
    assert "живое" in kept[0].payload


def test_dry_run_changes_nothing(session):
    old = Student(weex_uid="8800")
    live = Student(tg_id=22, weex_uid="8800")
    session.add_all([old, live])
    session.commit()
    session.add(coins(old.id, "старые"))
    session.commit()

    merge_students.merge(session, old, live, apply=False)
    session.rollback()

    assert session.get(Student, old.id) is not None
    left = session.execute(
        text("SELECT student_id FROM coin_transactions")
    ).scalars().all()
    assert left == [old.id]
