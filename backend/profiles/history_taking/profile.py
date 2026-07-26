from __future__ import annotations

from contexts.training.patient_ai.note_source import OperationNoteSource
from contexts.training.patient_ai.notes import EmotionNoteSource, IdentityGuardSource
from prompts.training.patient import PATIENT_DYNAMIC, PATIENT_SYSTEM
from profiles.registry import (
    PromptCollection,
    TrainingProfile,
)

_PROMPTS = PromptCollection(
    system=PATIENT_SYSTEM,
    dynamic=PATIENT_DYNAMIC,
)

from profiles.history_taking.rubric import RUBRIC as _RUBRIC

PROFILE = TrainingProfile(
    name="history_taking",
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=_PROMPTS,
    rubric=_RUBRIC,
)
