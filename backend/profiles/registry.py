from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.patient.note_source import NoteSource


@dataclass
class PhaseConfig:
    id: str
    name: str = ""
    description: str = ""
    order: int = 1
    operations: list[str] = field(default_factory=lambda: ["chat"])
    prompt_profile: str = "patient_chat"
    scoring_dimensions: list[str] = field(default_factory=list)
    transition: dict = field(default_factory=dict)

    def supports_operation(self, op_type: str) -> bool:
        return "chat" in self.operations or op_type in self.operations


@dataclass
class PromptCollection:
    system: str = ""
    dynamic: str = ""
    scoring: str = ""
    scoring_user: str = ""
    scoring_feedback: str = ""
    scoring_feedback_user: str = ""


@dataclass
class TrainingProfile:
    name: str
    initial_phase: str
    phases: list[PhaseConfig]
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict


_PROFILES: dict[str, TrainingProfile] = {}


def register_profile(type_: str, profile: TrainingProfile) -> None:
    _PROFILES[type_] = profile


def get_profile(type_: str) -> TrainingProfile:
    if type_ not in _PROFILES:
        raise KeyError(f"Unknown training type: {type_}")
    return _PROFILES[type_]


def get_known_types() -> list[str]:
    return list(_PROFILES)
