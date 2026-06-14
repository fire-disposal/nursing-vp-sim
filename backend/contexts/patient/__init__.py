"""患者 AI 子系统 — 统一入口"""

# 情绪引擎
from .emotion import (
    EmotionState,
    classify_intent,
    cleanup_emotion,
    get_emotion,
)

# 查体处理器
from .exam import (
    detect_operation,
    handle_operation,
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

# 提示词构建
from .prompt import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
    format_case_for_prompt,
)

# 提示词组装策略
from .sources import (
    ContextSource,
    collect_author_note,
    clear_sources,
    get_sources,
    register_source,
)

# 身份守卫策略
from .guards import (
    GuardResult,
    NoGuard,
    PatternGuard,
    PostGuard,
    get_guard,
    register_guard,
)

__all__ = [
    "ContextSource",
    "EmotionState",
    "GuardResult",
    "NoGuard",
    "PatternGuard",
    "PostGuard",
    "build_patient_chat_messages",
    "build_patient_context_kwargs",
    "check_initiate_ready",
    "classify_intent",
    "cleanup_emotion",
    "cleanup_initiative",
    "clear_sources",
    "collect_author_note",
    "detect_operation",
    "format_case_for_prompt",
    "generate_initiative",
    "get_emotion",
    "get_guard",
    "get_identity_correction_note",
    "get_initiative_seconds",
    "get_sources",
    "handle_operation",
    "has_identity_leak",
    "register_guard",
    "register_source",
    "should_initiate",
    "update_initiative_timer",
]
