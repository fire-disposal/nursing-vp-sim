"""Training Pipeline —— 一轮对话的显式五阶段编排。

顺序契约住在 ``runner.STAGES``（源码顺序即执行顺序）：

  1. ANALYSIS     —— ``emotion_analysis``: 4D 情绪状态 + behavior note
  2. PROMPT       —— ``prompt_builder``: 取料 + ContextAssembler 装配 system/user prompt
  3. LLM          —— ``llm_caller``: 调用 LLM，写调用日志（best-effort）
  4. PERSIST      —— ``persister``: 事务 B（患者消息 + turn 收尾；学生消息已在
                     ``begin_turn`` 的事务 A 落库，见 turn.py）
  5. SIDE_EFFECTS —— ``side_effects``: emotion/initiative 更新、SSE 事件、
                     correction 追踪（best-effort，失败只记日志）

NoteCollector 的装配在 ``builder.build_note_collector``（只决定"有哪些上下文来源"，
不参与阶段排序）。
"""

from .builder import build_note_collector
from .context import (
    STATE_ASSEMBLER,
    STATE_CORRECTION_TARGET,
    STATE_CORRECTION_TURN,
    STATE_DONE_PAYLOAD,
    STATE_EMOTION_CHANGE,
    STATE_EMOTION_DOMINANT,
    STATE_EMOTION_NOTE,
    STATE_FEATURES,
    STATE_LEAK_CORRECTION_COUNT,
    STATE_PATIENT_CHAT_CFG,
    STATE_PATIENT_CONTEXT_KWARGS,
    STATE_PIPELINE_TASK,
    STATE_SAVED_MESSAGES,
    STATE_STREAM_MODE,
    STATE_TURN,
    MessageView,
    PipelineContext,
    message_views,
)
from .runner import STAGES, abandoned_stream_count, run_pipeline, stream_pipeline
from .turn import TURN_KIND

__all__ = [
    "STAGES",
    "STATE_ASSEMBLER",
    "STATE_CORRECTION_TARGET",
    "STATE_CORRECTION_TURN",
    "STATE_DONE_PAYLOAD",
    "STATE_EMOTION_CHANGE",
    "STATE_EMOTION_DOMINANT",
    "STATE_EMOTION_NOTE",
    "STATE_FEATURES",
    "STATE_LEAK_CORRECTION_COUNT",
    "STATE_PATIENT_CHAT_CFG",
    "STATE_PATIENT_CONTEXT_KWARGS",
    "STATE_PIPELINE_TASK",
    "STATE_SAVED_MESSAGES",
    "STATE_STREAM_MODE",
    "STATE_TURN",
    "TURN_KIND",
    "MessageView",
    "PipelineContext",
    "abandoned_stream_count",
    "build_note_collector",
    "message_views",
    "run_pipeline",
    "stream_pipeline",
]
