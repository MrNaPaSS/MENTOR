"""Интеграционный тест потока сигнала: парсинг → резолв → доставка."""

from decimal import Decimal

import pytest

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.parser import parse_signal
from core.settings import DEFAULT_SETTINGS
from core.weex import get_weex_client
from bot.services import signal_service
from bot.delivery import deliver_signal


@pytest.fixture
def session():
    init_engine("sqlite:///:memory:")
    create_all()
    s = SessionLocal()
    repo.seed_settings(s)
    yield s
    s.close()


def _make_student(session, tg_id, username, mode, balance):
    st = repo.get_or_create_student(session, tg_id=tg_id, username=username)
    st.is_approved = True
    st.is_active = True
    st.mode = mode
    st.balance_usdt = Decimal(balance)
    session.commit()
    return st


async def _collect_send():
    sent = []

    async def send(chat_id, text, btn_text, btn_url):
        sent.append((chat_id, text, btn_url))

    return send, sent


async def test_full_flow_sends_to_audience(session):
    _make_student(session, 1, "alex", "moderate", 1240)
    _make_student(session, 2, "sasha", "moderate", 342)
    _make_student(session, 3, "max", "turbo", 180)

    parsed = parse_signal("XLM LONG\nПлечо 20х")
    assert parsed.is_valid

    weex = get_weex_client(use_mock=True)
    settings = repo.load_settings(session)
    resolved = await signal_service.resolve_signal(parsed, weex, settings)
    assert resolved.entry_price > 0

    signal = repo.create_signal(
        session, symbol=resolved.symbol, direction=resolved.direction,
        leverage=resolved.leverage or 20, entry_price=resolved.entry_price,
        entry_type=resolved.entry_type, margin_type=resolved.margin_type,
        target_audience="all", status="active",
    )

    students = repo.audience_students(session, "all")
    send, sent = await _collect_send()
    report = await deliver_signal(
        session, send, signal.id, resolved, students, weex, settings, delay_seconds=0
    )

    assert report.total == 3
    assert len(report.sent) == 3
    assert len(sent) == 3
    # У каждого в тексте своя пара и ссылка на WEEX.
    assert all("XLMUSDT" in text for _, text, _ in sent)
    assert all(url.endswith("/futures/XLMUSDT") for _, _, url in sent)
    # Доставки записаны.
    assert len(signal.deliveries) == 3


async def test_turbo_audience_only(session):
    _make_student(session, 1, "alex", "moderate", 1240)
    _make_student(session, 3, "max", "turbo", 1800)
    parsed = parse_signal("BTC SHORT")
    weex = get_weex_client(use_mock=True)
    settings = repo.load_settings(session)
    resolved = await signal_service.resolve_signal(parsed, weex, settings)
    signal = repo.create_signal(
        session, symbol=resolved.symbol, direction=resolved.direction,
        leverage=100, entry_price=resolved.entry_price, entry_type="market",
        margin_type="cross", target_audience="turbo", status="active",
    )
    students = repo.audience_students(session, "turbo")
    send, sent = await _collect_send()
    report = await deliver_signal(session, send, signal.id, resolved, students, weex, settings, delay_seconds=0)
    assert report.total == 1
    assert report.sent[0][0] == "max"


async def test_low_balance_is_skipped(session):
    # Малый баланс при высоком минимальном ордере → позиция < минимума → skipped, не failed.
    _make_student(session, 9, "tiny", "moderate", Decimal("10"))
    parsed = parse_signal("XLM LONG")

    class HighMinWeex(type(get_weex_client(use_mock=True))):
        async def get_min_order_usd(self, symbol):
            return Decimal("1000")

    weex = HighMinWeex()
    settings = repo.load_settings(session)
    resolved = await signal_service.resolve_signal(parsed, weex, settings)
    signal = repo.create_signal(
        session, symbol=resolved.symbol, direction=resolved.direction, leverage=10,
        entry_price=resolved.entry_price, entry_type="market", margin_type="cross",
        target_audience="all", status="active",
    )
    students = repo.audience_students(session, "all")
    send, sent = await _collect_send()
    report = await deliver_signal(session, send, signal.id, resolved, students, weex, settings, delay_seconds=0)
    assert len(report.skipped) == 1
    assert len(sent) == 0


async def test_delivery_idempotent_on_retry(session):
    st = _make_student(session, 7, "re", "moderate", 1000)
    parsed = parse_signal("ETH LONG")
    weex = get_weex_client(use_mock=True)
    settings = repo.load_settings(session)
    resolved = await signal_service.resolve_signal(parsed, weex, settings)
    signal = repo.create_signal(
        session, symbol=resolved.symbol, direction=resolved.direction, leverage=10,
        entry_price=resolved.entry_price, entry_type="market", margin_type="cross",
        target_audience="all", status="active",
    )
    students = repo.audience_students(session, "all")
    send, _ = await _collect_send()
    await deliver_signal(session, send, signal.id, resolved, students, weex, settings, delay_seconds=0)
    await deliver_signal(session, send, signal.id, resolved, students, weex, settings, delay_seconds=0)
    # Повторная доставка не плодит записи.
    assert len(signal.deliveries) == 1
