"""PipelineContext — shared state across middleware stages."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from models import Message, TrainingRecord, User

from .phase import Phase, parse_phases

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# ---- ctx.state 字符串常量 ----
# 在中间件中使用这些常量替代裸字符串键，避免拼写错误并方便 IDE 跳转。

STATE_FEATURES: str = "features"
STATE_STREAM_MODE: str = "_stream_mode"
STATE_PATIENT_CONTEXT_KWARGS: str = "_patient_context_kwargs"
STATE_PATIENT_CHAT_CFG: str = "_patient_chat_cfg"
STATE_IDENTITY_CORRECTION_COUNT: str = "_identity_correction_count"
STATE_SOURCE_TRACES: str = "_source_traces"
STATE_STREAM_CHUNKS: str = "_stream_chunks"
STATE_SAVED_MESSAGES: str = "_saved_messages"
STATE_POST_STREAM_EVENTS: str = "_post_stream_events"
STATE_PHASE_OP_COUNT: str = "_phase_op_count"


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

    phases: list[Phase] = field(default_factory=list)
    current_phase: Phase | None = None
    phase_index: int = 0
    manual_advance_requested: bool = False
    phase_operation_count: int = 0

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

    def setup_phases(self):
        self.phases = parse_phases(self.case_data, training_type=getattr(self.record, "training_type", None))
        saved_phase = self.record.current_phase
        if saved_phase:
            for i, p in enumerate(self.phases):
                if p.id == saved_phase:
                    self.current_phase = p
                    self.phase_index = i
                    break
        if self.current_phase is None:
            self.current_phase = self.phases[0] if self.phases else None
            self.phase_index = 0
        self._count_phase_operations()

    def _count_phase_operations(self):
        rs = self.record.runtime_state or {}
        self.phase_operation_count = rs.get("phase_op_count", 0)
