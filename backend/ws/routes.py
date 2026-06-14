"""WebSocket-эндпоинты (ТЗ §9.1).

``/ws/prices`` — публичный канал цен; ``/ws`` — авторизованный канал (JWT в query) для
персональных событий (новые сигналы, баланс, чат).
"""

from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.security import decode_token, TokenError
from backend.price_collector import active_symbols

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
