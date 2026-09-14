"""Training Pipeline — composable middleware chain for message processing.

Pipeline order (fixed, per ``stages.PipelineStage``):
  1. ANALYSIS     — ``emotion_analysis``: 4D emotion state + behavior note
  2. PROMPT       — ``prompt_builder``: case data → system + user prompt
  3. LLM          — ``llm_caller``: call LLM, record call log (best-effort)
  4. PERSIST      — ``persister``: save Message + update runtime_state (must-succeed,
                     runs inside a DB transaction; failure aborts the request)
  5. SIDE_EFFECTS — ``side_effects``: emotion/initiative updates, SSE events,
                     correction tracking (best-effort, failures are logged and dropped)

Assembly: ``build_pipeline()`` constructs the ordered middleware list + a
``NoteCollector`` seeded from ``TRAINING_PROFILE.note_sources``.
"""

from .builder import build_pipeline
from .context import (
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
    PipelineContext,
)
from .runner import run_pipeline, stream_pipeline
from .stages import PipelineMiddleware, PipelineStage, stage_order

__all__ = [
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
    "PipelineContext",
    "PipelineMiddleware",
    "PipelineStage",
    "build_pipeline",
    "run_pipeline",
    "stage_order",
    "stream_pipeline",
]
