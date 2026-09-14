"""PipelineContext — shared state across middleware stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from models import Message, TrainingRecord, User

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# ---- ctx.state 字符串常量 ----
# 在中间件中使用这些常量替代裸字符串键，避免拼写错误并方便 IDE 跳转。

STATE_FEATURES: str = "features"
STATE_STREAM_MODE: str = "_stream_mode"
STATE_PATIENT_CONTEXT_KWARGS: str = "_patient_context_kwargs"
STATE_PATIENT_CHAT_CFG: str = "_patient_chat_cfg"
STATE_LEAK_CORRECTION_COUNT: str = "_leak_correction_count"
STATE_STREAM_QUEUE: str = "_stream_queue"
STATE_SAVED_MESSAGES: str = "_saved_messages"
STATE_DONE_PAYLOAD: str = "_done_payload"
STATE_CORRECTION_TARGET: str = "_correction_target"
# 修正轮序号（修正后的发言要重新分析情绪：turn_id 需要与被修正的那一轮区分开）
STATE_CORRECTION_TURN: str = "_correction_turn"
# 情绪中间件写、NoteSource（patient_ai.notes）与 side_effects 读
STATE_EMOTION_NOTE: str = "_emotion_note"
STATE_EMOTION_CHANGE: str = "_emotion_change"
STATE_EMOTION_DOMINANT: str = "_emotion_dominant"
# stream_pipeline 创建的后台任务：router 据此判断 session 该由谁释放（见 runner.stream_pipeline）
STATE_PIPELINE_TASK: str = "_pipeline_task"
# 患者决定中止访谈（不可逆敌意区）→ 会话在 SIDE_EFFECTS 阶段终结
STATE_PATIENT_WALKOUT: str = "_patient_walkout"


@dataclass
class PipelineContext:
    record: TrainingRecord
    case_data: dict
    current_user: User
    db: Session
    app_state: Any

    student_input: str = ""
    student_display: str = ""
    messages: list[Message] = field(default_factory=list)

    system_events: list[dict] = field(default_factory=list)

    llm_messages: list[dict] | None = None
    llm_reply: str | None = None

    should_shortcut: bool = False
    # 中间件间共享状态。推荐使用 STATE_* 常量作为键名，而非裸字符串。
    state: dict = field(default_factory=dict)
    error: str | None = None

    note_collector: Any | None = None

    @property
    def message_count(self) -> int:
        return len(self.messages)
