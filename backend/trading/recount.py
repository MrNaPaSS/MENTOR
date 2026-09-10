"""Пересчёт записей журнала по отчётам биржи об исполнениях.

Зачем это нужно один раз. Комиссия считалась по названным исполнениям и
пропускала те, про которые отчёт молчал: в журнале стояло +98.71 там, где на
счёт пришло +90.70. Число взятых целей бралось у счётчика сопровождения, а он
умеет только расти - у сделки, выбитой в безубыток после двух целей, в журнале
стояли три. Расчёт исправлен, но записи, сделанные до исправления, сами себя не
перепишут: журнал хранит итог, а не способ его получить.

Скрипт берёт закрытые сделки, заново спрашивает у биржи исполнения по каждой и
пересчитывает результат, комиссию и цели тем же кодом, что и сопровождение.

Осторожность здесь важнее полноты:

* по умолчанию ничего не пишется - сначала показываем, что изменится;
* берём только те сделки, чьи исполнения биржа ещё помнит: отчёт приходит
  окном, и у старых сделок он пуст - такие пропускаем, а не обнуляем;
* пересчитанный результат применяем, только если в отчёте нашёлся вход: без
  него окно застало сделку с середины, и её итог по такому отчёту неполон.

Запуск с корня проекта:

    python -m backend.trading.recount             # показать, ничего не меняя
    python -m backend.trading.recount --apply     # записать
    python -m backend.trading.recount --days 3    # только за последние три дня
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import ssl
from datetime import timedelta, timezone

import aiohttp
import certifi
from sqlalchemy import select

# Ради побочного действия: при импорте читается .env - адрес базы и ключ,
# которым зашифрованы ключи учеников. Сервер делает это при старте, а скрипт
# запускают отдельно, и без этой строки он падал на первом же ученике с
# «WEEX_KEYS_SECRET не задан».
import backend.config  # noqa: F401
from backend.trading.rewards import award_trade_coins
from core.db import SessionLocal, init_engine
from core.models import ScalpTrade, WeexCredential, utcnow
from core.weex import keys as keystore
from core.weex.futures import Credentials, WeexFutures, WeexTradeError

from backend.trading.watcher import fill_time, settle, takes_from_fills

logger = logging.getLogger("nmnh.trading.recount")

# За сколько дней пересчитываем по умолчанию. Отчёт об исполнениях приходит
# окном в сотню записей: у сделок постарше он пуст, и ходить за ними незачем.
DEFAULT_DAYS = 7

# Насколько результат должен разойтись со старым, чтобы запись стоило трогать.
# Копейка разницы - это округление, а не ошибка.
EPS = 0.01


async def recount(days: int, apply: bool, student: int | None) -> int:
    """Пересчитать журнал. Возвращает число изменённых записей."""
    # Скрипт запускают отдельно от сервера: движок базы никто до нас не поднял.
    init_engine()
    session = SessionLocal()
    changed = 0
    # Сделки, до которых не дозвонились. Молчать о них нельзя: «менять нечего»
    # при четырёх ошибках подряд читается как «всё в порядке».
    failed = 0
    # Итог журнала по проверенным сделкам: до пересчёта и после.
    totals: dict[str, float] = {}
    try:
        since = utcnow() - timedelta(days=days)
        query = (
            select(ScalpTrade)
            .where(ScalpTrade.closed_at >= since)
            .order_by(ScalpTrade.closed_at)
        )
        if student is not None:
            query = query.where(ScalpTrade.student_id == student)
        trades = list(session.execute(query).scalars())
        if not trades:
            print(f"Сделок за последние {days} дн. не нашлось.")
            return 0

        print(f"Сделок к проверке: {len(trades)}")

        if not keystore.enabled():
            # Без ключа расшифровать ключи учеников нечем, и спросить биржу не
            # выйдет. Говорим это словами, а не трассировкой стека.
            print()
            print("WEEX_KEYS_SECRET не задан - ключи учеников не расшифровать.")
            print("Запускать нужно там же, где работает бекенд, и с тем же .env.")
            return 0

        by_student: dict[int, list[ScalpTrade]] = {}
        for one in trades:
            by_student.setdefault(one.student_id, []).append(one)

        # Корневые сертификаты берём из certifi, а не из системного хранилища:
        # на Windows Python до него не достаёт, и запрос к бирже падает с
        # «unable to get local issuer certificate». Проверку не отключаем - в
        # этих запросах ходят ключи от денег ученика, и подменённый сертификат
        # означает, что их прочитает кто угодно по дороге. Тем же способом
        # ходит сервер: см. `_get_session` в backend/api/trading.py.
        context = ssl.create_default_context(cafile=certifi.where())
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=context)
        ) as http:
            # Клиент биржи просит не саму сессию, а способ её получить: он
            # переоткрывает её сам, если та закрылась посреди работы.
            async def http_session() -> aiohttp.ClientSession:
                return http

            for student_id, group in by_student.items():
                row = session.execute(
                    select(WeexCredential).where(WeexCredential.student_id == student_id)
                ).scalar_one_or_none()
                if row is None or not row.is_active:
                    print(f"  ученик {student_id}: ключей нет, пропускаем {len(group)} сделок")
                    continue

                client = WeexFutures(
                    Credentials(
                        keystore.decrypt(row.api_key_enc),
                        keystore.decrypt(row.secret_enc),
                        keystore.decrypt(row.passphrase_enc),
                    ),
                    http_session,
                )

                # Отчёт по инструменту берём один раз на всех: у одной монеты
                # сделок за день бывает много, а окно исполнений общее.
                reports: dict[str, list[dict]] = {}
                for trade in group:
                    try:
                        changed += await _one(session, client, trade, reports, apply, totals)
                    except WeexTradeError as exc:
                        failed += 1
                        print(f"  {_head(trade)}  биржа молчит - {exc}")
                    except Exception as exc:  # noqa: BLE001 - одна сделка не мешает другим
                        failed += 1
                        print(f"  {_head(trade)}  не вышло - {exc}")

        print()
        if "was" in totals:
            was, now = totals["was"], totals.get("now", 0.0)
            print(f"Итог по проверенным сделкам: {was:+.2f} → {now:+.2f} ({now - was:+.2f})")
        if apply and changed:
            session.commit()
            print(f"Записано изменений: {changed}")
        elif changed:
            print(f"Изменилось бы записей: {changed}. Это сухой прогон - ничего не записано.")
            print("Чтобы записать: python -m backend.trading.recount --apply")
        elif failed:
            print("Ни одной сделки проверить не удалось - биржа не ответила.")
        else:
            print("Всё сходится, менять нечего.")
        if failed:
            print(f"Сделок, до которых не дозвонились: {failed}. Они остались как были.")
        return changed
    finally:
        session.close()


async def _one(
    session,
    client: WeexFutures,
    trade: ScalpTrade,
    reports: dict[str, list[dict]],
    apply: bool,
    totals: dict[str, float] | None = None,
) -> int:
    """Пересчитать одну запись. Возвращает 1, если она изменилась.

    `totals` копит итог журнала до пересчёта и после - по всем проверенным.
    """
    if trade.symbol not in reports:
        reports[trade.symbol] = await client.user_trades(trade.symbol, limit=100)
    fills = reports[trade.symbol]

    # Окно сделки: от входа до закрытия с запасом в минуту на разницу часов
    # биржи и базы. Чужие исполнения по той же монете сюда попасть не должны -
    # они принадлежат другой сделке и испортят и результат, и комиссию.
    started = trade.opened_at or trade.closed_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    finished = trade.closed_at
    if finished.tzinfo is None:
        finished = finished.replace(tzinfo=timezone.utc)
    lo = int((started - timedelta(minutes=1)).timestamp() * 1000)
    hi = int((finished + timedelta(minutes=1)).timestamp() * 1000)
    mine = [f for f in fills if lo <= fill_time(f) <= hi]

    if not mine:
        # Биржа этих исполнений уже не помнит. Записать по ним ноль значило бы
        # стереть настоящую сделку - оставляем как есть.
        print(f"  {_head(trade)}  исполнений в отчёте нет, пропуск")
        return 0

    taker = 0.0
    try:
        taker = float((await client.symbol_filters(trade.symbol)).get("taker_fee") or 0)
    except Exception as exc:  # noqa: BLE001 - ставка справочная, без неё обойдёмся
        logger.debug("Ставка комиссии %s не получена: %s", trade.symbol, exc)

    gross, fee, exit_price = settle(mine, float(trade.entry), trade.side, taker)
    pnl = gross - fee
    hit = takes_from_fills(trade, mine)

    was_pnl = float(trade.pnl or 0)
    was_fee = float(trade.fee or 0)
    was_hit = int(trade.takes_hit or 0)
    was_exit = float(trade.exit_price or 0)
    now_exit = float(exit_price or was_exit)
    if totals is not None:
        totals["was"] = totals.get("was", 0.0) + was_pnl
        totals["now"] = totals.get("now", 0.0) + pnl
    if abs(pnl - was_pnl) < EPS and abs(fee - was_fee) < EPS and hit == was_hit:
        # И то, что не меняется, показываем: иначе не видно, проверена ли
        # сделка вообще или её пропустили.
        print(f"  {_head(trade)}  без изменений: итог {pnl:+.2f}, комиссия {fee:.2f}, цели {hit}")
        return 0

    # Что на что поменяется - каждое поле отдельно, и разница итога рядом: по
    # одной стрелке не видно, в какую сторону ушли деньги и на сколько.
    print(
        f"  {_head(trade)}  "
        f"итог {_pair(was_pnl, pnl, lambda v: f'{v:+.2f}')} ({pnl - was_pnl:+.2f}) · "
        f"комиссия {_pair(was_fee, fee, lambda v: f'{v:.2f}')} · "
        f"выход {_pair(was_exit, now_exit, _price)} · "
        f"цели {_pair(was_hit, hit, str)}"
    )

    if apply:
        trade.pnl = pnl
        trade.fee = fee
        trade.takes_hit = hit
        if exit_price:
            trade.exit_price = exit_price
        trade.from_exchange = True
        trade.note = "биржа"
        # Пересчёт добирает и монеты: до него сделка была оценкой с экрана и
        # награды не давала. Повторно та же сделка не начислится - на паре
        # «ученик + ref» стоит уникальный индекс.
        award_trade_coins(session, trade)
    return 1


def _head(trade) -> str:
    """Начало строки: когда закрыта, монета, сторона - по ним сделку находят в журнале."""
    at = trade.closed_at
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    when = at.astimezone().strftime("%d.%m %H:%M") if at else "--.-- --:--"
    side = "лонг" if trade.side == "long" else "шорт"
    return f"{when}  {trade.symbol:<10} {side:<4}  {trade.client_id}"


def _pair(was, now, show) -> str:
    """«было → стало», если поменялось, и одно значение, если нет."""
    if abs(float(now) - float(was)) < EPS:
        return show(now)
    return f"{show(was)} → {show(now)}"


def _price(value: float) -> str:
    """Цена без хвоста нулей: 1218.25, а не 1218.25000000."""
    return f"{value:.8f}".rstrip("0").rstrip(".") if value else "-"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Пересчёт журнала по исполнениям биржи")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="записать изменения (без него - только показать)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_DAYS,
        help=f"за сколько последних дней (по умолчанию {DEFAULT_DAYS})",
    )
    parser.add_argument("--student", type=int, default=None, help="только этот ученик")
    args = parser.parse_args()

    asyncio.run(recount(args.days, args.apply, args.student))


if __name__ == "__main__":
    main()
