"""流式语音识别 WebSocket —— 浏览器 PCM ↔ 豆包 SAUC 双向桥。

同源路径（浏览器 WS 不能带请求头，故 JWT 走查询参数，与训练事件通道一致）::

    GET /api/asr/stream?token=<jwt>&record_id=<id>   训练：本人记录，写 record_id
    GET /api/voice-demo/asr?token=<jwt>              演示：只要 training_access，
                                                     不校验记录，日志 record_id=NULL

两条路径共用同一个 ``_run_stream``（同一座桥、同一计费口径），差别只在鉴权时是否
校验记录归属与日志里的 ``record_id``。

Server → Browser（JSON）::

    {"type": "ready"}
    {"type": "partial", "text": "……"}     # 当前这句的实时快照，可被覆盖
    {"type": "definite", "text": "……"}    # 已定稿，只能追加
    {"type": "end"}
    {"type": "error", "message": "……"}

Browser → Server::

    二进制帧 = PCM16LE / 16kHz / mono（无帧头，直接转发）
    {"type": "stop"}                       # 结束送话：发负序号末包并等终稿

关闭码：4401 未配置 ASR、4001 鉴权失败、4003 无权限/非本人记录、4500 上游错误。

内存边界：服务端**不缓存音频** —— 每块 PCM 解包后立刻压缩成上游帧发出并丢弃。
只有发送队列限长（``_OUTBOX_MAX_CHUNKS``）用于吸收网络抖动，队列满即丢最旧的一块
（丢 200ms 音频对识别的影响远小于拖住整条连接）。另有单路总字节上限
``_MAX_AUDIO_BYTES``（约 10 分钟）兜底异常长连线，防止 2C4G 机器被拖住。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from core.database import SessionLocal
from core.websocket_auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED, authenticate_ws_token, resolve_ws_access
from infra.asr import protocol
from infra.asr.client import FINAL_WAIT_TIMEOUT, AsrSession, AsrUpstreamError
from modules.voice.asr_service import (
    AsrForbiddenError,
    AsrNotConfiguredError,
    assert_record_owner,
    load_asr_api_key,
    write_asr_log,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["ASR"])

#: 未配置 ASR（无 active VoiceConfig / 无 api_key）
WS_CLOSE_NOT_CONFIGURED = 4401
WS_CLOSE_UPSTREAM = 4500
WS_CLOSE_BAD_REQUEST = 4000

#: 发送队列上限：每块约 200ms 音频，20 块 ≈ 4 秒抖动余量。
_OUTBOX_MAX_CHUNKS = 20
#: 单路上行音频总时长上限（约 10 分钟；16k × 16bit × 1ch ≈ 32 KB/s）。
_MAX_AUDIO_BYTES = protocol.BYTES_PER_SECOND * 600
#: stop 之后等上游终稿的上限。
_FINAL_TIMEOUT = FINAL_WAIT_TIMEOUT

_STOP = object()
#: 分句缺少时间戳时的占位键（见 ``protocol.utterance_key``）
_NO_UTTERANCE_KEY = (-1, -1)


async def _send(websocket: WebSocket, lock: asyncio.Lock, payload: dict[str, Any]) -> bool:
    try:
        async with lock:
            await websocket.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError, OSError):
        return False


def _offer(outbox: asyncio.Queue[Any], item: Any) -> None:
    """非阻塞入队；满则丢最旧一块，永不阻塞事件循环。"""
    try:
        outbox.put_nowait(item)
        return
    except asyncio.QueueFull:
        pass
    with contextlib.suppress(asyncio.QueueEmpty):
        outbox.get_nowait()
    with contextlib.suppress(asyncio.QueueFull):
        outbox.put_nowait(item)


def _is_stop(text: str) -> bool:
    try:
        msg = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return False
    return isinstance(msg, dict) and msg.get("type") == "stop"


async def _pump_upload(session: AsrSession, outbox: asyncio.Queue[Any]) -> bool:
    """上游发送泵：按序转发 PCM；收到 ``_STOP`` 后补发负序号末包并返回。"""
    while True:
        item = await outbox.get()
        if item is _STOP:
            await session.finish()
            return True
        await session.send_audio(item)


def _take_new_definite(update: protocol.TranscriptUpdate, seen: set[tuple[int, int]]) -> list[str]:
    """取本次真正新增的定稿分句。

    同一分句会先以 interim 出现在 ``partial``、随后以 ``definite`` 重发一次，故按
    ``(start_time, end_time)`` 去重。缺时间戳时退回「同文本只收一次」——
    服务端一旦省略时间戳，重复文本本来就无法与真实重复区分。
    """
    fresh: list[str] = []
    for text, key in zip(update.definite, update.definite_keys, strict=True):
        identity = key if key != _NO_UTTERANCE_KEY else (-1, hash(text))
        if identity in seen:
            continue
        seen.add(identity)
        fresh.append(text)
    return fresh


async def _forward(session: AsrSession, websocket: WebSocket, state: dict[str, Any]) -> None:
    """上游接收泵：归一化 partial/definite 并转发；终稿包或关闭时返回。"""
    lock: asyncio.Lock = state["send_lock"]
    seen: set[tuple[int, int]] = state["definite_seen"]
    async for resp in session.receive():
        update = protocol.extract_transcript(resp.payload)
        fresh = _take_new_definite(update, seen)
        if fresh:
            state["final_parts"].extend(fresh)
            if not await _send(websocket, lock, {"type": "definite", "text": "".join(fresh)}):
                return
        if update.partial and not await _send(websocket, lock, {"type": "partial", "text": update.partial}):
            return


async def _authorize(
    websocket: WebSocket,
    token: str,
    record_id: int | None,
    *,
    persona: str = "",
    school: str = "",
) -> tuple[int, str] | None:
    """鉴权 +（训练路径）权限/记录归属 + 取密钥。失败时已按关闭码关闭连接。

    ``record_id is None`` 是语音演示路径：只验证系统内登录用户，不校验训练记录
    或 persona 权限；训练路径的校验与失败码保持原样。
    """
    identity = await asyncio.to_thread(authenticate_ws_token, token)
    if identity is None:
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return None
    if record_id is not None and not await asyncio.to_thread(
        resolve_ws_access, identity.user_id, persona=persona, school=school
    ):
        await websocket.close(code=WS_CLOSE_FORBIDDEN)
        return None
    if record_id is not None and record_id <= 0:
        await websocket.close(code=WS_CLOSE_BAD_REQUEST)
        return None

    db = SessionLocal()
    try:
        if record_id is not None:
            assert_record_owner(db, record_id, identity.user_id)
        return identity.user_id, load_asr_api_key(db)
    except AsrForbiddenError:
        await websocket.close(code=WS_CLOSE_FORBIDDEN)
    except AsrNotConfiguredError:
        await websocket.close(code=WS_CLOSE_NOT_CONFIGURED)
    except (OSError, RuntimeError) as e:
        log.warning("ASR: config/ownership check failed record_id=%s error=%s", record_id, type(e).__name__)
        await websocket.close(code=WS_CLOSE_UPSTREAM)
    finally:
        db.close()
    return None


async def _run_stream(
    websocket: WebSocket,
    token: str,
    record_id: int | None,
    *,
    persona: str = "",
    school: str = "",
) -> None:
    """一条 ASR 连线的完整生命周期：鉴权 → 连接上游 → 双向桥 → 计费日志 → 关闭。

    ``record_id is None`` 为语音演示：同样的上游桥接与计费口径，但日志
    ``record_id`` 写 NULL（``VoiceCallLog.record_id`` 可空），不涉及训练记录。
    """
    await websocket.accept()

    authorized = await _authorize(websocket, token, record_id, persona=persona, school=school)
    if authorized is None:
        return
    user_id, api_key = authorized

    state: dict[str, Any] = {
        "send_lock": asyncio.Lock(),
        "record_id": record_id,
        "audio_bytes": 0,
        "final_parts": [],
        "definite_seen": set(),
    }
    started = time.perf_counter()
    session = AsrSession(api_key=api_key)
    status = "error"
    try:
        try:
            await session.connect()
            await session.send_full_request()
        except AsrUpstreamError as e:
            log.warning("ASR upstream unavailable: record_id=%s error=%s", record_id, e)
            await _send(websocket, state["send_lock"], {"type": "error", "message": str(e)})
            return

        if not await _send(websocket, state["send_lock"], {"type": "ready"}):
            return

        if await _bridge(websocket, session, state):
            status = "success"
    except (WebSocketDisconnect, RuntimeError):
        pass
    except AsrUpstreamError as e:
        log.warning("ASR stream failed: record_id=%s error=%s", record_id, e)
        await _send(websocket, state["send_lock"], {"type": "error", "message": str(e)})
    except (OSError, ValueError) as e:
        log.warning("ASR stream crashed: record_id=%s error=%s", record_id, type(e).__name__)
        await _send(websocket, state["send_lock"], {"type": "error", "message": "语音识别失败"})
    finally:
        await session.close()
        write_asr_log(
            user_id=user_id,
            record_id=record_id,
            audio_bytes=state["audio_bytes"],
            text_length=len("".join(state["final_parts"])),
            latency_ms=int((time.perf_counter() - started) * 1000),
            status=status,
        )
        with contextlib.suppress(RuntimeError, WebSocketDisconnect, OSError):
            await websocket.close()


@router.websocket("/api/asr/stream")
async def asr_stream(
    websocket: WebSocket,
    token: str = Query(default=""),
    record_id: int = Query(default=0),
    persona: str = Query(default=""),
    school: str = Query(default=""),
):
    """训练路径：必须带本人 record_id（``0``/缺失 → 4000 提前关闭）。"""
    await _run_stream(websocket, token, record_id, persona=persona, school=school)


@router.websocket("/api/voice-demo/asr")
async def voice_demo_asr(
    websocket: WebSocket,
    token: str = Query(default=""),
):
    """语音演示路径：只验证系统内登录用户；不需要 record_id、persona 或院校。"""
    await _run_stream(websocket, token, None)


async def _next_client_message(receive_task: asyncio.Task, download_task: asyncio.Task) -> dict[str, Any] | None:
    """等浏览器消息，同时感知下载泵结束（上游终稿/断开）→ 返回 ``None``。

    复用同一个 ``receive_task``：Starlette 的 ``receive()`` 不能反复取消重建，
    否则中途取消会吞掉一条已从 socket 取出的消息。
    """
    done, _ = await asyncio.wait({receive_task, download_task}, return_when=asyncio.FIRST_COMPLETED)
    if receive_task in done:
        return receive_task.result()
    return None


async def _bridge(websocket: WebSocket, session: AsrSession, state: dict[str, Any]) -> bool:
    """浏览器 ↔ 上游双向并发转发。返回 ``True`` 表示正常收尾（收到 stop 并拿到终稿）。"""
    outbox: asyncio.Queue[Any] = asyncio.Queue(maxsize=_OUTBOX_MAX_CHUNKS)
    upload_task = asyncio.create_task(_pump_upload(session, outbox))
    download_task = asyncio.create_task(_forward(session, websocket, state))
    receive_task = asyncio.create_task(websocket.receive())
    finishing = False
    try:
        while not (upload_task.done() or download_task.done() or receive_task.done()):
            message = await _next_client_message(receive_task, download_task)
            if message is None:
                return False  # 上游已终稿/断开：没有更多识别结果可等
            if message.get("type") == "websocket.disconnect":
                return False
            chunk = message.get("bytes")
            if chunk:
                state["audio_bytes"] += len(chunk)
                if state["audio_bytes"] > _MAX_AUDIO_BYTES:
                    log.warning("ASR: audio cap reached (record_id=%s)", state["record_id"])
                    break
                _offer(outbox, chunk)
                receive_task = asyncio.create_task(websocket.receive())
                continue
            text = message.get("text")
            if text and _is_stop(text):
                # 末包必须发出去，否则服务端 8s 后报 waiting next packet timeout。
                _offer(outbox, _STOP)
                finishing = True
                break
            receive_task = asyncio.create_task(websocket.receive())

        if not finishing:
            return False

        await asyncio.wait_for(upload_task, timeout=_FINAL_TIMEOUT)
        # 上游收到末包后仍会推终稿；给它一个上限，等不到也不能把用户挂住。
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(asyncio.shield(download_task), timeout=_FINAL_TIMEOUT)
        return True
    except (WebSocketDisconnect, RuntimeError, OSError):
        return False  # 浏览器侧已断开
    finally:
        for task in (upload_task, download_task, receive_task):
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.gather(upload_task, download_task, receive_task, return_exceptions=True)
        await _send(websocket, state["send_lock"], {"type": "end"})
