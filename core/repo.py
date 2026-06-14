"""Доступ к данным (CRUD) поверх SQLAlchemy-сессии.

Тонкий слой для бота/бэкенда. Все денежные значения хранятся как строки/Decimal в Numeric-полях.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy import select

from core.db import SessionLocal
from core.models import Student, Signal, SignalDelivery, SettingRow, utcnow
from core.settings import Settings, DEFAULT_SETTINGS


# ── Настройки ──

def load_settings(session) -> Settings:
    """Собрать Settings из таблицы settings (поверх дефолтов)."""
    rows = session.execute(select(SettingRow)).scalars().all()
    data = {r.key: r.value for r in rows}
    return Settings.from_mapping(data) if data else DEFAULT_SETTINGS


def seed_settings(session) -> None:
    """Записать дефолтные настройки, если таблица пуста."""
    existing = {r.key for r in session.execute(select(SettingRow)).scalars().all()}
    for key, value in DEFAULT_SETTINGS.as_dict().items():
        if key not in existing:
            session.add(SettingRow(key=key, value=str(value)))
    session.commit()


def update_setting(session, key: str, value) -> None:
    row = session.get(SettingRow, key)
    if row is None:
        session.add(SettingRow(key=key, value=str(value)))
    else:
        row.value = str(value)
    session.commit()


# ── Ученики ──

def get_or_create_student(session, tg_id: int, username: Optional[str] = None) -> Student:
    student = session.execute(
        select(Student).where(Student.tg_id == tg_id)
    ).scalar_one_or_none()
    if student is None:
        student = Student(tg_id=tg_id, username=username, is_approved=False, is_active=True)
        session.add(student)
        session.commit()
    elif username and student.username != username:
        student.username = username
        session.commit()
    return student


def get_student_by_username(session, username: str) -> Optional[Student]:
    username = username.lstrip("@")
    return session.execute(
        select(Student).where(Student.username == username)
    ).scalar_one_or_none()


def list_students(session, only_approved: bool = False, only_active: bool = False) -> list:
    stmt = select(Student)
    if only_approved:
        stmt = stmt.where(Student.is_approved.is_(True))
    if only_active:
        stmt = stmt.where(Student.is_active.is_(True))
    return list(session.execute(stmt).scalars().all())


def audience_students(session, audience: str) -> list:
    """Ученики для рассылки по аудитории: all / moderate / turbo."""
    students = list_students(session, only_approved=True, only_active=True)
    if audience in ("moderate", "turbo"):
        students = [s for s in students if s.mode == audience]
    return students


# ── Сигналы и доставки ──

def create_signal(session, **fields) -> Signal:
    signal = Signal(**fields)
    session.add(signal)
    session.commit()
    return signal


def record_delivery(session, signal_id: int, student_id: int, **fields) -> SignalDelivery:
    """Идемпотентно записать доставку (A-06): по (signal_id, student_id) — обновить или создать."""
    delivery = session.execute(
        select(SignalDelivery).where(
            SignalDelivery.signal_id == signal_id,
            SignalDelivery.student_id == student_id,
        )
    ).scalar_one_or_none()
    if delivery is None:
        delivery = SignalDelivery(signal_id=signal_id, student_id=student_id, **fields)
        session.add(delivery)
    else:
        for key, value in fields.items():
            setattr(delivery, key, value)
    session.commit()
    return delivery


def set_balance(session, student: Student, balance: Optional[Decimal], source: str) -> None:
    student.balance_usdt = balance
    student.balance_source = source
    student.balance_updated_at = utcnow()
    session.commit()


__all__ = [
    "load_settings",
    "seed_settings",
    "update_setting",
    "get_or_create_student",
    "get_student_by_username",
    "list_students",
    "audience_students",
    "create_signal",
    "record_delivery",
    "set_balance",
    "SessionLocal",
]
