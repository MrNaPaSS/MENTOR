"""Календарь аналитики: процент дня - доход от залога закрытых сделок.

Число в клетке - деньги, и ученик судит по нему о своей работе. Оно прошло две
ошибки. Сперва бралось разностью соседних снимков баланса: снимок пишется раз в
сутки и в течение дня не меняется, поэтому сегодняшняя клетка стояла нулём при
любом числе закрытых сделок. Потом - прибылью журнала от баланса: формула стала
честной, но знаменатель приходит с биржи, и у ученика с несвежим снимком она
давала +266% за день.

Теперь это сумма процентов закрытых сделок - тех самых, что стоят на их
карточках: три сделки на +12%, +21% и +5% дают в день +38%.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.config import BackendConfig
from backend.main import create_app
from core.weex import get_weex_client
from core.db import SessionLocal
from core.models import BalanceSnapshot, ScalpTrade
from core import repo


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/cal.sqlite3")
    monkeypatch.setenv("MENTOR_PASSWORD", "secret")
    config = BackendConfig(
        jwt_secret="test-secret", access_ttl_seconds=900, refresh_ttl_seconds=86400,
        weex_use_mock=True, code_ttl_seconds=300, max_code_attempts=5, expose_codes=True,
        uid_login_enabled=True,
    )
    app = create_app(config=config, weex=get_weex_client(use_mock=True))
    return TestClient(app)


def _student(client, uid="123456"):
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=int(uid), username="alex")
        st.weex_uid = uid
        st.is_approved = True
        st.balance_usdt = Decimal("1000")
        s.commit()
        sid = st.id
    code = client.post("/api/auth/request-code", json={"weex_uid": uid}).json()["code"]
    tokens = client.post("/api/auth/verify", json={"weex_uid": uid, "code": code}).json()
    return sid, {"Authorization": f"Bearer {tokens['access_token']}"}


def _snapshot(student_id: int, date: str, balance: str) -> None:
    with SessionLocal() as s:
        s.add(BalanceSnapshot(student_id=student_id, date=date, balance_usdt=Decimal(balance)))
        s.commit()


def _trade(
    student_id: int,
    closed: datetime,
    pnl: str,
    client_id: str,
    margin: str = "100",
    qty: str = "0.01",
    entry: str = "79000",
    exit_price: str | None = "78500",
) -> None:
    with SessionLocal() as s:
        s.add(ScalpTrade(
            student_id=student_id, client_id=client_id, symbol="BTCUSDT", side="short",
            entry=Decimal(entry), stop=Decimal("80000"),
            exit_price=None if exit_price is None else Decimal(exit_price),
            qty=Decimal(qty), margin=Decimal(margin), leverage=20,
            outcome="take", pnl=Decimal(pnl), closed_at=closed,
        ))
        s.commit()


def _cal(client, headers, year: int, month: int) -> dict[str, dict]:
    r = client.get(f"/api/analytics/calendar?year={year}&month={month}", headers=headers)
    assert r.status_code == 200
    return {d["date"]: d for d in r.json()["days"]}


# Прошлый месяц целиком, чтобы дни не упирались в «не позже сегодня».
_PAST = datetime.now(timezone.utc).replace(day=1) - timedelta(days=1)
_Y, _M = _PAST.year, _PAST.month


def test_day_percent_comes_from_journal(ctx):
    """Сделки дня видны в тот же день, а не назавтра."""
    client = ctx
    sid, h = _student(client)
    # Баланс на начало дня один и тот же оба дня: биржа о сделках терминала
    # молчит. Первая версия этого числа именно поэтому и давала ноль.
    _snapshot(sid, f"{_Y:04d}-{_M:02d}-10", "1000")
    _snapshot(sid, f"{_Y:04d}-{_M:02d}-11", "1000")
    _trade(sid, datetime(_Y, _M, 11, 9, 0, tzinfo=timezone.utc), "50", "t1", margin="100")
    _trade(sid, datetime(_Y, _M, 11, 10, 0, tzinfo=timezone.utc), "-20", "t2", margin="100")

    days = _cal(client, h, _Y, _M)
    # +50% и -20% на своих залогах дают в день +30%.
    assert days[f"{_Y:04d}-{_M:02d}-11"]["pnl_pct"] == pytest.approx(30.0)
    assert days[f"{_Y:04d}-{_M:02d}-11"]["journal_pnl"] == pytest.approx(30.0)
    assert days[f"{_Y:04d}-{_M:02d}-11"]["journal_trades"] == 2
    # Соседний день сделок не забирает.
    assert days[f"{_Y:04d}-{_M:02d}-10"]["pnl_pct"] == pytest.approx(0.0)


def test_day_percent_is_the_sum_of_trade_percents(ctx):
    """День - сумма процентов сделок, а не общий доход на общий залог.

    Это разные числа, когда залоги разные, и ученик видел на карточках именно
    первые. Здесь +12%, +21% и +5% при залогах 100, 200 и 400: сумма даёт 38%,
    а взвешивание по залогу - 11%, число, которого он нигде не встречал.
    """
    client = ctx
    sid, h = _student(client)
    at = datetime(_Y, _M, 20, 9, 0, tzinfo=timezone.utc)
    _trade(sid, at, "12", "t1", margin="100")
    _trade(sid, at, "42", "t2", margin="200")
    _trade(sid, at, "20", "t3", margin="400")

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-20"]["pnl_pct"] == pytest.approx(38.0)


def test_percent_does_not_depend_on_balance(ctx):
    """Баланс на процент не влияет вовсе.

    Он приходит с биржи снимком раз в сутки, и у ученика с несвежим снимком
    делил дневную прибыль на чужую цифру: +474 на депозит в 177 давали +266%
    за день. Считаем от залога сделки - его знает сам журнал.
    """
    client = ctx
    sid, h = _student(client)
    _snapshot(sid, f"{_Y:04d}-{_M:02d}-11", "177.80")
    _trade(sid, datetime(_Y, _M, 11, 9, 0, tzinfo=timezone.utc), "474.15", "t1", margin="500")

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-11"]["pnl_pct"] == pytest.approx(94.83)


def test_day_without_trades_is_zero_not_balance_drift(ctx):
    """День без сделок - ноль, даже если баланс на бирже сдвинулся."""
    client = ctx
    sid, h = _student(client)
    _snapshot(sid, f"{_Y:04d}-{_M:02d}-10", "1000")
    _snapshot(sid, f"{_Y:04d}-{_M:02d}-11", "1200")  # пополнение, а не торговля

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-11"]["pnl_pct"] == pytest.approx(0.0)


def test_first_day_of_month_counts_like_any_other(ctx):
    """Первое число - обычный день.

    Раньше первый день со снимком получал ровно 0% флагом, и на первое число
    каждого месяца в календаре стоял ноль независимо от работы.
    """
    client = ctx
    sid, h = _student(client)
    _trade(sid, datetime(_Y, _M, 1, 12, 0, tzinfo=timezone.utc), "25", "t1", margin="500")

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-01"]["pnl_pct"] == pytest.approx(5.0)


def test_day_needs_no_snapshot_at_all(ctx):
    """Снимка баланса нет - процент всё равно есть.

    Раньше без него делить было не на что и клетка оставалась пустой, хотя
    сделки за день были и итог по ним известен.
    """
    client = ctx
    sid, h = _student(client)
    _trade(sid, datetime(_Y, _M, 5, 12, 0, tzinfo=timezone.utc), "25", "t1", margin="250")

    days = _cal(client, h, _Y, _M)
    cell = days[f"{_Y:04d}-{_M:02d}-05"]
    assert cell["pnl_pct"] == pytest.approx(10.0)
    assert cell["journal_pnl"] == pytest.approx(25.0)
    assert cell["balance"] is None


def test_trade_without_margin_gives_zero_not_infinity(ctx):
    """Залога нет - процентов тоже, а не бесконечность.

    Так же считает и карточка одной сделки: делить на ноль здесь нечего.
    """
    client = ctx
    sid, h = _student(client)
    _trade(sid, datetime(_Y, _M, 6, 12, 0, tzinfo=timezone.utc), "25", "t1", margin="0")

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-06"]["pnl_pct"] == pytest.approx(0.0)


def test_day_volume_counts_both_legs(ctx):
    """Оборот дня - вход и выход каждой сделки.

    Биржа считает оборотом каждое исполнение, а круг из входа и выхода - это
    два исполнения. Считаем так же, иначе вехи объёма окажутся вдвое дальше,
    чем на самой бирже.
    """
    client = ctx
    sid, h = _student(client)
    _trade(
        sid, datetime(_Y, _M, 12, 9, 0, tzinfo=timezone.utc), "50", "t1",
        qty="2", entry="100", exit_price="110",
    )

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-12"]["journal_volume"] == pytest.approx(420.0)


def test_open_trade_counts_the_leg_it_has(ctx):
    """Выхода ещё нет - считаем вход, а не ноль."""
    client = ctx
    sid, h = _student(client)
    _trade(
        sid, datetime(_Y, _M, 13, 9, 0, tzinfo=timezone.utc), "0", "t1",
        qty="2", entry="100", exit_price=None,
    )

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-13"]["journal_volume"] == pytest.approx(200.0)


def test_quiet_day_has_no_volume(ctx):
    """День без сделок - ноль оборота, а не пропуск."""
    client = ctx
    sid, h = _student(client)
    _trade(sid, datetime(_Y, _M, 14, 9, 0, tzinfo=timezone.utc), "10", "t1")

    days = _cal(client, h, _Y, _M)
    assert days[f"{_Y:04d}-{_M:02d}-15"]["journal_volume"] == pytest.approx(0.0)
