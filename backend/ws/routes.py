"""WebSocket-эндпоинты (ТЗ §9.1).

``/ws/prices`` — публичный канал цен; ``/ws`` — авторизованный канал (JWT в query) для
персональных событий (новые сигналы, баланс); ``/ws/scalping`` — скринер и
стакан с подпиской на конкретный инструмент; ``/ws/chat`` — общая комната:
присутствие и новые сообщения.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from core.db import SessionLocal
from core.models import Student

from backend.api.chat import MENTOR_NAME
from backend.mentor import is_mentor
from backend import tools
from backend.security import decode_token, TokenError
from backend.price_collector import active_symbols
from backend.scalping.ladder import DEFAULT_ROWS, MAX_ROWS
from backend.scalping.metrics import SHELF_MAX_LIMIT, SHELF_MIN_LIMIT, SHELF_MIN_NOTIONAL
from backend.scalping.state import SORT_KEYS

router = APIRouter()

# Как долго помнить купленные инструменты в сокете стакана. Покупку в маркете
# терминал увидит без переподключения - не позже чем через полминуты.
RIGHTS_TTL = 30.0


@router.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    manager = websocket.app.state.ws_manager
    await websocket.accept()
    await manager.connect(websocket)
    try:
        await websocket.send_json({"event": "hello", "payload": {"symbols": active_symbols()}})
        while True:
            # Держим соединение; входящие сообщения игнорируем (канал односторонний).
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)


@router.websocket("/ws")
async def ws_authed(websocket: WebSocket, token: str = Query(default="")):
    config = websocket.app.state.config
    try:
        payload = decode_token(token, config.jwt_secret)
        if payload.get("type") != "access":
            raise TokenError("Нужен access-токен")
    except TokenError:
        await websocket.close(code=4401)
        return

    manager = websocket.app.state.ws_manager
    await websocket.accept()
    await manager.connect(websocket)
    try:
        await websocket.send_json({"event": "hello", "payload": {"sub": payload.get("sub")}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)


@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket, token: str = Query(default="")):
    """Общая комната: кто в ней и что пишут.

    История сюда не идёт - её листают страницами через ``/api/chat/messages``.
    Сокет отвечает только за живое: список присутствующих при входе и выходе
    каждого, новое сообщение всем сразу.

    Кто пришёл, спрашиваем у базы отдельной короткой сессией: в токене лежит
    только номер, а ленте нужны ник и аватарка - и такие же, как у остальных
    сообщений, иначе один человек выглядит в комнате двумя.
    """
    config = websocket.app.state.config
    try:
        payload = decode_token(token, config.jwt_secret)
        if payload.get("type") != "access":
            raise TokenError("Нужен access-токен")
    except TokenError:
        await websocket.close(code=4401)
        return

    hub = getattr(websocket.app.state, "chat_hub", None)
    if hub is None:
        await websocket.close(code=4503)
        return

    session = SessionLocal()
    try:
        try:
            student_id = int(payload["sub"])
        except (KeyError, TypeError, ValueError):
            await websocket.close(code=4401)
            return
        student = session.get(Student, student_id)
        if student is None or not student.is_active:
            await websocket.close(code=4401)
            return
        # То же правило «один вход на ученика», что и у HTTP-ручек
        # (backend/deps.py): вытесненное устройство не остаётся в комнате.
        if student.session_key and payload.get("sid") != student.session_key:
            await websocket.close(code=4401)
            return
        # Подпись собирается тем же правилом, что и в ленте: наставник идёт
        # школой, а не личным ником, и с короной.
        mentor = is_mentor(student)
        who = {
            "id": student.id,
            "name": student.card_name or (MENTOR_NAME if mentor else student.username or f"id{student.id}"),
            "avatar": student.avatar_url or "",
            "frame": student.avatar_frame or "",
            "mentor": mentor,
        }
    finally:
        session.close()

    await websocket.accept()
    await hub.join(websocket, who)
    try:
        await websocket.send_json(
            {"event": "hello", "payload": {"you": who, **await hub.presence()}}
        )
        while True:
            # Сообщения отправляются по HTTP: там же они и сохраняются. Здесь
            # читаем только для того, чтобы заметить разрыв.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(websocket)


@router.websocket("/ws/scalping")
async def ws_scalping(websocket: WebSocket, token: str = Query(default="")):
    """Скринер и стакан. Клиент сам говорит, какой инструмент открыт.

    Команды приходят JSON-сообщениями:

        {"action": "symbol", "symbol": "BTCUSDT", "rows": 40, "agg": 1,
         "exchange": "okx"}                      — книга своей биржи
        {"action": "symbol", "symbol": null}     — закрыть стакан
        {"action": "sort", "sort": "walls"}
        {"action": "foot", "time": 1757320800}   — какая свеча разобрана

    Кадры уходят событиями ``screener`` и ``dom``.
    """
    hub = getattr(websocket.app.state, "scalping_hub", None)
    if hub is None:
        await websocket.close(code=4503)  # сбор данных выключен в конфигурации
        return

    await websocket.accept()
    # Кто на том конце. Нужен звонку о счёте: об исполнении и снятой заявке
    # сервер узнаёт из приватного потока биржи и сообщает терминалу сюда же,
    # вместо того чтобы тот спрашивал по кругу. Токена нет или он чужой -
    # канал работает как раньше, только без звонков: стакан публичный.
    await hub.connect(websocket, _student_of(websocket, token))
    try:
        # Биржи, книгу которых сервер умеет показывать. Клиент по ним решает,
        # просить ли стакан своей биржи или остаться на общем.
        venues = list(getattr(hub.market, "exchanges", ()))
        await websocket.send_json(
            {"event": "hello", "payload": {"sorts": sorted(SORT_KEYS), "venues": venues}}
        )
        rights: frozenset[str] = frozenset()
        rights_at = float("-inf")
        while True:
            message = await websocket.receive_json()
            # Права перечитываются, чтобы покупку в маркете терминал увидел без
            # переподключения, - но не чаще раза в RIGHTS_TTL и не в цикле
            # событий: это запрос в синхронную базу, и на каждой команде каждого
            # клиента он держал весь сервер.
            now = time.monotonic()
            if now - rights_at >= RIGHTS_TTL:
                rights = await run_in_threadpool(
                    tools.rights_from_token, token, websocket.app.state.config.jwt_secret
                )
                rights_at = now
            await _handle_scalping_command(hub, websocket, message, rights)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — битый JSON или закрытое соединение
        pass
    finally:
        await hub.disconnect(websocket)


async def _handle_scalping_command(
    hub, websocket, message, rights: frozenset[str] = frozenset()
) -> None:
    """Применить одну команду клиента. Мусор молча игнорируем.

    Платное урезается по правам: глубже тридцати строк, шаг ×25 и разбор свечи
    - инструменты маркета. Без покупки сервер отдаёт бесплатный уровень, как
    бы его ни попросили.
    """
    if not isinstance(message, dict):
        return
    action = message.get("action")
    if action == "symbol":
        symbol = message.get("symbol")
        await hub.set_symbol(
            websocket,
            symbol if isinstance(symbol, str) and symbol else None,
            rows=tools.limit_rows(_clamp(message.get("rows"), DEFAULT_ROWS, 4, MAX_ROWS), rights),
            agg=tools.limit_agg(_clamp(message.get("agg"), 1, 1, 100), rights),
            shelf=_clamp_float(
                message.get("shelf"), SHELF_MIN_NOTIONAL, SHELF_MIN_LIMIT, SHELF_MAX_LIMIT
            ),
            interval=str(message.get("interval") or "1m")[:8],
            # Биржа ученика. Незнакомую не передаём дальше: книгу такой биржи
            # мы всё равно не держим, а реестр ответит подменой без причины.
            exchange=_venue(message.get("exchange")),
        )
    elif action == "foot":
        # Разбор свечи открыт или закрыт. Ноль означает «закрыт»: профиль
        # тяжелее всего остального в кадре, и слать его без нужды нельзя.
        at = _clamp(message.get("time"), 0, 0, 2 ** 40)
        await hub.set_foot(websocket, at if tools.can_footprint(rights) else 0)
    elif action == "sort":
        sort = message.get("sort")
        if isinstance(sort, str) and sort in SORT_KEYS:
            await hub.set_sort(websocket, sort)


def _student_of(websocket, token: str) -> int:
    """Ученик из токена канала. Ноль - токена нет или он не годится."""
    try:
        payload = decode_token(token, websocket.app.state.config.jwt_secret)
        if payload.get("type") != "access":
            return 0
        return int(payload.get("sub") or 0)
    except (TokenError, TypeError, ValueError):
        return 0


def _venue(value) -> str:
    """Код биржи из команды клиента: только буквы, коротко и в нижнем регистре."""
    text = str(value or "").strip().lower()
    return text[:16] if text.isalpha() else ""


def _clamp(value, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(int(value), high))
    except (TypeError, ValueError):
        return default


def _clamp_float(value, default: float, low: float, high: float) -> float:
    try:
        return max(low, min(float(value), high))
    except (TypeError, ValueError):
        return default
