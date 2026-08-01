"""四维情绪系统 (v3) — 事件驱动 + 行为派生。

向后兼容 v2: 旧 EmotionState、get_emotion、cleanup_emotion 等仍然可用。

使用方式:
    # v3 (新)
    from modules.training.patient_ai.emotion import (
        EmotionVector, EmotionDelta, EmoState,
        EmotionProfile, EmotionEngine, EmotionAnalyzer,
        derive_behavior, render_behavior_note, resolve_dominant_state,
    )
    # v2 (兼容)
    from modules.training.patient_ai.emotion import (
        EmotionState, get_emotion, cleanup_emotion,
    )
"""

# ── v3 新系统 ──
from ._legacy import (
    _STATE_TABLE,
    MAX_HISTORY,
    EmotionState,  # v2 EmotionState
    _build_author_note,
    _lookup_state,
    _s_curve,
    cleanup_emotion,
    get_emotion,
)
from .analyzer import EmotionAnalyzer
from .behavior import PatientBehaviorPolicy, derive_behavior
from .engine import EmotionEngine
from .events import AppliedEmotionEvent, DetectedEmotionEvent, EmotionAnalysisResult, EmotionEventType
from .models import EmotionDelta, EmotionVector
from .models import EmotionState as EmoState
from .profile import EmotionProfile
from .renderer import derive_speech_policy, render_behavior_note, resolve_dominant_state
from .repository import EmotionRepository

__all__ = [  # noqa: RUF022 — 按 v2/v3 分组注释排序，保持可读性
    # v3 models
    "EmoState",
    "EmotionVector",
    "EmotionDelta",
    # v3 profile
    "EmotionProfile",
    # v3 events
    "EmotionEventType",
    "DetectedEmotionEvent",
    "AppliedEmotionEvent",
    "EmotionAnalysisResult",
    # v3 engine
    "EmotionEngine",
    # v3 analyzer
    "EmotionAnalyzer",
    # v3 behavior
    "PatientBehaviorPolicy",
    "derive_behavior",
    # v3 renderer
    "render_behavior_note",
    "resolve_dominant_state",
    "derive_speech_policy",
    # repository
    "EmotionRepository",
    # v2 legacy
    "EmotionState",
    "get_emotion",
    "cleanup_emotion",
    "_STATE_TABLE",
    "_lookup_state",
    "_s_curve",
    "_build_author_note",
    "MAX_HISTORY",
]
