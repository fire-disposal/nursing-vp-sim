"""四维情绪系统 (v3) — 事件驱动 + 行为派生。

Phase 2 (T8)：v2 兼容层已删除（EmotionCache/_legacy/emotion_profile/
_read_emotion_state），裸名 EmotionState 即 v3（见 .models）。

使用方式:
    from modules.training.patient_ai.emotion import (
        EmotionVector, EmotionDelta, EmoState, EmotionState,
        EmotionProfile, EmotionEngine, EmotionAnalyzer,
        derive_behavior, render_behavior_note, resolve_dominant_state,
        EmotionRepository,
    )
"""

from .analyzer import EmotionAnalyzer
from .behavior import PatientBehaviorPolicy, derive_behavior
from .engine import EmotionEngine
from .events import AppliedEmotionEvent, DetectedEmotionEvent, EmotionAnalysisResult, EmotionEventType
from .models import EmotionDelta, EmotionState, EmotionVector
from .models import EmotionState as EmoState
from .profile import EmotionProfile
from .renderer import derive_speech_policy, render_behavior_note, resolve_dominant_state
from .repository import EmotionRepository

__all__ = [
    "AppliedEmotionEvent",
    "DetectedEmotionEvent",
    # v3 models
    "EmoState",
    "EmotionAnalysisResult",
    # v3 analyzer
    "EmotionAnalyzer",
    "EmotionDelta",
    # v3 engine
    "EmotionEngine",
    # v3 events
    "EmotionEventType",
    # v3 profile
    "EmotionProfile",
    # repository
    "EmotionRepository",
    "EmotionState",
    "EmotionVector",
    # v3 behavior
    "PatientBehaviorPolicy",
    "derive_behavior",
    "derive_speech_policy",
    # v3 renderer
    "render_behavior_note",
    "resolve_dominant_state",
]
