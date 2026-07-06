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
import json
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

    async def _handle_client():
        while True:
            try:
                raw = await websocket.receive_json()
            except WebSocketDisconnect:
                return

            msg_type = raw.get("type")

            if msg_type == "exam":
                record_id = raw.get("record_id")
                op_type = raw.get("op_type")
                if not record_id or not op_type:
                    await websocket.send_json({"type": "error", "detail": "Missing record_id or op_type"})
                    continue

                db = SessionLocal()
                try:
                    svc = PhysicalExamService(db)
                    result = svc.perform(record_id, op_type, user)
                    await websocket.send_json(
                        {
                            "type": "exam:done",
                            "op_type": result["type"],
                            "data": result["data"],
                            "all_results": result["all_results"],
                        }
                    )
                except HTTPException as e:
                    await websocket.send_json({"type": "exam:error", "detail": e.detail})
                except Exception as e:
                    log.exception("WS exam failed")
                    await websocket.send_json({"type": "exam:error", "detail": str(e)})
                finally:
                    db.close()

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    async def _handle_server():
        while True:
            try:
                raw = await asyncio.wait_for(queue.get(), timeout=30)
                event_type = ""
                data: dict = {}
                for line in raw.strip().split("\n"):
                    if line.startswith("event: "):
                        event_type = line[7:]
                    elif line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            data = {}
                await websocket.send_json({"type": event_type, **data})
            except TimeoutError:
                try:
                    await websocket.send_json({"type": "heartbeat"})
                except WebSocketDisconnect:
                    return

    try:
        await asyncio.gather(_handle_client(), _handle_server())
    except WebSocketDisconnect:
        log.info("WS disconnected: user_id=%d", user.id)
    except Exception:
        log.exception("WS error: user_id=%d", user.id)
    finally:
        manager.unsubscribe(user.id, queue)
