"""Typed variable contracts for all prompt templates.

Each TypedDict defines the exact kwargs expected by the corresponding
prompt constant.  Use these for IDE autocomplete, mypy/pyright checking,
and documentation — the runtime enforcement is handled by render_template()'s
built-in RuntimeError on missing variables.

Usage:
    from core.template_variables import ScoringSystemVars
    from modules.training.prompts.scoring import SCORING_SYSTEM
    from core.template import render_template

    kwargs: ScoringSystemVars = { ... }
    result = render_template(SCORING_SYSTEM, **kwargs)
"""

from typing import TypedDict

# ── Training: Scoring ──


class ScoringSystemVars(TypedDict):
    scoring_criteria: str
    required_inquiries: str
    scoring_json_schema: str


class ScoringUserVars(TypedDict):
    conversation_text: str


class ScoringFeedbackSystemVars(TypedDict):
    scoring_result: str  # JSON string of the scoring output
    required_inquiries: str


class ScoringFeedbackUserVars(TypedDict):
    conversation_text: str
    partial_json: str


class ScoringRetryUserVars(TypedDict):
    conversation_text: str
    validation_errors: str
    partial_json: str


class FeedbackRetryUserVars(TypedDict):
    missing: str
    partial_json: str


# ── Training: Emotion ──


class EmotionAnalysisUserVars(TypedDict):
    nurse_message: str
    patient_reply: str


# ── Training: Initiative ──


class InitiativeSystemVars(TypedDict):
    case_name: str
    traits: str
    mood: str
    trust: str  # rendered as string from int
    comfort: str  # rendered as string from int


class InitiativeShortSystemVars(TypedDict):
    case_name: str
    traits: str
    mood: str
    trust: str
    comfort: str


class InitiativeUserVars(TypedDict):
    student_msg: str


# ── Training: Patient ──


class PatientSystemVars(TypedDict, total=False):
    patient_info: str
    scenario: str
    personality: str
    communication_style: str


class PatientDynamicVars(TypedDict, total=False):
    chief_complaint: str
    present_illness: str
    past_history: str
    medication_history: str
    allergy_history: str
    family_history: str
    social_history: str
    deep_background: str
    example_dialogues: str
    scene_state: str


# ── QA ──


class QASystemVars(TypedDict):
    user_name: str
    user_role: str


# ── Case Generation ──


class CaseGenerationSystemVars(TypedDict):
    training_type_label: str


class CaseGenerationUserVars(TypedDict):
    description: str
    field_instruction: str
    reference_material: str
