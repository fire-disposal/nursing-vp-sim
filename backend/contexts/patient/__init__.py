"""患者 AI 子系统 — 统一入口"""

# 情绪引擎
from .emotion import (
    EmotionState,
    classify_intent,
    cleanup_emotion,
    get_emotion,
)

# 患者守卫
from .guard import (
    get_identity_correction_note,
    has_identity_leak,
)

# 主动行为引擎
from .initiative import (
    check_initiate_ready,
    cleanup_initiative,
    generate_initiative,
    get_initiative_seconds,
    should_initiate,
    update_initiative_timer,
)

# 查体处理器
from .exam import (
    detect_operation,
    handle_operation,
)

# 提示词构建
from .prompt import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
    format_case_for_prompt,
)

__all__ = [
    "EmotionState", "classify_intent", "cleanup_emotion", "get_emotion",
    "get_identity_correction_note", "has_identity_leak",
    "check_initiate_ready", "cleanup_initiative", "generate_initiative",
    "get_initiative_seconds", "should_initiate", "update_initiative_timer",
    "detect_operation", "handle_operation",
    "build_patient_chat_messages", "build_patient_context_kwargs", "format_case_for_prompt",
]
