"""Training WebSocket — real-time event bus for training sessions.

Bidirectional WebSocket connection carrying training tool invocations and
server-pushed events (scoring, heartbeat).

Protocol (JSON messages):

  Client → Server:
    { "type": "ping" }

  Server → Client:
    { "type": "<scoring_event>", … }            — forwarded from RealtimeHub
    { "type": "heartbeat" }

Phase 2.5：工具调用已迁 HTTP 指令面（POST /api/training/{id}/tools），
本通道只承载服务端推送事件。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from core.database import SessionLocal
from core.security import ALGORITHM, JWT_SECRET_KEY, _set_user_permissions
from models import User

log = logging.getLogger(__name__)

router = APIRouter()


async def _authenticate(token: str) -> User | None:
    from core.database import SessionLocal

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if not isinstance(user_id, int):
            log.warning("WS auth: user_id not int: %s", type(user_id))
            return None
    except jwt.PyJWTError as e:
        log.warning("WS auth: JWT decode failed: %s", e)
        return None

    db = SessionLocal()
    try:
        from sqlalchemy.orm import joinedload

        user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
        if not user:
            log.warning("WS auth: user %d not found", user_id)
            return None
        if not user.is_active:
            log.warning("WS auth: user %d inactive", user_id)
            return None
        token_tv = payload.get("tv", 0)
        if token_tv != user.token_version:
            log.warning(
                "WS auth: token_version mismatch tv=%d db=%d for user %d", token_tv, user.token_version, user_id
            )
            return None
        return user
    finally:
        db.close()


@router.websocket("/ws")
async def training_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
):
    await websocket.accept()
    user = await _authenticate(token)
    if not user:
        log.warning("WS auth failed — closing with 4001")
        await websocket.close(code=4001)
        return
    db = SessionLocal()
    try:
        _set_user_permissions(user, db)
    finally:
        db.close()
    if not user.has_permission("training_access"):
        log.warning("WS auth: user %d lacks training_access", user.id)
        await websocket.close(code=4003)
        return

    manager = websocket.app.state.realtime_hub
    queue = await manager.subscribe(user.id)

    # Both _handle_client and _handle_server may write to the same WebSocket.
    # Starlette/uvicorn do not guarantee concurrent-write safety, so serialize
    # every send through a single lock and swallow post-close writes.
    send_lock = asyncio.Lock()

    async def _safe_send(payload: dict) -> bool:
        try:
            async with send_lock:
                await websocket.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            return False

    async def _handle_client():
        while True:
            try:
                raw = await websocket.receive_json()
            except (WebSocketDisconnect, RuntimeError):
                return

            msg_type = raw.get("type")

            if msg_type == "ping":
                if not await _safe_send({"type": "pong"}):
                    return

    async def _handle_server():
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
            except TimeoutError:
                event = {"type": "heartbeat"}
            if not await _safe_send(event):
                return

    client_task = asyncio.create_task(_handle_client())
    server_task = asyncio.create_task(_handle_server())
    try:
        done, pending = await asyncio.wait({client_task, server_task}, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                t.result()
    except Exception:
        log.exception("WS error: user_id=%d", user.id)
    finally:
        for t in (client_task, server_task):
            t.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.gather(client_task, server_task, return_exceptions=True)
        manager.unsubscribe(user.id, queue)
