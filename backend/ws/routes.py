"""WebSocket-эндпоинты (ТЗ §9.1).

``/ws/prices`` — публичный канал цен; ``/ws`` — авторизованный канал (JWT в query) для
персональных событий (новые сигналы, баланс); ``/ws/scalping`` — скринер и
стакан с подпиской на конкретный инструмент; ``/ws/chat`` — общая комната:
присутствие и новые сообщения.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from core.db import SessionLocal
from core.models import Student

from backend.api.chat import MENTOR_NAME
from backend.mentor import is_mentor
from backend.security import decode_token, TokenError
from backend.price_collector import active_symbols
from backend.scalping.ladder import DEFAULT_ROWS, MAX_ROWS
from backend.scalping.metrics import SHELF_MAX_LIMIT, SHELF_MIN_LIMIT, SHELF_MIN_NOTIONAL
from backend.scalping.state import SORT_KEYS

router = APIRouter()


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
        student = session.get(Student, int(payload["sub"]))
        if student is None or not student.is_active:
            await websocket.close(code=4401)
            return
        # Подпись собирается тем же правилом, что и в ленте: наставник идёт
        # школой, а не личным ником, и с короной.
        mentor = is_mentor(student)
        who = {
            "id": student.id,
            "name": student.card_name or (MENTOR_NAME if mentor else student.username or f"id{student.id}"),
            "avatar": student.avatar_url or "",
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
async def ws_scalping(websocket: WebSocket):
    """Скринер и стакан. Клиент сам говорит, какой инструмент открыт.

    Команды приходят JSON-сообщениями:

        {"action": "symbol", "symbol": "BTCUSDT", "rows": 40, "agg": 1}
        {"action": "symbol", "symbol": null}     — закрыть стакан
        {"action": "sort", "sort": "walls"}

    Кадры уходят событиями ``screener`` и ``dom``.
    """
    hub = getattr(websocket.app.state, "scalping_hub", None)
    if hub is None:
        await websocket.close(code=4503)  # сбор данных выключен в конфигурации
        return

    await websocket.accept()
    await hub.connect(websocket)
    try:
        await websocket.send_json({"event": "hello", "payload": {"sorts": sorted(SORT_KEYS)}})
        while True:
            message = await websocket.receive_json()
            await _handle_scalping_command(hub, websocket, message)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — битый JSON или закрытое соединение
        pass
    finally:
        await hub.disconnect(websocket)


async def _handle_scalping_command(hub, websocket, message) -> None:
    """Применить одну команду клиента. Мусор молча игнорируем."""
    if not isinstance(message, dict):
        return
    action = message.get("action")
    if action == "symbol":
        symbol = message.get("symbol")
        await hub.set_symbol(
            websocket,
            symbol if isinstance(symbol, str) and symbol else None,
            rows=_clamp(message.get("rows"), DEFAULT_ROWS, 4, MAX_ROWS),
            agg=_clamp(message.get("agg"), 1, 1, 100),
            shelf=_clamp_float(
                message.get("shelf"), SHELF_MIN_NOTIONAL, SHELF_MIN_LIMIT, SHELF_MAX_LIMIT
            ),
            interval=str(message.get("interval") or "1m")[:8],
        )
    elif action == "sort":
        sort = message.get("sort")
        if isinstance(sort, str) and sort in SORT_KEYS:
            await hub.set_sort(websocket, sort)


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
