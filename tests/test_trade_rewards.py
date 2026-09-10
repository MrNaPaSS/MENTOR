"""Монеты NMNH за результат сделки.

Проверяем не «функция что-то вернула», а сам баланс: монета в этой системе -
валюта, за неё покупают подписку и менторство, и лишняя сотня у одного ученика
означает товар, за который никто не заплатил.

Награда за плюс не падает в баланс сама, а ждёт получения. Поэтому начисления
проверяются по ожиданию, а итог - по балансу после «Забрать».

Отдельный вес здесь у отрицательных проверок: начисление только с биржи,
только выше порога объёма и только один раз на сделку. Каждая из них закрывает
свой способ получить монеты даром.
"""

from datetime import timedelta

import pytest

from core.models import CoinTransaction, ScalpTrade, Student, utcnow


@pytest.fixture
def db(tmp_path, monkeypatch):
    """Пустая база на каждый тест: монеты - штука накопительная, и остаток от
    прошлого теста означал бы разный результат при разном порядке запуска.

    Движок переключается через init_engine, а не перезагрузкой модуля: модели
    привязаны к Base, который живёт в нём же, и после reload они оказались бы
    зарегистрированы в старой метаданной, а таблицы создались бы в новой -
    пустой.
    """
    url = f"sqlite:///{tmp_path}/rewards.sqlite3"
    monkeypatch.setenv("DATABASE_URL", url)

    from core import db as db_module

    db_module.init_engine(url)
    db_module.create_all()

    from backend.trading import rewards as rewards_module

    return db_module, rewards_module


def _student(session, coins: int = 0) -> Student:
    student = Student(tg_id=1, username="alex", coins=coins)
    session.add(student)
    session.flush()
    return student


def _waiting(session, student: Student) -> int:
    """Сколько ждёт получения: награды минус долги."""
    from backend import coin_ledger

    return sum(t.amount for t in coin_ledger.pending_of(session, student.id))


def _claim(session, student: Student) -> int:
    from backend import coin_ledger

    result = coin_ledger.claim_all(session, student.id)
    session.commit()
    return result.balance


def _trade(
    session,
    student: Student,
    *,
    pnl: float,
    client_id: str,
    from_exchange: bool = True,
    entry: float = 100.0,
    qty: float = 1.0,
    minutes_ago: int = 0,
) -> ScalpTrade:
    trade = ScalpTrade(
        student_id=student.id,
        client_id=client_id,
        symbol="BTCUSDT",
        side="long",
        entry=entry,
        stop=entry * 0.99,
        exit_price=entry * 1.01,
        qty=qty,
        margin=10.0,
        leverage=10,
        takes_hit=1,
        outcome="take" if pnl > 0 else "stop",
        pnl=pnl,
        fee=0.1,
        closed_at=utcnow() - timedelta(minutes=minutes_ago),
        from_exchange=from_exchange,
    )
    session.add(trade)
    session.flush()
    return trade


