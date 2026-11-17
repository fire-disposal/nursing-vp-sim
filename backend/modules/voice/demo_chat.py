"""语音实验室 —— 一轮自由对话的流式生成（LLM → SSE 帧）。

与训练对话的差别只有"不落库"：没有训练记录、没有消息表、没有评分、没有回合状态机。
它复用的正是训练路径的 LLM 基础设施——同一个 ``app.state.llm_client``、同一套 provider
路由与调用日志，只是 ``purpose="voice_demo"``（独立 profile、独立成本标签）、
``record_id=None``（日志里一眼看出不是训练）。

SSE 帧形状刻意与训练对话保持一致，前端两套播放器可以共用：::

    data: {"content": "……"}                 # 增量文本
    data: {"done": true, "character_id": …, "emotion_state": …, "speaker": …}
    data: {"error": "……", "code": "chat.llm_unavailable"}

错误处理沿用训练流的口径（``chat.llm_unavailable`` / ``chat.llm_empty_reply``），并且
**客户端级重试置 0**、重试放在本层：否则流中断重试会把已下发的内容从头重放一遍。
重试只在"还没发出任何内容"时进行——已经说了一半再整段重说会变成两个人抢话。
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from sqlalchemy.exc import SQLAlchemyError

from core.database import SessionLocal
from infra.llm.client import CallContext
from infra.llm.profile import get_llm_config
from models import VoiceDemoLog
from modules.training.pipeline.turn import ERROR_LLM_EMPTY_REPLY, ERROR_LLM_UNAVAILABLE
from modules.voice.demo_prompt import DemoCharacter, build_messages

log = logging.getLogger(__name__)

#: 调用日志/成本聚合用的独立用途标签（与 ``infra/llm/profile.py`` 的 profile 同名）。
PURPOSE = "voice_demo"


def sse_frame(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def append_demo_logs(
    rows: list[dict],
) -> None:
    """批量追加语音实验室采集行（独立 session + commit，best-effort）。

    与 ``TTSService._write_log`` 同理由：请求会话只 close 不 commit，流式路径还会在
    中途 rollback，挂在请求事务上的行会一起消失。采集失败绝不能影响学生已经听到的
    回答，因此异常只记日志。
    """
    if not rows:
        return
    try:
        with SessionLocal() as db:
            db.add_all([VoiceDemoLog(**row) for row in rows])
            db.commit()
    except (SQLAlchemyError, OSError, RuntimeError):
        log.warning("voice_demo: failed to append demo logs", exc_info=True)


def error_frame(message: str, code: str) -> str:
    """错误帧：``error`` 保持训练流既有形状，另带稳定 ``code``。"""
    return sse_frame({"error": (message or "生成失败")[:200], "code": code})


def _log_row(
    user_id: int,
    session_id: str,
    character: DemoCharacter,
    role: str,
    content: str,
    emotion_state: str,
    status: str,
    error: str | None,
) -> dict:
    """一行 ``voice_demo_logs``。情绪快照按原样 JSONB 存（前端状态机给什么存什么）。"""
    return {
        "user_id": user_id,
        "session_id": session_id[:64],
        "character_id": character.id,
        "role": role,
        "content": content,
        "emotion_state": {"dominant_state": emotion_state},
        "status": status,
        "error": error,
    }


async def stream_demo_reply(
    *,
    llm_client,
    character: DemoCharacter,
    history: list[dict],
    emotion_state: str,
    user_id: int,
    session_id: str,
    long_response: bool = False,
) -> AsyncIterator[str]:
    """产出 SSE 帧：内容块 → done，或错误帧。

    本轮结束后把**学生消息 + 角色回复**追加进 ``voice_demo_logs``（实验采集）。
    中断/失败时保留已经说出去的部分并标 ``interrupted``/``error``——采集关心的是
    "学生实际听到了什么"，不是复现完整对话。这里没有训练记录、消息表或评分。
    """
    messages = build_messages(character, emotion_state, history, long_response=long_response)
    llm_cfg = {**get_llm_config(PURPOSE), "max_retries": 0}
    call_ctx = CallContext(purpose=PURPOSE, user_id=user_id, record_id=None)
    last_user = next((item["content"] for item in reversed(history) if item.get("role") == "user"), "")

    def _write(status: str, reply: str, error: str | None) -> None:
        rows = [
            _log_row(user_id, session_id, character, "user", last_user, emotion_state, "success", None),
            _log_row(user_id, session_id, character, "assistant", reply, emotion_state, status, error),
        ]
        append_demo_logs(rows)

    emitted = 0
    reply: list[str] = []
    for attempt in range(2):
        try:
            async for chunk in llm_client.stream(messages, purpose=PURPOSE, ctx=call_ctx, **llm_cfg):
                emitted += 1
                reply.append(chunk)
                yield sse_frame({"content": chunk})
        except Exception as e:  # noqa: BLE001 - LLM/网络/解析异常统一按不可用处理
            log.warning(
                "voice_demo LLM stream failed: character=%s user_id=%s attempt=%d emitted=%d error=%s",
                character.id,
                user_id,
                attempt,
                emitted,
                type(e).__name__,
                exc_info=True,
            )
            error = f"{type(e).__name__}: {str(e)[:300]}"
            if emitted:
                # 已经说出去了：原样保留，标 interrupted（打断点的分析价值全在这半句）
                _write("interrupted", "".join(reply), error)
                yield error_frame("对话中断，请重试", ERROR_LLM_UNAVAILABLE)
                return
            if attempt == 1:
                _write("error", "", error)
                yield error_frame("LLM 服务暂时不可用，请稍后重试", ERROR_LLM_UNAVAILABLE)
                return
            reply.clear()
            continue

        if emitted == 0:
            log.warning("voice_demo LLM empty reply: character=%s user_id=%s", character.id, user_id)
            _write("error", "", ERROR_LLM_EMPTY_REPLY)
            yield error_frame("对方没有回话，请重试", ERROR_LLM_EMPTY_REPLY)
            return
        break

    _write("success", "".join(reply), None)
    yield sse_frame(
        {
            "done": True,
            "character_id": character.id,
            "emotion_state": emotion_state,
            "speaker": character.speaker,
            "long_response": long_response,
        }
    )
