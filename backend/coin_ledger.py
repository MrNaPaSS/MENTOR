"""Награды, которые ждут получения.

Монета за сделку, достижение или урок больше не падает в баланс сама. Она
встаёт в ожидание, ученик видит её значком на шапке и забирает руками. Смысл
в самом моменте получения: награда, пришедшая молча, проходит мимо, а та,
за которой надо зайти, запоминается.

Ожидающая монета - не деньги. Потратить её в магазине нельзя, пока она не
забрана, поэтому баланс (`Student.coins`) по-прежнему значит одно: сколько
можно потратить прямо сейчас.

Мимо ожидания идут платные услуги платформы: ИИ-разбор списывается сразу
(`spend`), и, если услуга не состоялась, возвращается той же книгой
(`refund`). Ждать получения там нечего - монеты уходят за дело, а не за
достижение.

Отдельный случай - убыток на пустом балансе. Списание, которому не хватило
баланса, не пропадает, а встаёт в ожидание долгом и вычитается при следующем
получении. Без этого ученик мог бы копить награды не забирая и сливать без
последствий: пустой баланс списание просто не замечал бы.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import case, select, update

from core.models import CoinTransaction, Student, utcnow


@dataclass(frozen=True)
class PendingSummary:
    """Сводка ожидания для шапки кабинета."""

    # Сколько прибавится к балансу при получении: награды минус долги.
    total: int
    # Сколько наград ждёт. Долги сюда не входят - значок на шапке зовёт
    # за наградой, а не напоминает о сливе.
    count: int


@dataclass(frozen=True)
class ClaimRow:
    id: int
    amount: int
    reason: str
    ref: str
    created_at: object


@dataclass(frozen=True)
class ClaimResult:
    # На сколько изменился баланс.
    amount: int
    # Баланс после получения.
    balance: int
    # Что именно забрано - для анимации и истории на экране.
    transactions: tuple[ClaimRow, ...]


def add_reward(session, student_id: int, amount: int, reason: str, ref: str) -> CoinTransaction:
    """Поставить награду в ожидание. Баланс не меняется."""
    if amount <= 0:
        raise ValueError("Награда должна быть больше нуля")
    tx = CoinTransaction(
        student_id=student_id,
        amount=amount,
        reason=reason[:32],
        ref=ref[:64],
        pending=True,
    )
    session.add(tx)
    return tx


def add_debt(session, student_id: int, amount: int, reason: str, ref: str) -> CoinTransaction:
    """Поставить в ожидание списание, на которое не хватило баланса."""
    if amount <= 0:
        raise ValueError("Долг должен быть больше нуля")
    tx = CoinTransaction(
        student_id=student_id,
        amount=-amount,
        reason=reason[:32],
        ref=ref[:64],
        pending=True,
    )
    session.add(tx)
    return tx


def spend(session, student_id: int, amount: int, reason: str, ref: str) -> bool:
    """Списать монеты сразу, мимо ожидания. False - баланса не хватило.

    Списание за платную услугу не награда и не долг: услуга либо оказывается
    за монеты прямо сейчас, либо не оказывается вовсе. Поэтому баланс
    двигается здесь же, а не при получении.

    Одним запросом с условием «баланса хватает»: два одновременных нажатия
    (две вкладки, двойной клик) не уведут баланс в минус - второй запрос
    увидит, что монеты уже ушли, и вернёт False. Коммит за вызывающим.
    """
    if amount <= 0:
        raise ValueError("Списание должно быть больше нуля")
    result = session.execute(
        update(Student)
        .where(Student.id == student_id)
        .where(Student.coins >= amount)
        .values(coins=Student.coins - amount)
        .execution_options(synchronize_session="fetch")
    )
    if not (result.rowcount or 0):
        return False
    session.add(CoinTransaction(
        student_id=student_id,
        amount=-amount,
        reason=reason[:32],
        ref=ref[:64],
        pending=False,
    ))
    session.flush()
    # Ученик, загруженный в эту сессию раньше, помнит прежний баланс.
    session.expire_all()
    return True


def refund(session, student_id: int, amount: int, reason: str, ref: str) -> int:
    """Вернуть списанное той же книгой. Возвращает баланс после возврата.

    Возврат идёт отдельной строкой, а не удалением списания: в истории должно
    остаться видно, что услугу пытались оказать и не смогли. Ссылка (``ref``)
    у возврата своя - на пару «ученик и ссылка» в книге стоит ограничение
    уникальности. Коммит за вызывающим.
    """
    if amount <= 0:
        raise ValueError("Возврат должен быть больше нуля")
    session.execute(
        update(Student)
        .where(Student.id == student_id)
        .values(coins=Student.coins + amount)
        .execution_options(synchronize_session="fetch")
    )
    session.add(CoinTransaction(
        student_id=student_id,
        amount=amount,
        reason=reason[:32],
        ref=ref[:64],
        pending=False,
    ))
    session.flush()
    session.expire_all()
    return _balance(session, student_id)


def pending_of(session, student_id: int) -> list[CoinTransaction]:
    """Всё, что ждёт получения, свежее первым."""
    return list(
        session.execute(
            select(CoinTransaction)
            .where(CoinTransaction.student_id == student_id)
            .where(CoinTransaction.pending.is_(True))
            .order_by(CoinTransaction.created_at.desc(), CoinTransaction.id.desc())
        ).scalars().all()
    )


def summary(rows: Iterable[CoinTransaction]) -> PendingSummary:
    rows = list(rows)
    rewards = [int(t.amount) for t in rows if int(t.amount) > 0]
    if not rewards:
        # Одни долги - забирать нечего, и итог на экране не должен
        # показывать минус там, где кнопки «Забрать» нет.
        return PendingSummary(total=0, count=0)
    return PendingSummary(total=sum(int(t.amount) for t in rows), count=len(rewards))


def claim_all(session, student_id: int) -> ClaimResult:
    """Забрать всё ожидающее разом.

    Одним запросом `UPDATE ... WHERE pending RETURNING`: два одновременных
    нажатия (две вкладки, двойной клик) не заберут одно и то же дважды -
    второй запрос найдёт строки уже снятыми с ожидания и вернёт пустоту.
    Баланс двигается тоже в базе, выражением от текущего значения, а не
    записью числа, прочитанного раньше: между чтением и записью монеты могли
    начислиться или списаться из соседнего процесса.

    Коммит за вызывающим.
    """
    has_reward = session.execute(
        select(CoinTransaction.id)
        .where(CoinTransaction.student_id == student_id)
        .where(CoinTransaction.pending.is_(True))
        .where(CoinTransaction.amount > 0)
        .limit(1)
    ).scalar_one_or_none()

    if has_reward is None:
        return ClaimResult(amount=0, balance=_balance(session, student_id), transactions=())

    rows = session.execute(
        update(CoinTransaction)
        .where(CoinTransaction.student_id == student_id)
        .where(CoinTransaction.pending.is_(True))
        .values(pending=False, claimed_at=utcnow())
        .returning(
            CoinTransaction.id,
            CoinTransaction.amount,
            CoinTransaction.reason,
            CoinTransaction.ref,
            CoinTransaction.created_at,
        )
        .execution_options(synchronize_session=False)
    ).all()

    if not rows:
        # Всё успел забрать соседний запрос.
        return ClaimResult(amount=0, balance=_balance(session, student_id), transactions=())

    net = sum(int(r.amount) for r in rows)
    before = _balance(session, student_id)
    moved = Student.coins + net
    session.execute(
        update(Student)
        .where(Student.id == student_id)
        # Долг больше наград не делает ученика должником: баланс упирается
        # в ноль, как и при обычном списании за убыток.
        .values(coins=case((moved < 0, 0), else_=moved))
        .execution_options(synchronize_session=False)
    )
    after = _balance(session, student_id)

    # Объекты, загруженные в эту сессию раньше, помнят старые числа.
    session.expire_all()

    claimed = tuple(
        ClaimRow(id=r.id, amount=int(r.amount), reason=r.reason, ref=r.ref, created_at=r.created_at)
        for r in sorted(rows, key=lambda r: r.id)
    )
    return ClaimResult(amount=after - before, balance=after, transactions=claimed)


def _balance(session, student_id: int) -> int:
    value = session.execute(
        select(Student.coins).where(Student.id == student_id)
    ).scalar_one_or_none()
    return int(value or 0)
