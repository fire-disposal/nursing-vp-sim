from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from contexts.training.patient_ai.note_source import OperationNoteSource
from contexts.training.patient_ai.notes import EmotionNoteSource, IdentityGuardSource
from prompts.training.patient import PATIENT_DYNAMIC, PATIENT_SYSTEM

if TYPE_CHECKING:
    from contexts.training.patient_ai.note_source import NoteSource


@dataclass
class PromptCollection:
    system: str = ""
    dynamic: str = ""


@dataclass
class TrainingProfile:
    name: str
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict


from profiles.history_taking.rubric import RUBRIC as _RUBRIC

PROFILE = TrainingProfile(
    name="history_taking",
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=PromptCollection(system=PATIENT_SYSTEM, dynamic=PATIENT_DYNAMIC),
    rubric=_RUBRIC,
)