def test_плюсовая_сделка_ставит_награду_в_ожидание(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        trade = _trade(session, student, pnl=12.5, client_id="t1")

        delta = rewards.award_trade_coins(session, trade)
        session.commit()

        assert delta == rewards.WIN_COINS
        # До получения тратить нечего.
        assert session.get(Student, student.id).coins == 0
        assert _waiting(session, student) == rewards.WIN_COINS
        assert _claim(session, student) == rewards.WIN_COINS


def test_убыточная_сделка_снимает_монеты(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=100)
        trade = _trade(session, student, pnl=-4.0, client_id="t1")

        delta = rewards.award_trade_coins(session, trade)
        session.commit()

        assert delta == -rewards.LOSS_COINS
        assert session.get(Student, student.id).coins == 100 - rewards.LOSS_COINS
        assert _waiting(session, student) == 0


def test_баланс_не_уходит_в_минус_а_недостача_ждёт_долгом(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=2)
        trade = _trade(session, student, pnl=-4.0, client_id="t1")

        rewards.award_trade_coins(session, trade)
        session.commit()

        # Списание больше остатка обнуляет баланс, а не делает его должником.
        assert session.get(Student, student.id).coins == 0
        # Но недостача не прощена: она вычтется из следующей награды.
        assert _waiting(session, student) == -(rewards.LOSS_COINS - 2)

        win = _trade(session, student, pnl=3.0, client_id="t2")
        rewards.award_trade_coins(session, win)
        session.commit()
        assert _claim(session, student) == rewards.WIN_COINS - (rewards.LOSS_COINS - 2)


def test_ожидающие_награды_не_защищают_от_списания(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)

        # Плюс не забран, баланс ноль. Слив обязан уменьшить то, что придёт.
        rewards.award_trade_coins(session, _trade(session, student, pnl=3.0, client_id="w1", minutes_ago=5))
        rewards.award_trade_coins(session, _trade(session, student, pnl=-3.0, client_id="l1"))
        session.commit()

        assert _claim(session, student) == rewards.WIN_COINS - rewards.LOSS_COINS


def test_одна_сделка_начисляется_один_раз(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        trade = _trade(session, student, pnl=5.0, client_id="t1")

        first = rewards.award_trade_coins(session, trade)
        session.commit()
        second = rewards.award_trade_coins(session, trade)
        session.commit()

        assert first == rewards.WIN_COINS
        assert second == 0
        assert _waiting(session, student) == rewards.WIN_COINS


def test_убыток_на_пустом_балансе_учитывается_один_раз(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        trade = _trade(session, student, pnl=-5.0, client_id="t1")

        rewards.award_trade_coins(session, trade)
        session.commit()
        assert rewards.award_trade_coins(session, trade) == 0
        session.commit()

        assert _waiting(session, student) == -rewards.LOSS_COINS


def test_сделка_с_экрана_монет_не_даёт(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        # Такую запись присылает браузер до того, как придут числа биржи.
        # Верить ей нельзя: содержимое запроса выбирает клиент.
        trade = _trade(session, student, pnl=999.0, client_id="t1", from_exchange=False)

        assert rewards.award_trade_coins(session, trade) == 0
        session.commit()
        assert session.get(Student, student.id).coins == 0
        assert _waiting(session, student) == 0


def test_копеечная_сделка_не_считается(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)
        # Объём в один доллар: так фармят монеты, а не торгуют.
        trade = _trade(session, student, pnl=0.01, client_id="t1", entry=1.0, qty=1.0)

        assert rewards.award_trade_coins(session, trade) == 0
        session.commit()
        assert _waiting(session, student) == 0


def test_сделка_в_ноль_ничего_не_меняет(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=50)
        trade = _trade(session, student, pnl=0.0, client_id="t1")

        assert rewards.award_trade_coins(session, trade) == 0
        session.commit()
        assert session.get(Student, student.id).coins == 50
        assert _waiting(session, student) == 0


def test_серия_из_трёх_плюсов_даёт_бонус(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)

        for i in range(3):
            trade = _trade(
                session, student, pnl=3.0, client_id=f"t{i}", minutes_ago=30 - i * 10
            )
            rewards.award_trade_coins(session, trade)
        session.commit()

        expected = rewards.WIN_COINS * 3 + rewards.STREAK_BONUS[3]
        assert _waiting(session, student) == expected

        bonus = session.query(CoinTransaction).filter_by(
            student_id=student.id, reason=rewards.REASON_STREAK
        ).all()
        assert len(bonus) == 1
        assert bonus[0].amount == rewards.STREAK_BONUS[3]
        assert bonus[0].pending is True


def test_убыток_обрывает_серию(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session, coins=100)

        # Два плюса, минус, ещё два плюса: до ступени в три подряд ни одна из
        # половин не дотягивает, бонуса быть не должно.
        plan = [(3.0, 50), (3.0, 40), (-3.0, 30), (3.0, 20), (3.0, 10)]
        for i, (pnl, ago) in enumerate(plan):
            trade = _trade(session, student, pnl=pnl, client_id=f"t{i}", minutes_ago=ago)
            rewards.award_trade_coins(session, trade)
        session.commit()

        bonus = session.query(CoinTransaction).filter_by(
            student_id=student.id, reason=rewards.REASON_STREAK
        ).all()
        assert bonus == []

        expected = 100 + rewards.WIN_COINS * 4 - rewards.LOSS_COINS
        assert _claim(session, student) == expected


def test_дневной_потолок_ограничивает_начисления(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)

        # Сделок нарочно больше, чем помещается в дневной потолок.
        count = (rewards.DAILY_EARN_CAP // rewards.WIN_COINS) + 5
        for i in range(count):
            trade = _trade(
                session, student, pnl=2.0, client_id=f"t{i}", minutes_ago=count - i
            )
            rewards.award_trade_coins(session, trade)
        session.commit()

        # Потолок считает и незабранное: иначе его обходили бы, не забирая.
        assert _waiting(session, student) == rewards.DAILY_EARN_CAP


def test_потолок_не_мешает_списанию_за_убыток(db):
    db_module, rewards = db
    with db_module.SessionLocal() as session:
        student = _student(session)

        count = (rewards.DAILY_EARN_CAP // rewards.WIN_COINS) + 5
        for i in range(count):
            trade = _trade(
                session, student, pnl=2.0, client_id=f"w{i}", minutes_ago=count - i
            )
            rewards.award_trade_coins(session, trade)

        loss = _trade(session, student, pnl=-2.0, client_id="loss")
        delta = rewards.award_trade_coins(session, loss)
        session.commit()

        # Потолок ограничивает выгоду, а не наказание: минус проходит всегда.
        assert delta == -rewards.LOSS_COINS
        assert _claim(session, student) == rewards.DAILY_EARN_CAP - rewards.LOSS_COINS
