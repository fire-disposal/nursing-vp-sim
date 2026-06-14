"""PipelineContext — shared state across middleware stages."""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from models import Message, TrainingRecord, User

from .phase import Phase, parse_phases


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
    state: dict = field(default_factory=dict)
    error: str | None = None

    @property
    def message_count(self) -> int:
        return len(self.messages)

    def setup_phases(self):
        self.phases = parse_phases(self.case_data)
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
        self.phase_operation_count = self.case_data.get("_phase_op_count", 0)
