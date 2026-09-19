"""Приём USDT: разбор логов сети и проход наблюдателя.

Живую сеть эти тесты не заменяют (правило проекта: пока не прошло по
настоящей бирже - не готово), но ловят то, что в живой проверке видно плохо:
восемнадцать знаков, точное сравнение сумм, неподвижный курсор после сбоя узла
и отсутствие дублей среди неопознанных переводов.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.payments import bsc, watcher as payments_watcher
from core.models import ChainCursor, OrphanPayment, PaymentIntent, Student

RECEIVER = "0x12709f1460b62cd979d12ca9b3ee26a72ecf32fc"
# 49.004173 USDT в минимальных единицах BEP-20.
AMOUNT = "49004173000000000000"


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("NMNH_BSC_RECEIVER", RECEIVER)
    url = f"sqlite:///{tmp_path}/pay.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()
    with db_module.SessionLocal() as session:
        yield session


def _log(amount: str, tx: str = "0xfeed", block: int = 100, sender: str = "0x" + "11" * 20) -> dict:
    """Лог Transfer в том виде, в каком его отдаёт узел."""
    return {
        "topics": [
            bsc.TRANSFER_TOPIC,
            "0x" + sender[2:].rjust(64, "0"),
            "0x" + RECEIVER[2:].rjust(64, "0"),
        ],
        "data": f"0x{int(amount):064x}",
        "transactionHash": tx,
        "blockNumber": hex(block),
    }


def _intent(session, *, amount: str = AMOUNT, status: str = "pending", minutes: int = 60) -> PaymentIntent:
    student = Student(tg_id=7, username="ivan")
    session.add(student)
    session.flush()
    intent = PaymentIntent(
        student_id=student.id,
        plan="terminal",
        price_usd=49,
        network=bsc.NETWORK,
        receiver=RECEIVER,
        amount_raw=amount,
        status=status,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=minutes),
    )
    session.add(intent)
    session.commit()
    return intent


def test_usdt_in_bsc_has_eighteen_decimals():
    """Главная грабля сети: 18 знаков, а не 6, как у USDT в Ethereum и TRON."""
    assert bsc.DECIMALS == 18
    assert bsc.format_usdt(AMOUNT) == "49.004173"
    assert bsc.format_usdt(10**18) == "1.000000"
    # С шестью знаками та же сумма выглядела бы как 49 триллионов.
    assert bsc.format_usdt("1000000") != "1.000000"


def test_a_transfer_log_is_read_to_the_last_digit():
    """Сумма из лога совпадает цифра в цифру: её ищут точным сравнением."""
    transfer = bsc._parse_log(_log(AMOUNT, tx="0xABC"))

    assert transfer is not None
    assert transfer.amount_raw == AMOUNT
    assert transfer.tx_hash == "0xabc"
    assert transfer.block == 100
    assert transfer.from_address == "0x" + "11" * 20


def test_a_broken_log_is_skipped_not_fatal():
    """Кривой лог пропускается: один непонятный лог не должен рвать проход."""
    assert bsc._parse_log({"topics": [], "data": "0x1"}) is None
    assert bsc._parse_log("не словарь") is None


def test_unique_amount_keeps_the_price_and_adds_a_tail():
    """Хвост меньше цента: цена узнаётся, а плательщик различается."""
    amounts = {bsc.unique_amount(49) for _ in range(200)}

    assert len(amounts) > 190, "хвост почти не повторяется"
    for raw in amounts:
        assert 49 * 10**18 < int(raw) < 49 * 10**18 + 10**16


def test_the_payment_finds_its_invoice_and_is_handed_over(session, monkeypatch):
    """Сумма совпала - платёж уходит в начисление, курсор двигается."""
    intent = _intent(session)
    seen: list[tuple[str, str]] = []

    async def head():
        return 200

    async def logs(start, finish):
        return (bsc._parse_log(_log(AMOUNT)),)

    monkeypatch.setattr(bsc, "safe_head", head)
    monkeypatch.setattr(bsc, "fetch_transfers", logs)

    watcher = payments_watcher.PaymentWatcher(
        lambda s, found, transfer: seen.append((found.id, transfer.tx_hash))
    )

    async def run():
        return await watcher.tick()

    import asyncio

    assert asyncio.run(run()) == 1
    assert seen == [(intent.id, "0xfeed")]
    session.expire_all()
    assert session.get(ChainCursor, bsc.NETWORK).last_block == 200


def test_a_stranger_payment_is_kept_for_manual_review(session, monkeypatch):
    """Перевод не той суммой - в неопознанные, и второй проход дубля не создаёт."""
    _intent(session)
    stranger = bsc._parse_log(_log("7000000000000000000", tx="0x777"))

    assert payments_watcher.remember_orphan(session, stranger) is True
    assert payments_watcher.remember_orphan(session, stranger) is False
    assert session.query(OrphanPayment).count() == 1
    assert session.get(OrphanPayment, "0x777").amount_raw == "7000000000000000000"


def test_money_that_arrived_after_the_invoice_expired_still_counts(session):
    """Вывод с биржи шёл полтора часа: счёт закрылся, деньги всё равно его."""
    intent = _intent(session, status="expired", minutes=-30)
    transfer = bsc._parse_log(_log(AMOUNT))

    assert payments_watcher.find_intent(session, transfer).id == intent.id


def test_money_that_arrived_a_week_later_goes_to_manual_review(session):
    """Неделю спустя сумма уже ничья: слот давно мог уйти другому."""
    _intent(session, status="expired", minutes=-60 * 24 * 7)
    transfer = bsc._parse_log(_log(AMOUNT))

    assert payments_watcher.find_intent(session, transfer) is None


def test_stale_invoices_lose_their_hold(session):
    """Просроченный счёт освобождает сумму: слотов миллион, но они не вечные."""
    intent = _intent(session, minutes=-1)

    assert payments_watcher.expire_stale(session) == 1
    session.expire_all()
    assert session.get(PaymentIntent, intent.id).status == "expired"


def test_the_cursor_stands_still_when_the_node_is_silent(session, monkeypatch):
    """Узел не ответил - проход пропущен, курсор на месте, следующий догонит."""
    payments_watcher.save_cursor(session, 500)

    async def head():
        raise bsc.RpcError("узел молчит")

    monkeypatch.setattr(bsc, "safe_head", head)
    watcher = payments_watcher.PaymentWatcher(lambda *args: None)

    import asyncio

    assert asyncio.run(watcher.tick()) == 0
    session.expire_all()
    assert session.get(ChainCursor, bsc.NETWORK).last_block == 500


def test_the_cursor_moves_even_with_nothing_to_wait_for(session, monkeypatch):
    """Без ожидающих счетов курсор всё равно идёт - иначе догонять сутки."""
    payments_watcher.save_cursor(session, 1000)

    async def head():
        return 9000

    async def logs(start, finish):
        assert start == 1001 and finish == 1000 + bsc.LOG_SPAN
        return ()

    monkeypatch.setattr(bsc, "safe_head", head)
    monkeypatch.setattr(bsc, "fetch_transfers", logs)

    import asyncio

    asyncio.run(payments_watcher.PaymentWatcher(lambda *args: None).tick())
    session.expire_all()
    assert session.get(ChainCursor, bsc.NETWORK).last_block == 1000 + bsc.LOG_SPAN
