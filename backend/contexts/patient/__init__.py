"""患者 AI 子系统 — 统一入口"""

# 情绪引擎
from .emotion import (
    EmotionState,
    cleanup_emotion,
    get_emotion,
)

# 查体处理器
from .exam import (
    detect_operation,
    get_exam_config,
    handle_operation,
)

# 患者守卫
from .guards import (
    get_identity_correction_note,
    has_identity_leak,
)

# 主动行为引擎
from .initiative import (
    MAX_INITIATIVE_COUNT,
    apply_initiative_penalty,
    check_initiate_ready,
    cleanup_initiative,
    generate_initiative,
    generate_initiative_llm,
    get_initiative_seconds,
    should_initiate,
    update_initiative_timer,
)

# NoteSource 实例
from .note_source import (
    EmotionNoteSource,
    ExamImpactSource,
    ExamResultsSource,
    IdentityGuardSource,
    NoteSource,
)

# 提示词构建
from .prompt import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
    format_case_for_prompt,
)

__all__ = [
    "EmotionNoteSource",
    "EmotionState",
    "ExamImpactSource",
    "ExamResultsSource",
    "IdentityGuardSource",
    "NoteSource",
    "build_patient_chat_messages",
    "build_patient_context_kwargs",
    "check_initiate_ready",
    "cleanup_emotion",
    "cleanup_initiative",
    "detect_operation",
    "format_case_for_prompt",
    "generate_initiative",
    "generate_initiative_llm",
    "get_emotion",
    "get_exam_config",
    "get_identity_correction_note",
    "get_initiative_seconds",
    "handle_operation",
    "has_identity_leak",
    "should_initiate",
    "update_initiative_timer",
]
