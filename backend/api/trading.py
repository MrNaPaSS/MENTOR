"""Торговля с биржевого счёта ученика.

Ключи ученика лежат в базе зашифрованными, мастер-ключ приходит из окружения.
Нет мастер-ключа — раздел просто выключен: работать «пока без шифрования»
нельзя, это доступ к чужим деньгам.

Ордер ставится ровно тем же расчётом, что показан в терминале: вход, стоп и три
цели. Ничего не пересчитывается заново на сервере — расхождение между тем, что
трейдер видел, и тем, что ушло на биржу, недопустимо, а два независимых расчёта
рано или поздно разойдутся.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
import ssl
from typing import Any

import aiohttp
import certifi
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.deps import get_current_student, get_session
from core.models import LiveTrade, Student, WeexCredential, utcnow
from core.trading.position import (
    Position,
    breakeven_price,
    should_move_stop,
)
from core.weex import keys as keystore
from backend.trading.watcher import fill_time, position_for, settle, split_ladder
from core.weex.futures import (
    public_filters,
    Credentials,
    WeexFutures,
    WeexTradeError,
    floor_to_step,
    plan_order_id,
    round_to_tick,
)

router = APIRouter(prefix="/api/trading", tags=["trading"])
logger = logging.getLogger("nmnh.trading")

# Одна сессия на процесс: соединения живут дольше запроса, и заводить их по
# числу учеников значит исчерпать сокеты на первом же десятке.
_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    """Общая сессия с проверкой сертификата биржи.

    Корневые сертификаты берём из certifi, а не из системного хранилища: на
    Windows Python до него не достаёт, и запрос падает с «unable to get local
    issuer certificate». Отключать проверку, как это сделано в партнёрском
    клиенте, здесь нельзя — в этих запросах ходят ключи от денег ученика, и
    подменённый сертификат означает, что их прочитает кто угодно по дороге.
    """
    global _session
    if _session is None or _session.closed:
        context = ssl.create_default_context(cafile=certifi.where())
        _session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=context))
    return _session


async def close_session() -> None:
    global _session
    if _session and not _session.closed:
        await _session.close()
    _session = None


class KeysIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=256)
    secret_key: str = Field(min_length=8, max_length=256)
    passphrase: str = Field(min_length=1, max_length=256)


class OrderIn(BaseModel):
    """Сделка ровно в том виде, в каком её показал терминал."""

    symbol: str = Field(min_length=1, max_length=32)
    side: str                       # long | short
    quantity: float = Field(gt=0)
    leverage: int = Field(ge=1, le=400)
    entry: float | None = Field(default=None, gt=0)   # пусто — вход по рынку
    stop: float = Field(gt=0)
    takes: list[float] = Field(default_factory=list, max_length=5)
    client_order_id: str | None = Field(default=None, max_length=64)


class CloseIn(BaseModel):
    """Фиксация позиции: доля от того, что сейчас открыто."""

    symbol: str = Field(min_length=1, max_length=32)
    side: str
    share: float = Field(gt=0, le=1)
    client_order_id: str | None = Field(default=None, max_length=64)
    # Какую именно сделку снимаем. По одному инструменту их может идти
    # несколько - в том числе встречных, - и снятие одной не должно уносить
    # защиту остальных.
    trade_id: str | None = Field(default=None, max_length=64)


class StopIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    side: str
    entry: float = Field(gt=0)
    quantity: float = Field(gt=0)
    order_id: str = Field(min_length=1, max_length=64)
    current_stop: float | None = Field(default=None, gt=0)
    mark_price: float | None = Field(default=None, gt=0)


def _credential(session, student: Student) -> WeexCredential | None:
    return session.execute(
        select(WeexCredential).where(WeexCredential.student_id == student.id)
    ).scalar_one_or_none()


def _client(row: WeexCredential) -> WeexFutures:
    return WeexFutures(
        Credentials(
            api_key=keystore.decrypt(row.api_key_enc),
            secret_key=keystore.decrypt(row.secret_enc),
            passphrase=keystore.decrypt(row.passphrase_enc),
        ),
        _get_session,
    )


def _require_client(session, student: Student) -> WeexFutures:
    if not keystore.enabled():
        raise HTTPException(503, "Торговля выключена: на сервере не задан ключ шифрования")
    row = _credential(session, student)
    if row is None or not row.is_active:
        raise HTTPException(428, "Сначала подключите ключи WEEX")
    return _client(row)


def _fail(exc: WeexTradeError) -> HTTPException:
    """Отказ биржи наружу отдаём как есть: трейдеру нужно знать причину.

    Отказ по существу — это 400, а не 502: шлюз ни при чём, не подошли данные
    ордера. Заодно 502 от приложения браузер и прокси разбирают по-разному, и
    сообщение биржи до трейдера не доезжало.
    """
    logger.warning("WEEX отказал: %s (код %s)", exc, exc.code)
    status = 502 if exc.retryable else 400
    return HTTPException(status, f"Биржа: {exc}")


@router.get("/plans/{symbol}")
async def plans(
    symbol: str,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Что из защиты реально стоит на бирже: стопы и цели.

    График рисует цели по замыслу сделки, и когда биржа их не приняла,
    трейдер видит лестницу, которой нет. Пусть терминал сверяется с биржей и
    говорит правду - молчаливая картинка здесь дороже всего.
    """
    client = _require_client(session, student)
    try:
        orders = await client.algo_orders(symbol.upper())
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    stops = 0
    takes = 0
    for order in orders:
        kind = str(order.get("planType") or order.get("type") or "").lower()
        if "profit" in kind or kind.endswith("tp"):
            takes += 1
        else:
            stops += 1
    return {"symbol": symbol.upper(), "stops": stops, "takes": takes}


