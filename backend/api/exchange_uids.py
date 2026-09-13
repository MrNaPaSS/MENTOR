"""Счета на биржах, подтверждённые академией.

Кто пришёл через академию, а кто со своим счётом - решает не сервер и не
ученик, а владелец: человек присылает UID в бот академии, владелец одобряет, и
академия сообщает это сюда. От подтверждения зависят деньги - сниженная
комиссия, кешбэк и полный доступ к терминалу, - поэтому одного слова ученика
мало.

Ходит сервер академии, а не браузер, поэтому проверка та же, что у начисления
монет: общий секрет в заголовке `X-Service-Key`.

Биржи здесь принимаются шире, чем в подключении ключей: академия приводит
учеников на BingX раньше, чем у нас появится её адаптер. Отказать ей значит
потерять подтверждение, а ученику - остаться «своим» на бирже, куда его привела
академия. Торговать на такой бирже всё равно нельзя - это решает `KEY_EXCHANGES`.

Список по каждой названной бирже заменяется целиком: академия знает, какие
счета подтверждены сейчас, и отозванный UID должен исчезать, а не копиться.
Биржи, которых в запросе нет, не трогаем - академия могла прислать только часть.

Отсюда и поле `exchanges`: сказать «по WEEX у ученика больше нет подтверждённых
счетов» списком счетов нельзя - пустой список ничего не называет. Биржи из
`exchanges` очищаются, даже если ни одного счёта по ним не пришло.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.api.coins import find_or_create_student, require_service_key
from backend.deps import get_session
from backend.trading.accounts import access_kind, accounts_of, confirmed_uids
from core.exchanges import known_exchange
from core.models import AcademyUid, utcnow
from core.weex.uid import clean_uid

router = APIRouter(prefix="/api/service/exchange-uids", tags=["service"])
logger = logging.getLogger("nmnh.exchange_uids")


class UidIn(BaseModel):
    """Один подтверждённый счёт."""

    exchange: str = Field(min_length=1, max_length=16)
    uid: str = Field(min_length=1, max_length=64)
    confirmed_at: datetime | None = None


class UidsIn(BaseModel):
    """Кого подтвердили и на каких биржах."""

    tg_id: int | None = None
    weex_uid: str | None = None
    username: str | None = None
    # Двадцати бирж у одного ученика не бывает; предел - от случайной петли на
    # стороне академии.
    items: list[UidIn] = Field(default_factory=list, max_length=20)
    # Биржи, списки которых надо заменить целиком, даже если счетов по ним
    # больше нет. Так академия отзывает подтверждение: без этого поля отзыв
    # последнего счёта на бирже сказать нечем.
    exchanges: list[str] = Field(default_factory=list, max_length=20)


def _student_of(session, body: UidsIn):
    if body.tg_id is None and not body.weex_uid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужен tg_id или weex_uid")
    student, _ = find_or_create_student(
        session,
        tg_id=body.tg_id,
        weex_uid=clean_uid(body.weex_uid) or None,
        username=(body.username or "").strip() or None,
    )
    return student


def _refresh_access(session, student_id: int) -> None:
    """Пересчитать доступ подключённых счетов: подтверждение могли и отозвать."""
    for account in accounts_of(session, student_id):
        account.access = access_kind(
            account.exchange_uid, confirmed_uids(session, student_id, account.exchange)
        )


@router.post("", dependencies=[Depends(require_service_key)])
def confirm(body: UidsIn, session=Depends(get_session)):
    """Записать подтверждённые счета ученика."""
    student = _student_of(session, body)

    wanted: dict[str, set[str]] = {}
    for name in body.exchanges:
        code = known_exchange(name)
        if not code:
            raise HTTPException(422, f"Биржа {name} нам неизвестна")
        wanted.setdefault(code, set())
    for item in body.items:
        code = known_exchange(item.exchange)
        if not code:
            raise HTTPException(422, f"Биржа {item.exchange} нам неизвестна")
        uid = clean_uid(item.uid)
        if not uid:
            raise HTTPException(422, f"UID {item.uid!r} не похож на номер счёта")
        wanted.setdefault(code, set()).add(uid)

    when = {
        (known_exchange(item.exchange), clean_uid(item.uid)): item.confirmed_at
        for item in body.items
    }

    added = removed = 0
    for code, uids in wanted.items():
        have = {
            row.uid: row
            for row in session.execute(
                select(AcademyUid)
                .where(AcademyUid.student_id == student.id)
                .where(AcademyUid.exchange == code)
            ).scalars()
        }
        for uid in uids - have.keys():
            session.add(
                AcademyUid(
                    student_id=student.id,
                    exchange=code,
                    uid=uid,
                    confirmed_at=when.get((code, uid)) or utcnow(),
                )
            )
            added += 1
        for uid, row in have.items():
            if uid not in uids:
                session.delete(row)
                removed += 1

    session.flush()
    _refresh_access(session, student.id)
    session.commit()
    logger.info(
        "Академия подтвердила счета ученика %s: добавлено %d, снято %d",
        student.id,
        added,
        removed,
    )
    return {
        "student_id": student.id,
        "added": added,
        "removed": removed,
        "uids": {code: sorted(uids) for code, uids in wanted.items()},
    }


@router.get("", dependencies=[Depends(require_service_key)])
def listing(tg_id: int | None = None, weex_uid: str | None = None, session=Depends(get_session)):
    """Что мы помним про подтверждённые счета этого ученика."""
    student = _student_of(session, UidsIn(tg_id=tg_id, weex_uid=weex_uid))
    rows = session.execute(
        select(AcademyUid).where(AcademyUid.student_id == student.id)
    ).scalars()
    out: dict[str, list[str]] = {}
    for row in rows:
        out.setdefault(row.exchange, []).append(row.uid)
    return {"student_id": student.id, "uids": {code: sorted(uids) for code, uids in out.items()}}
