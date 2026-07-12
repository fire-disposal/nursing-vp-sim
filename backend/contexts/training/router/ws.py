"""Training WebSocket — real-time event bus for training sessions.

Replaces the REST exam endpoint + SSE notifications stream with a single
bidirectional WebSocket connection.

Protocol (JSON messages):

  Client → Server:
    { "type": "exam",  "record_id": 123, "op_type": "hr" }
    { "type": "ping" }

  Server → Client:
    { "type": "exam:done",  "data": { … }, "all_results": […] }
    { "type": "exam:error", "detail": "…" }
    { "type": "<scoring_event>", … }            — forwarded from RealtimeHub
    { "type": "heartbeat" }
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import jwt
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from core.database import SessionLocal
from core.security import ALGORITHM, JWT_SECRET_KEY
from models import User
from services.physical_exam import PhysicalExamService

log = logging.getLogger(__name__)

router = APIRouter()


async def _authenticate(token: str) -> User | None:
    from core.database import SessionLocal

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if not isinstance(user_id, int):
            return None
    except jwt.PyJWTError:
        return None

    db = SessionLocal()
    try:
        from sqlalchemy.orm import joinedload

        user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return None
        token_tv = payload.get("tv", 0)
        if token_tv != user.token_version:
            return None
        return user
    finally:
        db.close()


@router.websocket("/ws")
async def training_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
):
    user = await _authenticate(token)
    if not user:
        await websocket.close(code=4001)
        return

    await websocket.accept()

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

            if msg_type == "exam":
                record_id = raw.get("record_id")
                op_type = raw.get("op_type")
                if not record_id or not op_type:
                    if not await _safe_send({"type": "error", "detail": "Missing record_id or op_type"}):
                        return
                    continue

                db = SessionLocal()
                try:
                    svc = PhysicalExamService(db)
                    result = svc.perform(record_id, op_type, user)
                    ok = await _safe_send(
                        {
                            "type": "exam:done",
                            "op_type": result["type"],
                            "data": result["data"],
                            "all_results": result["all_results"],
                            # D-2：让前端闭环 scene:state（MonitorCard 据此显示生命体征）
                            "scene": {"vitals": result.get("vitals_patch", {})},
                        }
                    )
                except HTTPException as e:
                    ok = await _safe_send({"type": "exam:error", "detail": e.detail})
                except Exception as e:
                    log.exception("WS exam failed")
                    ok = await _safe_send({"type": "exam:error", "detail": str(e)})
                finally:
                    db.close()
                if not ok:
                    return

            elif msg_type == "ping":
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
        with contextlib.suppress(Exception):
            await asyncio.gather(client_task, server_task, return_exceptions=True)
        manager.unsubscribe(user.id, queue)
