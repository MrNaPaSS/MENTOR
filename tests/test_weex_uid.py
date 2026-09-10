"""Опознаватель ученика на бирже: цифры и ничего кроме.

10 сентября ученик №26 остался без баланса и оборота: в базе у него лежало
``PO6067083524``. Партнёрская ручка отвечала на такой ``userId`` отказом
(HTTP 400), а строка оборотов искалась по той же строке с буквами - в отчёте
же UID числом. Журнал писал «оборот не с чего взять», и причину было не видно.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core import repo
from core.db import Base
from core.models import Student
from core.weex.uid import clean_uid, looks_like_uid, uid_variants


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("PO6067083524", "6067083524"),
        ("  6067083524 ", "6067083524"),
        ("UID: 6067083524", "6067083524"),
        ("6067-083-524", "6067083524"),
        ("6067083524", "6067083524"),
        ("", ""),
        (None, ""),
        ("без единой цифры", ""),
    ],
)
def test_uid_is_digits(raw, expected):
    assert clean_uid(raw) == expected


@pytest.mark.parametrize(
    "raw, ok",
    [
        ("PO6067083524", True),
        ("6613031308", True),
        ("999999", True),
        ("12", False),
        ("", False),
        (None, False),
        ("почта@example.com", False),
    ],
)
def test_only_something_uid_shaped_goes_to_the_exchange(raw, ok):
    # Поход с заведомо негодной строкой стоит отказа биржи и места в её
    # счётчике запросов, а в журнале от него остаётся голое «HTTP 400».
    assert looks_like_uid(raw) is ok


def test_variants_keep_the_original_spelling_first():
    # Заведённые раньше лежат в базе с тем написанием, с которым пришли.
    assert uid_variants(" PO6067083524 ") == ["PO6067083524", "6067083524"]
    assert uid_variants("6067083524") == ["6067083524"]
    assert uid_variants("  ") == []


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as one:
        yield one


def test_student_is_found_by_any_spelling_of_the_uid(session):
    """Иначе свой же ученик не находится и рядом заводится второй."""
    session.add(Student(tg_id=1, weex_uid="PO6067083524", is_approved=True))
    session.commit()

    # Как записано.
    assert repo.get_student_by_weex_uid(session, "PO6067083524") is not None
    # Цифрами - так его теперь спрашивает и биржа, и вход в кабинет.
    assert repo.get_student_by_weex_uid(session, "6067083524") is not None
    # Чужой UID своим не становится.
    assert repo.get_student_by_weex_uid(session, "6613031308") is None


def test_a_clean_record_is_found_by_a_dirty_request(session):
    session.add(Student(tg_id=2, weex_uid="6067083524", is_approved=True))
    session.commit()
    assert repo.get_student_by_weex_uid(session, "PO 6067083524") is not None


def test_no_uid_no_student(session):
    session.add(Student(tg_id=3, weex_uid=None, is_approved=True))
    session.commit()
    assert repo.get_student_by_weex_uid(session, "") is None
    assert repo.get_student_by_weex_uid(session, "не цифры") is None


class _Spy:
    """Клиент биржи без сети: помнит, с чем к ней собирались."""

    def __init__(self):
        self.asked: list[dict] = []

    async def _get(self, base, path, params=None, **kw):
        self.asked.append(dict(params or {}))
        return {"data": {"availableBalance": "10"}}


@pytest.mark.asyncio
async def test_the_prefix_is_stripped_before_the_exchange():
    from core.weex.real import RealWeexClient

    client = RealWeexClient.__new__(RealWeexClient)
    spy = _Spy()
    client._get = spy._get  # type: ignore[method-assign]

    assert await RealWeexClient.get_agency_assert(client, "PO6067083524")
    assert spy.asked == [{"userId": "6067083524"}]


@pytest.mark.asyncio
async def test_a_hopeless_uid_never_reaches_the_exchange():
    # Иначе это отказ биржи, место в её счётчике запросов и «HTTP 400» в
    # журнале - строка, по которой ничего не понять.
    from core.weex.real import RealWeexClient

    client = RealWeexClient.__new__(RealWeexClient)
    spy = _Spy()
    client._get = spy._get  # type: ignore[method-assign]

    assert await RealWeexClient.get_agency_assert(client, "почта@example.com") == {}
    assert spy.asked == []
