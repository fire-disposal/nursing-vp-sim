"""Training Pipeline — composable middleware chain for message processing.

Pipeline order (fixed, per ``stages.PipelineStage``):
  1. ANALYSIS     — ``emotion_analysis``: 4D emotion state + behavior note
  2. PROMPT       — ``prompt_builder``: 取料 + ContextAssembler 装配 system/user prompt
  3. LLM          — ``llm_caller``: call LLM, record call log (best-effort)
  4. PERSIST      — ``persister``: 事务 B（患者消息 + turn 收尾；学生消息已在
                     ``begin_turn`` 的事务 A 落库，见 turn.py）
  5. SIDE_EFFECTS — ``side_effects``: emotion/initiative updates, SSE events,
                     correction tracking (best-effort, failures are logged and dropped)

Assembly: ``build_pipeline()`` constructs the ordered middleware list + a
``NoteCollector`` seeded from the workflow's ``note_sources``.
"""

from .builder import build_pipeline
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
from .runner import run_pipeline, stream_pipeline
from .stages import PipelineMiddleware, PipelineStage, stage_order

__all__ = [
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
    "MessageView",
    "PipelineContext",
    "PipelineMiddleware",
    "PipelineStage",
    "build_pipeline",
    "message_views",
    "run_pipeline",
    "stage_order",
    "stream_pipeline",
]
