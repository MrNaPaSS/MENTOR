"""Тест синхронизации балансов."""

from decimal import Decimal

import pytest

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from bot.scheduler import sync_balances


@pytest.fixture
def session():
    init_engine("sqlite:///:memory:")
    create_all()
    s = SessionLocal()
    yield s
    s.close()


async def test_sync_updates_balances(session):
    st = repo.get_or_create_student(session, tg_id=1, username="a")
    st.is_approved = True
    st.weex_uid = "123456"
    session.commit()

    weex = get_weex_client(use_mock=True)
    result = await sync_balances(weex)
    assert result["updated"] == 1

    session.refresh(st)
    assert st.balance_usdt is not None
    assert st.balance_source == "affiliate_api"


async def test_sync_fallback_to_manual_when_unavailable(session):
    st = repo.get_or_create_student(session, tg_id=2, username="b")
    st.is_approved = True
    st.weex_uid = "404"  # мок вернёт None
    st.balance_usdt = Decimal("500")
    session.commit()

    weex = get_weex_client(use_mock=True)
    result = await sync_balances(weex)
    assert result["failed"] == 1

    session.refresh(st)
    assert st.balance_usdt == Decimal("500")  # последнее значение сохранено
    assert st.balance_source == "manual"