@router.get("/limits/{symbol}")
async def limits(symbol: str, student: Student = Depends(get_current_student)):
    """Пределы инструмента: плечо, комиссия, шаги.

    Нужны до отправки ордера, а не после: у большинства монет биржи потолок
    плеча ×20 или ×50, а кнопки в окне расчёта предлагают до ×400. Раньше это
    выяснялось отказом биржи после нажатия «Войти».

    Ключей не требует - справочник биржи открыт, и знать предел вправе и тот,
    кто счёт ещё не подключил.
    """
    filters = await public_filters(await _get_session(), symbol.upper())
    return {
        "symbol": symbol.upper(),
        "max_leverage": int(filters.get("max_leverage") or 20),
        "taker_fee": float(filters.get("taker_fee") or 0.0008),
        "step": float(filters.get("step") or 0.001),
        "tick": float(filters.get("tick") or 0.01),
        "min_qty": float(filters.get("min_qty") or 0.001),
    }


@router.get("/status")
async def status(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Готов ли терминал торговать с биржевого счёта."""
    row = _credential(session, student)
    return {
        "enabled": keystore.enabled(),
        "connected": bool(row and row.is_active),
        "key_tail": row.key_tail if row else "",
        "updated_at": row.updated_at.isoformat() if row else None,
    }


@router.put("/keys")
async def save_keys(
    body: KeysIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Подключить ключи. Проверяем их сразу — иначе ошибка всплывёт на ордере."""
    if not keystore.enabled():
        raise HTTPException(503, "Торговля выключена: на сервере не задан ключ шифрования")

    probe = WeexFutures(
        Credentials(body.api_key, body.secret_key, body.passphrase), _get_session
    )
    try:
        await probe.balance()
    except WeexTradeError as exc:
        raise HTTPException(400, f"Ключи не подошли: {exc}") from exc

    row = _credential(session, student)
    if row is None:
        row = WeexCredential(student_id=student.id)
        session.add(row)
    row.api_key_enc = keystore.encrypt(body.api_key)
    row.secret_enc = keystore.encrypt(body.secret_key)
    row.passphrase_enc = keystore.encrypt(body.passphrase)
    row.key_tail = keystore.mask(body.api_key)
    row.is_active = True
    row.updated_at = utcnow()
    session.commit()
    return {"ok": True, "key_tail": row.key_tail}


@router.delete("/keys")
async def drop_keys(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    row = _credential(session, student)
    if row is None:
        raise HTTPException(404, "Ключи не подключены")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/balance")
async def balance(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    client = _require_client(session, student)
    try:
        return {"balance": await client.balance()}
    except WeexTradeError as exc:
        raise _fail(exc) from exc


@router.get("/positions")
async def positions(
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    client = _require_client(session, student)
    try:
        return {"positions": await client.positions()}
    except WeexTradeError as exc:
        raise _fail(exc) from exc


@router.post("/open")
async def open_position(
    body: OrderIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Открыть сделку: вход со стопом, следом цели.

    Стоп ставится вместе со входом одним ордером, а не отдельным запросом
    после: между двумя запросами есть окно, в котором позиция уже открыта и
    ничем не защищена.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    symbol = body.symbol.upper()
    long = body.side == "long"
    position_side = "LONG" if long else "SHORT"

    # Объём и цены приводим к шагам инструмента до отправки. Биржа отклоняет
    # ордер, если объём не кратен шагу лота: «order size must match stepSize».
    filters = await client.symbol_filters(symbol)
    quantity = floor_to_step(body.quantity, filters["step"])
    if quantity < filters["min_qty"]:
        raise HTTPException(
            422,
            f"Объём {body.quantity:g} меньше минимального на бирже "
            f"({filters['min_qty']:g} {symbol[:-4]}). Увеличьте сумму или плечо.",
        )
    entry_price = round_to_tick(body.entry, filters["tick"]) if body.entry else None
    stop_price = round_to_tick(body.stop, filters["tick"])

    # Вход и цели — два разных шага с разной ценой ошибки.
    #
    # Сорвался вход — не открылось ничего, и об этом надо сказать отказом.
    # Сорвались цели при уже открытой позиции — сделка есть, и объявлять её
    # неудачей нельзя: трейдер решит, что позиции нет, а она стоит на бирже.
    try:
        await client.set_leverage(symbol, body.leverage)

        entry_order = await client.place_order(
            symbol=symbol,
            side="BUY" if long else "SELL",
            position_side=position_side,
            quantity=_num(quantity),
            order_type="LIMIT" if entry_price else "MARKET",
            price=_num(entry_price) if entry_price else None,
            sl_trigger=_num(stop_price),
            client_order_id=body.client_order_id,
        )
    except WeexTradeError as exc:
        raise _fail(exc) from exc

    # Цели ставятся только когда позиция уже есть.
    #
    # Сокращающий ордер нечего сокращать, пока вход висит лимиткой, и биржа
    # отвечает «cannot set reduce only, you must cancel some order». Поэтому
    # при входе по рынку лестницу ставим сразу, а при лимитном входе её выставит
    # наблюдатель — в тот момент, когда позиция появится.
    takes: list[Any] = []
    placed: list[dict[str, Any]] = []
    warning = ""
    # Доли целей неравные: первая снимает 30%, вторая 50%, последняя остаток.
    # На маленькой позиции доля не набирает минимального объёма заявки, и
    # мелкие доли копятся до первой проходящей: вместо трёх целей будет две или
    # одна, но они будут - раньше сделка оставалась с одним стопом.
    ladder = split_ladder(quantity, list(body.takes), filters["step"], filters["min_qty"])

    if ladder and not entry_price:
        for i, (price, size) in enumerate(ladder):
            try:
                order = await client.place_tp_sl(
                    symbol=symbol,
                    plan_type="TAKE_PROFIT",
                    trigger_price=_num(round_to_tick(price, filters["tick"])),
                    quantity=_num(size),
                    position_side=position_side,
                    client_algo_id=f"tp{i + 1}_{body.client_order_id or ''}"[:32],
                )
            except WeexTradeError as exc:
                # Позиция уже открыта — цели доставит наблюдатель.
                logger.warning("Цель %d для %s не встала: %s", i + 1, symbol, exc)
                warning = f"Цели поставит сопровождение: {exc}"
                break
            takes.append(order)
            placed.append(
                {"price": price, "order_id": plan_order_id(order), "filled": False}
            )

    # Запись для фонового ведения: без неё переносить стоп в безубыток будет
    # некому, как только трейдер закроет вкладку.
    client_id = body.client_order_id or f"{symbol}-{int(utcnow().timestamp() * 1000)}"
    live = session.execute(
        select(LiveTrade)
        .where(LiveTrade.student_id == student.id)
        .where(LiveTrade.client_id == client_id)
    ).scalar_one_or_none()
    if live is None:
        live = LiveTrade(student_id=student.id, client_id=client_id)
        session.add(live)
    live.symbol = symbol
    live.side = body.side
    live.entry = entry_price or 0.0
    live.initial_stop = stop_price
    live.current_stop = stop_price
    # Цели сделки - те, что реально встали на бирже. Если вход лимитный, их
    # ещё нет: тогда запоминаем замысел, а сопровождение перепишет его тем, что
    # поставит само.
    live.targets_json = json.dumps([p["price"] for p in placed] if placed else body.takes)
    live.tp_orders_json = json.dumps(placed, ensure_ascii=False)
    live.qty = quantity
    live.leverage = body.leverage
    live.margin = quantity * (entry_price or 0.0) / max(1, body.leverage)
    live.takes_hit = 0
    live.status = "waiting"
    live.sl_order_id = ""
    live.updated_at = utcnow()
    session.commit()

    return {
        "entry": entry_order,
        "takes": takes,
        "watched": live.client_id,
        "warning": warning,
    }


@router.post("/close")
async def close_position(
    body: CloseIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Закрыть позицию целиком или частью — по рынку.

    По рынку, а не лимитом: трейдер нажал «зафиксировать», значит он хочет выйти
    сейчас, а не поставить заявку и ждать. Лимит на выходе означал бы, что
    позиция осталась открытой, а человек считает, что вышел.

    Объём берём с биржи, а не из терминала: часть могла уже закрыться целями, и
    приказ на исходный объём биржа отклонит целиком.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    symbol = body.symbol.upper()
    long = body.side == "long"

    try:
        positions = await client.positions()
        # Со стороной, а не просто по инструменту. При открытом шорте отмена
        # ждущей лимитки в лонг уходила закрывать... шорт: терминал видел его
        # объём и слал рыночный приказ с чужой стороной. Биржа отвечала
        # «position side invalid» - и была права, а лимитка так и висела.
        position = position_for(positions, symbol, body.side)
        # Момент входа нужен, чтобы собрать все исполнения этой сделки, а не
        # только последний ордер.
        rows = session.execute(
            select(LiveTrade)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.symbol == symbol)
            .where(LiveTrade.status.in_(("waiting", "open")))
            .order_by(LiveTrade.id.desc())
        ).scalars().all()
        # Сделку ищем по её идентификатору, а не берём последнюю: терминал
        # умеет вести несколько сразу, и «последняя» - это чужая.
        live = next((r for r in rows if r.client_id == body.trade_id), None)
        if live is None and body.trade_id is None:
            live = rows[0] if rows else None
        # Если позиция ещё не отмечена набранной, берём момент отправки входа:
        # сопровождение проставляет opened_at раз в пятнадцать секунд, а закрыть
        # руками можно и раньше. Без этого в итог попадал бы только последний
        # ордер — и результат расходился с биржей в разы.
        opened_at = (live.opened_at or live.created_at) if live else None

        size = 0.0
        for name in ("total", "size", "positionAmt", "available"):
            try:
                size = abs(float(position.get(name)))  # type: ignore[union-attr]
                break
            except (TypeError, ValueError, AttributeError):
                continue

        if size <= 0:
            # Позиции нет — но заявки могут стоять: вход ещё не исполнился, а с
            # ним висят стоп и цели. Снятие расчёта должно убирать всё это, иначе
            # «отменённая» сделка откроется сама, стоило рынку дойти до уровня.
            cancelled = await _cancel_trade(client, symbol, live)
            await _forget(session, student, symbol, live)
            return {
                "closed": 0.0,
                "remaining": 0.0,
                "note": f"позиции нет, снято заявок: {cancelled}" if cancelled else "позиции нет",
            }

        filters = await client.symbol_filters(symbol)
        quantity = floor_to_step(size * body.share, filters["step"])
        if quantity < filters["min_qty"]:
            raise HTTPException(
                422,
                f"Доля {body.share:.0%} - это {quantity:g}, меньше минимального "
                f"объёма биржи. Закройте большую часть.",
            )

        # Без reduce_only: сторону позиции биржа и так знает из positionSide, а
        # сокращающий ордер она на защищённой позиции отклоняет — «cannot set
        # reduce only». В боте заказчика закрытие идёт ровно так же, обычным
        # рыночным ордером в противоположную сторону.
        order = await client.place_order(
            symbol=symbol,
            side="SELL" if long else "BUY",
            position_side="LONG" if long else "SHORT",
            quantity=_num(quantity),
            order_type="MARKET",
            client_order_id=body.client_order_id,
        )
        order_id = _order_id(order)

        remaining = max(0.0, size - quantity)
        if remaining < filters["min_qty"]:
            # Позиции больше нет: снимаем стоп и цели. Осевшие заявки на
            # несуществующий объём откроют позицию заново, стоило бы рынку
            # дойти до их цены.
            await _cancel_trade(client, symbol, live)
            await _forget(session, student, symbol, live)

    except WeexTradeError as exc:
        raise _fail(exc) from exc

    # Настоящий результат берём у биржи, а не считаем сами.
    #
    # Наша цифра — это цена маркировки без комиссий: она совпадает с тем, что
    # биржа показывает по открытой позиции, но не с тем, что приходит на счёт.
    # Выход по рынку идёт по встречной стороне книги, и обе ноги платят
    # комиссию. Разница видна сразу: было +37, пришло +5.
    # Цену входа и сторону передаём затем, чтобы итог можно было посчитать и
    # тогда, когда биржа не назвала его сама: в её отчёте об исполнениях поля с
    # результатом может не быть вовсе - как не было поля с безубытком.
    realized, fee, fill = await _settled(
        client,
        symbol,
        order_id,
        opened_at,
        float(live.entry) if live else 0.0,
        body.side,
    )

    return {
        "closed": quantity,
        "remaining": remaining,
        "realized": realized,
        "fee": fee,
        "fill_price": fill,
    }


def _epoch_ms(value: datetime | None) -> int:
    """Время в миллисекундах эпохи.

    SQLite отдаёт дату без часового пояса, а `timestamp()` у наивной даты
    считает её местным временем: итог уезжал бы на разницу поясов, а у ранних
    дат на Windows и вовсе падал. Наивную считаем UTC — мы её такой и писали.
    """
    if value is None:
        return 0
    try:
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(aware.timestamp() * 1000)
    except (OverflowError, OSError, ValueError):
        return 0


async def _settled(
    client: WeexFutures,
    symbol: str,
    order_id: str,
    since: datetime | None,
    entry: float = 0.0,
    side: str = "long",
) -> tuple[float | None, float | None, float | None]:
    """Итог сделки по исполнениям с биржи: результат за вычетом комиссии.

    Считаем по всем исполнениям с момента входа, а не по одному закрывающему
    ордеру. Сделка состоит из входа, сработавших целей и выхода; спрашивать
    только последний ордер значит потерять остальное — а если биржа не успела
    его проиндексировать, то и всё сразу.

    Исполнения появляются в отчёте не мгновенно, поэтому спрашиваем несколько
    раз с нарастающей паузой, как в боте заказчика.
    """
    opened_ms = _epoch_ms(since)

    for pause in (0.0, 0.25, 0.6, 1.0):
        if pause:
            await asyncio.sleep(pause)
        try:
            fills = await client.user_trades(symbol, limit=100)
        except WeexTradeError as exc:
            logger.warning("Исполнения %s не получены: %s", symbol, exc)
            return None, None, None

        mine = []
        for f in fills:
            same_order = order_id and str(f.get("orderId") or "") == str(order_id)
            if same_order or (opened_ms and fill_time(f) >= opened_ms):
                mine.append(f)

        # Пока в отчёте нет закрывающего ордера, итог считать рано: он и есть
        # самая большая часть результата.
        if order_id and not any(str(f.get("orderId") or "") == str(order_id) for f in mine):
            continue
        if not mine:
            continue

        gross, fee, price = settle(mine, entry, side)
        net = gross - fee
        logger.info(
            "Сделка %s закрыта: по бирже %.4f, комиссия %.4f, на счёт %.4f",
            symbol,
            gross,
            fee,
            net,
        )
        return round(net, 8), round(fee, 8), price

    logger.warning("Исполнения %s не появились в отчёте вовремя", symbol)
    return None, None, None


async def _cancel_trade(client: WeexFutures, symbol: str, live: LiveTrade | None) -> int:
    """Снять заявки одной сделки, не трогая соседние.

    Раньше снималось всё по инструменту. Пока сделка была одна, это и значило
    «её заявки». С появлением встречных позиций та же строка кода снимала стоп
    и цели соседней сделки - то есть оставляла её без защиты, ничего об этом
    не сказав.

    Свои заявки узнаём по идентификаторам: цели и стоп записаны в сделке, а
    вход помечен нашим клиентским идентификатором - им же он и отправлялся.
    Если сделки на руках нет, снимаем всё: одиночную заявку без владельца
    оставлять опаснее, чем снять лишнее.
    """
    if live is None:
        return await _cancel_everything(client, symbol)

    mine = {str(live.sl_order_id or "")}
    for take in json.loads(live.tp_orders_json or "[]"):
        mine.add(str(take.get("order_id") or ""))
    mine.discard("")

    removed = 0
    try:
        for order in await client.open_orders(symbol):
            order_id = str(order.get("orderId") or order.get("id") or "")
            client_id = str(order.get("clientOrderId") or order.get("clientOid") or "")
            if order_id not in mine and client_id != live.client_id:
                continue
            try:
                await client.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Список заявок %s не получен: %s", symbol, exc)

    try:
        for order in await client.algo_orders(symbol):
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if order_id not in mine:
                continue
            try:
                await client.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Условные заявки %s не получены: %s", symbol, exc)

    return removed


async def _cancel_everything(client: WeexFutures, symbol: str) -> int:
    """Снять по инструменту всё: и обычные заявки, и условные.

    Двумя ручками, а не одной: условные заявки обычная не видит и отвечает
    «ордер не найден», оставляя стоп висеть. Осевшая заявка на несуществующий
    объём — это открытая позиция, о которой трейдер не знает: рынок дойдёт до её
    цены и исполнит.
    """
    removed = 0

    try:
        for order in await client.open_orders(symbol):
            order_id = str(order.get("orderId") or order.get("id") or "")
            if not order_id:
                continue
            try:
                await client.cancel_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Список заявок %s не получен: %s", symbol, exc)

    try:
        for order in await client.algo_orders(symbol):
            order_id = str(order.get("orderId") or order.get("algoId") or order.get("id") or "")
            if not order_id:
                continue
            try:
                await client.cancel_algo_order(symbol, order_id)
                removed += 1
            except WeexTradeError as exc:
                logger.warning("Условная заявка %s не снята: %s", order_id, exc)
    except WeexTradeError as exc:
        logger.warning("Условные заявки %s не получены: %s", symbol, exc)

    logger.info("Снято заявок по %s: %d", symbol, removed)
    return removed


async def _forget(
    session, student: Student, symbol: str, live: LiveTrade | None = None
) -> None:
    """Снять сделку с ведения: позиции больше нет.

    Когда сделка известна - только её: соседняя по тому же инструменту живёт
    своей жизнью, и закрывать её записью значит потерять её из виду.
    """
    if live is not None:
        rows = [live]
    else:
        rows = session.execute(
            select(LiveTrade)
            .where(LiveTrade.student_id == student.id)
            .where(LiveTrade.symbol == symbol)
            .where(LiveTrade.status.in_(("waiting", "open")))
        ).scalars().all()
    for row in rows:
        row.status = "closed"
        row.closed_at = utcnow()
        row.updated_at = utcnow()
    if rows:
        session.commit()


@router.post("/breakeven")
async def move_to_breakeven(
    body: StopIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Перенести стоп в безубыток с учётом комиссии обеих ног.

    Наивный перенос на цену входа гарантирует небольшой убыток на каждом
    «безубытке»: комиссия уплачена на входе и будет уплачена на выходе.
    """
    if body.side not in {"long", "short"}:
        raise HTTPException(422, "Сторона сделки: long или short")

    client = _require_client(session, student)
    position = Position(
        symbol=body.symbol.upper(),
        side=body.side,
        entry=body.entry,
        quantity=body.quantity,
        stop=body.current_stop,
    )
    target = breakeven_price(position, body.mark_price)
    if target is None or not should_move_stop(position, target):
        return {"moved": False, "stop": body.current_stop}

    try:
        await client.modify_tp_sl(
            symbol=position.symbol, order_id=body.order_id, trigger_price=_num(target)
        )
    except WeexTradeError as exc:
        raise _fail(exc) from exc
    return {"moved": True, "stop": target}


def _order_id(order: Any) -> str:
    """Идентификатор ордера: биржа кладёт его в разные поля."""
    if isinstance(order, dict):
        for name in ("orderId", "order_id", "id", "clientOrderId"):
            if order.get(name):
                return str(order[name])
    return ""


def _num(value: float) -> str:
    """Число для биржи строкой, без экспоненты.

    На монетах вроде PEPE цена уходит в 1e-07, а биржа такой записи не
    понимает: ордер отклоняется с невнятной ошибкой о формате.
    """
    return f"{value:.10f}".rstrip("0").rstrip(".") or "0"
