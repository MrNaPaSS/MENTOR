"""Живой круг подписки: счёт, настоящий перевод, начисление, уведомление.

Правило проекта: не готово, пока не прошло по настоящей сети. Автотесты ловят
арифметику на записанных ответах узла, но не ловят главного - что деньги,
отправленные человеком с биржи, доходят и превращаются в дни.

Пробник выставляет счёт на **малую сумму** (по умолчанию 1 USDT), показывает
адрес и точную сумму, а дальше раз в пятнадцать секунд гоняет тот же
наблюдатель, что работает на сервере, и печатает, что он видит. Ничего своего
он не считает: и счёт, и начисление, и уведомление делает боевой код.

    python check_subscription_flow.py --кому 123456789
    python check_subscription_flow.py --кому 123456789 --цена 1 --минут 30
    python check_subscription_flow.py --кому 123456789 --тариф pro --срок year

Счёт держится указанное число минут; всё это время можно платить. Начисленные
дни после проверки снимаются руками - пробник чужую подписку не трогает.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

from sqlalchemy import select  # noqa: E402

from backend import notifications, subscriptions  # noqa: E402
from backend.payments import bsc, watcher as payments_watcher  # noqa: E402
from backend.sources import session as http_session  # noqa: E402
from core.db import SessionLocal, init_engine  # noqa: E402
from core.models import NotificationEvent, OrphanPayment, PaymentIntent, Student  # noqa: E402


def _arg(name: str, default: str) -> str:
    for key in (name, name.replace("--", "--", 1)):
        if key in sys.argv:
            try:
                return sys.argv[sys.argv.index(key) + 1]
            except IndexError:
                return default
    return default


def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_invoice(session, *, tg_id: int, plan: str, period: str, price: float, minutes: int) -> PaymentIntent:
    """Счёт на малую сумму - тем же кодом, что и боевой, но со своей ценой.

    Цену подменяем только здесь: платить 49 USDT ради проверки сети незачем, а
    всё остальное - подбор свободной суммы, срок брони, запись в базу - должно
    быть настоящим, иначе проверка ничего не докажет.
    """
    student = session.scalars(select(Student).where(Student.tg_id == tg_id)).first()
    if student is None:
        # Счёт выставляем человеку, а не в пустоту: без записи некому начислять
        # дни, и проверка ничего бы не доказала.
        raise SystemExit(
            f"Ученика с tg_id {tg_id} в базе нет. "
            "Зайдите разок в терминал через бота - запись заведётся сама, "
            "после этого пробник сработает."
        )

    chosen = subscriptions.plan_of(plan)
    span = subscriptions.period_of(period)
    moment = _now()
    intent = PaymentIntent(
        student_id=student.id,
        tg_id=tg_id,
        plan=chosen.code,
        period=span,
        price_usd=price,
        network=bsc.NETWORK,
        receiver=bsc.receiving_address(),
        amount_raw=bsc.unique_amount(price),
        status="pending",
        created_at=moment,
        expires_at=moment + timedelta(minutes=minutes),
    )
    session.add(intent)
    session.commit()
    return intent


def show(intent: PaymentIntent) -> None:
    print()
    print("  Сеть:    ", bsc.NETWORK_LABEL)
    print("  Адрес:   ", intent.receiver)
    print("  Сумма:   ", bsc.format_usdt(intent.amount_raw), "USDT  (ровно, до последнего знака)")
    print("  Тариф:   ", intent.plan, intent.period)
    print("  Счёт до: ", intent.expires_at)
    print()
    print("  Платить с биржи или из кошелька. Сеть - BEP-20, не TRC-20.")
    print()


async def watch(intent_id: str, *, minutes: int) -> int:
    """Тот же наблюдатель, что на сервере. Ждём, пока он найдёт наш перевод."""
    found = {"ok": False}

    def on_payment(session, intent, transfer):
        subscriptions.on_payment(session, intent, transfer)
        if intent.id == intent_id:
            found["ok"] = True
            print(f"  Перевод найден: {transfer.tx_hash}")

    watcher = payments_watcher.PaymentWatcher(on_payment)
    deadline = _now() + timedelta(minutes=minutes)
    tick = 0
    while _now() < deadline and not found["ok"]:
        tick += 1
        try:
            matched = await watcher.tick()
        except Exception as exc:  # noqa: BLE001 - пробник не должен падать на сбое сети
            print(f"  [{tick:>3}] сбой прохода: {exc}")
            matched = 0
        if not matched and tick % 4 == 0:
            with SessionLocal() as session:
                from core.models import ChainCursor

                cursor = session.get(ChainCursor, bsc.NETWORK)
                print(f"  [{tick:>3}] жду... курсор на блоке {cursor.last_block if cursor else '?'}")
        if not found["ok"]:
            await asyncio.sleep(15)
    return 0 if found["ok"] else 1


def report(session, intent_id: str, tg_id: int) -> None:
    intent = session.get(PaymentIntent, intent_id)
    student = session.scalars(select(Student).where(Student.tg_id == tg_id)).first()
    state = subscriptions.state(session, student.id)

    print()
    print("  Счёт:        ", intent.status, intent.tx_hash or "")
    print("  Подписка:    ", "активна" if state.active else "не активна", state.plan)
    print("  Оплачено до: ", state.paid_until)
    print("  Дней:        ", state.days_left)

    events = session.scalars(
        select(NotificationEvent)
        .where(NotificationEvent.student_id == student.id)
        .order_by(NotificationEvent.created_at.desc())
        .limit(5)
    ).all()
    print("  Событий боту:", len(events))
    for one in events:
        print(f"     {one.event}  забрано: {'да' if one.acked_at else 'нет'}")

    orphans = session.scalars(
        select(OrphanPayment).where(OrphanPayment.resolved_student_id.is_(None)).limit(5)
    ).all()
    if orphans:
        print("  Неопознанные переводы (ждут разбора):")
        for one in orphans:
            print(f"     {one.tx_hash}  {bsc.format_usdt(one.amount_raw)} USDT")


async def main() -> int:
    asked = _arg("--кому", _arg("--tg", "0"))
    try:
        tg_id = int(asked)
    except ValueError:
        # Сюда попадают, подставив в команду слова из примера. Трейсбек на это
        # отвечать не должен: человек ошибся в одном месте и должен прочитать,
        # в каком именно.
        print(f"Не понимаю номер Telegram: {asked}")
        print("Нужно число, например: python check_subscription_flow.py --кому 511442168")
        print("Свой номер видно в боте по кнопке «Моя подписка» или в @userinfobot.")
        return 1
    if not tg_id:
        print(__doc__)
        return 1
    plan = _arg("--тариф", _arg("--plan", "terminal"))
    period = _arg("--срок", _arg("--period", "month"))
    price = float(_arg("--цена", _arg("--price", "1")))
    minutes = int(_arg("--минут", _arg("--minutes", "30")))

    init_engine()
    print(f"Узел:  {bsc.rpc_url()}")
    try:
        print(f"Приём: {bsc.receiving_address()}")
    except RuntimeError as exc:
        print(exc)
        return 1

    with SessionLocal() as session:
        intent = make_invoice(
            session, tg_id=tg_id, plan=plan, period=period, price=price, minutes=minutes
        )
        intent_id = intent.id
        show(intent)

    code = await watch(intent_id, minutes=minutes)
    with SessionLocal() as session:
        report(session, intent_id, tg_id)
        if code:
            print()
            print("  Перевод не пришёл за отведённое время.")
            print("  Если деньги уходили - ищите их среди неопознанных выше,")
            print("  и сверьте сеть: BEP-20, а не TRC-20.")
        else:
            # Уведомление об оплате бот заберёт сам; здесь показываем, что оно
            # уже в очереди - это последний стык пути.
            print()
            print("  Готово: деньги дошли, дни начислены, событие боту поставлено.")
    await http_session.close()
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        # Ждать перевод скучно, и проверку часто обрывают руками. Счёт при этом
        # остаётся ожидающим: оплатить по нему можно и после выхода, деньги
        # найдёт наблюдатель на сервере.
        print()
        print("Проверка прервана. Счёт остался ожидающим - оплата по нему ещё пройдёт.")
        raise SystemExit(130)
