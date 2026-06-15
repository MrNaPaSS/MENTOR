"""Тесты аффилиат-методов WEEX-клиента (моки под подтверждённые схемы)."""

import pytest

from core.weex import get_weex_client


@pytest.fixture
def weex():
    return get_weex_client(use_mock=True)


async def test_affiliate_uids_shape(weex):
    rows = await weex.get_affiliate_uids(0, 0)
    assert len(rows) >= 1
    r = rows[0]
    for k in ("uid", "registerTime", "kycResult", "inviteCode", "firstTrade", "lastDeposit"):
        assert k in r


async def test_channel_trade_asset_shape(weex):
    rows = await weex.get_channel_trade_asset(0, 0)
    r = rows[0]
    for k in ("uid", "depositAmount", "withdrawalAmount", "spotTradingAmount", "futuresTradingAmount", "commission"):
        assert k in r
    assert float(r["depositAmount"]) >= 0


async def test_commission_shape(weex):
    rows = await weex.get_affiliate_commission(0, 0)
    r = rows[0]
    for k in ("uid", "date", "coin", "commission", "productType", "takerAmount"):
        assert k in r


async def test_agency_assert_shape(weex):
    a = await weex.get_agency_assert("3066862172")
    for k in ("availableBalance", "contractTotalUsdt", "depositTotalAmount", "spotProTotalUsdt"):
        assert k in a
    assert float(a["availableBalance"]) >= 0


async def test_check_uid_existence(weex):
    assert await weex.check_uid_existence("3066862172") is True
    assert await weex.check_uid_existence("404") is False
    assert await weex.check_uid_existence("") is False


async def test_uids_match_trade_asset(weex):
    uids = {r["uid"] for r in await weex.get_affiliate_uids(0, 0)}
    trade = {r["uid"] for r in await weex.get_channel_trade_asset(0, 0)}
    assert uids == trade  # один и тот же набор рефералов
