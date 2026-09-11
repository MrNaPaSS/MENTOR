"""Арифметика кэшбэка: деньги, поэтому до последнего знака.

Ошибка здесь стоит реальных денег в одну из сторон: переплатили трейдеру - из
своего кармана, недоплатили - обещание, которое не выполнено.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from core.broker.cashback import (
    NO_CASHBACK,
    Terms,
    Version,
    aggregate,
    first_day,
    report_day,
    report_window,
    split,
    to_decimal,
    version_on,
)

D = Decimal
TERMS = Terms(trader_share=D("0.35"), min_margin=D("0.10"))


# ── раздел комиссии ──────────────────────────────────────────────────────────

def test_own_referral_gets_the_full_share():
    """$800 комиссии, нам пришло $400: трейдеру 35% от его комиссии, NMNH остаток."""
    parts = split(D("800"), D("400"), TERMS)
    assert parts.cashback == D("280")
    assert parts.nmnh == D("120")
    assert not parts.capped


def test_foreign_referral_is_capped_by_margin():
    """С чужого реферала биржа платит 8%: обещанные 35% из своего кармана не платим."""
    parts = split(D("800"), D("64"), Terms(trader_share=D("0.35"), min_margin=D("0.03")))
    assert parts.cashback == D("40")        # 64 - 800 * 0.03
    assert parts.nmnh == D("24")
    assert parts.capped


def test_margin_larger_than_commission_gives_no_cashback():
    parts = split(D("800"), D("64"), Terms(trader_share=D("0.35"), min_margin=D("0.5")))
    assert parts.cashback == D("0")
    assert parts.nmnh == D("64")


def test_disabled_program_keeps_everything():
    parts = split(D("800"), D("400"), NO_CASHBACK)
    assert parts.cashback == D("0")
    assert parts.nmnh == D("400")


def test_no_commission_means_no_cashback():
    """Отрицательная строка - корректировка биржи: трейдеру из неё не платим."""
    assert split(D("800"), D("0"), TERMS).cashback == D("0")
    negative = split(D("800"), D("-5"), TERMS)
    assert negative.cashback == D("0")
    assert negative.nmnh == D("-5")


def test_cashback_rounds_down():
    """Лишняя доля цента трейдеру - из нашего кармана, поэтому только вниз."""
    parts = split(D("0.00000003"), D("1"), Terms(trader_share=D("0.5"), min_margin=D("0")))
    assert parts.cashback == D("0.00000001")


def test_parts_always_add_up_to_commission():
    for fee, commission in ((D("800"), D("400")), (D("800"), D("64")), (D("13.37"), D("1.9"))):
        parts = split(fee, commission, TERMS)
        assert parts.cashback + parts.nmnh == commission


# ── сутки отчёта ─────────────────────────────────────────────────────────────

def _ms(text: str) -> int:
    return int(datetime.fromisoformat(text).timestamp() * 1000)


def test_report_day_follows_utc_plus_8():
    """Сутки WEEX кончаются в 16:00 UTC: по UTC они разрезались бы не там."""
    assert report_day(_ms("2026-09-10T15:59:59+00:00")) == "2026-09-10"
    assert report_day(_ms("2026-09-10T16:00:00+00:00")) == "2026-09-11"


def test_window_starts_at_midnight_utc_plus_8():
    now = datetime(2026, 9, 11, 3, 0, tzinfo=timezone.utc)      # 11:00 по UTC+8
    start, end = report_window(3, now)
    assert start == _ms("2026-09-08T16:00:00+00:00")             # 09.09 00:00 UTC+8
    assert end == _ms("2026-09-11T03:00:00+00:00")
    assert first_day(1, now) == "2026-09-11"
    assert first_day(3, now) == "2026-09-09"


# ── сложение строк отчёта ────────────────────────────────────────────────────

WINDOW = (_ms("2026-09-09T16:00:00+00:00"), _ms("2026-09-11T15:59:59+00:00"))


def test_rows_of_one_trader_and_day_are_summed():
    rows = [
        {"uid": "3066862000", "date": _ms("2026-09-10T01:00:00+00:00"), "fee": "0.6", "commission": "0.3"},
        {"uid": "3066862000", "date": _ms("2026-09-10T02:00:00+00:00"), "fee": "0.4", "commission": "0.2"},
        {"uid": "3066862000", "date": _ms("2026-09-10T17:00:00+00:00"), "fee": "1", "commission": "0.5"},
    ]
    totals = aggregate(rows, *WINDOW)
    assert [(t.day, t.fee, t.commission) for t in totals] == [
        ("2026-09-10", D("1.0"), D("0.5")),
        ("2026-09-11", D("1"), D("0.5")),
    ]


def test_uid_is_reduced_to_digits():
    """В отчёте UID число, а у ученика он мог осесть с буквенным префиксом."""
    rows = [{"uid": " PO 3066862000 ", "date": _ms("2026-09-10T01:00:00+00:00"), "fee": "1", "commission": "1"}]
    assert aggregate(rows, *WINDOW)[0].uid == "3066862000"


def test_rows_outside_window_and_garbage_are_skipped():
    rows = [
        {"uid": "1", "date": _ms("2026-09-01T00:00:00+00:00"), "fee": "9", "commission": "9"},
        {"uid": "2", "date": None, "fee": "9", "commission": "9"},
        {"uid": "", "date": _ms("2026-09-10T01:00:00+00:00"), "fee": "9", "commission": "9"},
        "не строка",
        {"uid": "3066862000", "date": _ms("2026-09-10T01:00:00+00:00"), "fee": "мусор", "commission": "0.5"},
    ]
    totals = aggregate(rows, *WINDOW)
    assert len(totals) == 1
    assert totals[0].fee == D("0")
    assert totals[0].commission == D("0.5")


def test_to_decimal_never_raises():
    assert to_decimal("abc") == D("0")
    assert to_decimal(None) == D("0")
    assert to_decimal("NaN") == D("0")
    assert to_decimal("Infinity") == D("0")
    assert to_decimal("1.25") == D("1.25")


# ── версии условий ───────────────────────────────────────────────────────────

def test_terms_are_taken_from_the_version_of_that_day():
    """Прошлые сутки считаются по тем условиям, что действовали тогда."""
    old = Version("2026-09-01", Terms(D("0.2"), D("0")), ref=1)
    new = Version("2026-09-10", Terms(D("0.35"), D("0.1")), ref=2)
    assert version_on([new, old], "2026-08-31") is None
    assert version_on([new, old], "2026-09-05") == old
    assert version_on([new, old], "2026-09-10") == new


def test_later_version_with_same_date_wins():
    first = Version("2026-09-10", Terms(D("0.2"), D("0")), ref=1)
    second = Version("2026-09-10", Terms(D("0.3"), D("0")), ref=2)
    assert version_on([first, second], "2026-09-10") == second
