"""患者 AI 子系统 —— 统一入口

角色扮演核心栈：
  prompts.patient_chat       — Character Card 模板（静态缓存 + 动态变量）
  virtual_patient_prompt     — 上下文组装（10 变量 → messages 数组）
  patient_guard              — 身份泄露检测（仅 11 模式，其余由 prompt 约束）
  emotion_engine             — 5 态情绪状态机（规则驱动，不调 LLM）
  patient_initiative         — 主动行为引擎（非语言线索 + 自发话语池）
  exam_handler               — 查体操作处理（/bp /vitals 等关键词 → 锚点数据）

管线：
  chat.py → _build_llm_messages → prompt 渲染 + emotion 更新
           → _generate_patient_reply → LLM 调用 + guard 检测 + 身份泄露重试
           → update_initiative_timer → 重置主动行为计时器

训练生命周期：
  start → init emotion | each turn → classify_intent → emotion.update
        | patient reply → update_initiative_timer
  end   → cleanup_emotion + cleanup_initiative
"""

# ── 情绪引擎 ──
from services.emotion_engine import (
    EmotionState,
    classify_intent,
    cleanup_emotion,
    get_emotion,
)

# ── 患者守卫 ──
from services.patient_guard import (
    get_identity_correction_note,
    has_identity_leak,
)

# ── 主动行为引擎 ──
from services.patient_initiative import (
    cleanup_initiative,
    generate_initiative,
    get_initiative_seconds,
    should_initiate,
    update_initiative_timer,
)

# ── 查体处理器 ──
from services.exam_handler import (
    detect_operation,
    handle_operation,
)

# ── 提示词构建 ──
from services.virtual_patient_prompt import (
    build_patient_chat_messages,
    build_patient_context_kwargs,
    format_case_for_prompt,
)

__all__ = [
    # emotion
    "EmotionState", "classify_intent", "cleanup_emotion", "get_emotion",
    # guard
    "get_identity_correction_note", "has_identity_leak",
    # initiative
    "cleanup_initiative", "generate_initiative", "get_initiative_seconds",
    "should_initiate", "update_initiative_timer",
    # exam
    "detect_operation", "handle_operation",
    # prompt
    "build_patient_chat_messages", "build_patient_context_kwargs",
    "format_case_for_prompt",
]
