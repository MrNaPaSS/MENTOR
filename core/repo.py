"""Доступ к данным (CRUD) поверх SQLAlchemy-сессии.

Тонкий слой для бота/бэкенда. Все денежные значения хранятся как строки/Decimal в Numeric-полях.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy import select

from core.db import SessionLocal
from core.models import (
    AuthCode,
    SettingRow,
    Signal,
    SignalDelivery,
    Student,
    TgAuthCode,
    utcnow,
)
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


def get_student_by_weex_uid(session, weex_uid: str) -> Optional[Student]:
    return session.execute(
        select(Student).where(Student.weex_uid == weex_uid)
    ).scalar_one_or_none()


# ── Коды авторизации (web auth-flow, A-10) ──

def create_auth_code(session, weex_uid: str, code: str, ttl_seconds: int):
    """Создать код входа, удалив прежние для этого UID."""
    from datetime import timedelta

    session.query(AuthCode).filter(AuthCode.weex_uid == weex_uid).delete()
    row = AuthCode(
        weex_uid=weex_uid, code=code,
        expires_at=utcnow() + timedelta(seconds=ttl_seconds),
    )
    session.add(row)
    session.commit()
    return row


def get_active_auth_code(session, weex_uid: str):
    return session.execute(
        select(AuthCode).where(AuthCode.weex_uid == weex_uid)
    ).scalar_one_or_none()


def delete_auth_code(session, weex_uid: str) -> None:
    session.query(AuthCode).filter(AuthCode.weex_uid == weex_uid).delete()
    session.commit()


# ── Одноразовые пароли от бота академии ──

def purge_expired_tg_codes(session) -> int:
    """Убрать протухшие пароли. Возвращает, сколько убрано.

    Зовётся при выдаче нового: своей задачи по расписанию ради уборки заводить
    незачем, а пароли выдают ровно тогда, когда таблица и растёт.
    """
    removed = (
        session.query(TgAuthCode)
        .filter(TgAuthCode.expires_at < utcnow())
        .delete(synchronize_session=False)
    )
    return int(removed or 0)


def active_tg_code(session, tg_id: int) -> TgAuthCode | None:
    """Живой пароль этого ученика, если он ещё не истёк и не был предъявлен."""
    now = utcnow()
    return session.execute(
        select(TgAuthCode)
        .where(TgAuthCode.tg_id == tg_id)
        .where(TgAuthCode.used_at.is_(None))
        .where(TgAuthCode.expires_at > now)
        .order_by(TgAuthCode.expires_at.desc())
    ).scalars().first()


def create_tg_code(session, tg_id: int, code_hash: str, ttl_seconds: int) -> TgAuthCode:
    """Записать новый пароль ученика.

    Прежние его пароли гасим: живым остаётся один, иначе «тот же пароль при
    повторном запросе» превращается в «любой из выданных за десять минут».
    """
    from datetime import timedelta

    purge_expired_tg_codes(session)
    session.query(TgAuthCode).filter(TgAuthCode.tg_id == tg_id).delete(
        synchronize_session=False
    )
    row = TgAuthCode(
        tg_id=tg_id,
        code_hash=code_hash,
        expires_at=utcnow() + timedelta(seconds=ttl_seconds),
    )
    session.add(row)
    session.commit()
    return row


def take_tg_code(session, code_hash: str) -> int | None:
    """Погасить пароль и вернуть, чей он. `None` - не подошёл.

    Гашение идёт условием внутри самого UPDATE, а не проверкой в коде: два
    одновременных запроса с одним паролем прошли бы проверку оба, и токены
    получили бы двое. Условие `used_at IS NULL` в WHERE отдаёт строку ровно
    одному - второму база ответит «изменено 0 строк».
    """
    now = utcnow()
    row = session.execute(
        select(TgAuthCode).where(TgAuthCode.code_hash == code_hash)
    ).scalars().first()
    if row is None:
        return None

    changed = (
        session.query(TgAuthCode)
        .filter(TgAuthCode.id == row.id)
        .filter(TgAuthCode.used_at.is_(None))
        .filter(TgAuthCode.expires_at > now)
        .update({TgAuthCode.used_at: now}, synchronize_session=False)
    )
    if not changed:
        # Пароль есть, но уже мёртв: истёк или предъявлен. Считаем это ошибкой
        # ввода - по счётчику видно, что по чужому паролю кто-то стучится.
        session.query(TgAuthCode).filter(TgAuthCode.id == row.id).update(
            {TgAuthCode.attempts: TgAuthCode.attempts + 1}, synchronize_session=False
        )
        session.commit()
        return None

    tg_id = int(row.tg_id)
    session.commit()
    return tg_id


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
    "create_tg_code",
    "take_tg_code",
    "active_tg_code",
    "purge_expired_tg_codes",
    "SessionLocal",
]
