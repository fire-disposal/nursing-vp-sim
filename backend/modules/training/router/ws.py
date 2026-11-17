"""Training WebSocket — **仅服务端事件推送**（训练会话的通知通道）。

Protocol (JSON messages):

  Connect (查询参数，与 HTTP 请求头同语义):
    ?token=<jwt>&persona=<X-View-Persona>&school=<X-School-Scope>
    —— 浏览器 WebSocket 不能自带请求头，视角/院校只能走查询参数；缺省时按默认视角解析，
    平台账号会落到 `platform` 视角（无 `training_access` → 4003）。

  Client → Server:
    { "type": "ping" }                          — 连接保活；本通道唯一的出站客户端消息

  Server → Client:
    { "type": "<scoring_event>", … }            — forwarded from PgRealtimeHub
    { "type": "heartbeat" }

写入边界:

  * **工具/活动命令** → ``POST /api/training/{record_id}/tools``（HTTP，唯一写入 owner）；
  * **聊天回合** → ``POST /api/chat/{record_id}/message/stream``（SSE，唯一写入 owner）；
  * **本通道** → 只推送服务端事件（评分进度 / 心跳）。客户端不得借此改状态，
    服务端在此不落任何业务行 —— 前端收到事件只做「通知 + 失效查询缓存」。

Phase 2.5：工具调用已迁 HTTP 指令面，本通道不再承载任何业务命令。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from core.websocket_auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, authenticate_ws_token, resolve_ws_access

log = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def training_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
    persona: str = Query(default=""),
    school: str = Query(default=""),
):
    await websocket.accept()
    identity = await asyncio.to_thread(authenticate_ws_token, token)
    if identity is None:
        log.warning("WS auth failed — closing with 4001")
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return
    # 浏览器 WebSocket 不能自带请求头，故视角/院校以查询参数传入 —— 语义与 HTTP 的
    # `X-View-Persona` / `X-School-Scope` 完全一致，走同一个 `resolve_access`。
    # 缺省（旧客户端）解析默认视角：平台账号落到 `platform` 视角，它不带 `training_access`，
    # 于是训练页的推送通道被 4003 拒掉并无限重连。
    if not await asyncio.to_thread(resolve_ws_access, identity.user_id, persona=persona, school=school):
        await websocket.close(code=WS_CLOSE_FORBIDDEN)
        return

    user_id = identity.user_id
    manager = websocket.app.state.realtime_hub
    queue = await manager.subscribe(user_id)

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
        log.exception("WS error: user_id=%d", user_id)
    finally:
        for t in (client_task, server_task):
            t.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.gather(client_task, server_task, return_exceptions=True)
        manager.unsubscribe(user_id, queue)
