"""Приватные потоки в процессе терминала (роль `api`).

Потоки держит сопровождение, и в раздельном режиме оно живёт своим процессом.
Терминал остался бы без них: позиции он спрашивал бы у биржи по нескольку раз
в секунду. Держатель поднимает те же потоки на счетах, где идут сделки, и
гасит их, когда сделок не осталось.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.trading.private_ws import StreamKeeper, live_accounts, sync_streams
from core.db import Base
from core.models import ExchangeAccount, LiveTrade, Student


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    session = sessions()
    student = Student(tg_id=1)
    session.add(student)
    session.commit()
    session.add(
        ExchangeAccount(
            student_id=student.id,
            exchange="okx",
            api_key_enc="k",
            secret_enc="s",
            passphrase_enc="p",
            is_active=True,
        )
    )
    session.commit()
    yield sessions, session, student
    session.close()


def _trade(session, student_id: int, exchange: str, status: str = "open") -> LiveTrade:
    row = LiveTrade(
        student_id=student_id,
        client_id=f"BTCUSDT-{exchange}",
        symbol="BTCUSDT",
        side="long",
        entry=80_000.0,
        initial_stop=79_900.0,
        current_stop=79_900.0,
        qty=0.01,
        leverage=10,
        status=status,
        exchange=exchange,
    )
    session.add(row)
    session.commit()
    return row


class FakeStreams:
    """Вместо соединений с биржей: запоминает, кого подняли и кого закрыли."""

    def __init__(self):
        self.up: set[tuple[int, str]] = set()
        self.kept: list[set] = []

    def has(self, student_id: int, exchange: str) -> bool:
        return (int(student_id), str(exchange)) in self.up

    async def keep(self, accounts: set) -> None:
        self.kept.append(set(accounts))
        self.up &= set(accounts)

    async def ensure(self, row) -> None:
        self.up.add((int(row.student_id), str(row.exchange)))

    async def stop(self) -> None:
        self.up.clear()


def test_accounts_with_trades_are_the_ones_to_stream(db):
    sessions, session, student = db
    assert live_accounts(session) == set()

    _trade(session, student.id, "okx")
    assert live_accounts(session) == {(student.id, "okx")}

    # Закрытая сделка потока не держит: соединение стоит памяти.
    _trade(session, student.id, "mexc", status="closed")
    assert live_accounts(session) == {(student.id, "okx")}


def test_the_stream_goes_up_for_a_live_trade_and_down_after_it(db):
    sessions, session, student = db
    trade = _trade(session, student.id, "okx")
    streams = FakeStreams()

    asyncio.run(sync_streams(streams, sessions, live_accounts(session)))
    assert streams.up == {(student.id, "okx")}

    trade.status = "closed"
    session.commit()
    asyncio.run(sync_streams(streams, sessions, live_accounts(session)))
    assert streams.up == set()


def test_an_account_without_keys_does_not_stop_the_rest(db):
    """Счёта нет в базе - поток не поднять, но круг не должен падать."""
    sessions, session, student = db
    _trade(session, student.id, "bingx")  # ключей BingX у ученика нет
    streams = FakeStreams()

    asyncio.run(sync_streams(streams, sessions, live_accounts(session)))
    assert streams.up == set()


def test_the_keeper_wakes_nobody(db):
    """Сопровождения в этом процессе нет: будить некого, поток только читают."""
    sessions, _session, _student = db

    async def http():
        return None

    keeper = StreamKeeper(sessions, http)
    assert keeper.streams._wake is None


def test_the_keeper_rings_the_terminal(db):
    """Событие биржи уходит в терминал: там оно заменяет опрос."""
    sessions, _session, _student = db
    rung: list[int] = []

    async def http():
        return None

    async def bell(student_id: int) -> None:
        rung.append(student_id)

    keeper = StreamKeeper(sessions, http, bell=bell)
    asyncio.run(keeper.streams._wake(7))  # событие заявки от биржи
    assert rung == [7]


def test_the_keeper_tells_which_exchanges_are_streamed(db):
    """Терминал узнаёт, где поток жив: на остальных биржах он опрашивает как прежде.

    У WEEX приватного потока нет вовсе, и растянуть там опрос молча значило бы
    узнавать об исполнении позже, чем сейчас.
    """
    sessions, _session, student = db
    told: list[tuple[int, tuple[str, ...]]] = []

    async def http():
        return None

    async def streamed(student_id: int, venues: tuple[str, ...]) -> None:
        told.append((student_id, venues))

    keeper = StreamKeeper(sessions, http, streamed=streamed)
    keeper.streams.ready = lambda sid, exchange: exchange == "okx"  # type: ignore[assignment]

    asyncio.run(
        keeper._tell_streamed({(student.id, "okx"), (student.id, "weex")})
    )
    assert told == [(student.id, ("okx",))]

    # То же самое второй раз повторять незачем.
    asyncio.run(keeper._tell_streamed({(student.id, "okx")}))
    assert len(told) == 1

    # Сделка закрылась, поток погас - терминал должен вернуться к частому
    # кругу, иначе он так и будет ждать событий, которых больше нет.
    asyncio.run(keeper._tell_streamed(set()))
    assert told[-1] == (student.id, ())
