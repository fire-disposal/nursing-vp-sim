from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from infrastructure.patient_ai.note_source import NoteSource


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
