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
    scoring_criteria: str
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
    case_context: str
    mood: str
    trust: str  # rendered as string from int
    comfort: str  # rendered as string from int
    student_msg: str
    context_tail: str


class InitiativeShortSystemVars(TypedDict):
    case_name: str
    case_context: str
    mood: str
    trust: str
    comfort: str
    context_tail: str


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


class CaseGenerationUserVars(TypedDict):
    description: str
    field_instruction: str
    reference_material: str


def validate_all_templates() -> list[str]:
    """Validate all known templates against their TypedDict contracts.

    Returns a list of warning messages (empty = all clean).  Call once at
    startup so placeholder mismatches are caught on deploy, not at runtime.
    """
    from core.template import validate_template_vars
    from modules.cases.prompts import CASE_GENERATION_CORE, CASE_GENERATION_DERIVATIVE
    from modules.qa.prompts import QA_SYSTEM
    from modules.training.prompts.emotion import EMOTION_ANALYSIS_USER
    from modules.training.prompts.initiative import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT
    from modules.training.prompts.patient import PATIENT_DYNAMIC, PATIENT_SYSTEM
    from modules.training.prompts.scoring import (
        FEEDBACK_RETRY_USER,
        SCORING_FEEDBACK_SYSTEM,
        SCORING_FEEDBACK_USER,
        SCORING_RETRY_USER,
        SCORING_SYSTEM,
        SCORING_USER,
    )

    checks: list[tuple[str, str, frozenset[str]]] = [
        ("SCORING_SYSTEM", SCORING_SYSTEM, frozenset(ScoringSystemVars.__annotations__.keys())),
        ("SCORING_USER", SCORING_USER, frozenset(ScoringUserVars.__annotations__.keys())),
        (
            "SCORING_FEEDBACK_SYSTEM",
            SCORING_FEEDBACK_SYSTEM,
            frozenset(ScoringFeedbackSystemVars.__annotations__.keys()),
        ),
        ("SCORING_FEEDBACK_USER", SCORING_FEEDBACK_USER, frozenset(ScoringFeedbackUserVars.__annotations__.keys())),
        ("SCORING_RETRY_USER", SCORING_RETRY_USER, frozenset(ScoringRetryUserVars.__annotations__.keys())),
        ("FEEDBACK_RETRY_USER", FEEDBACK_RETRY_USER, frozenset(FeedbackRetryUserVars.__annotations__.keys())),
        ("EMOTION_ANALYSIS_USER", EMOTION_ANALYSIS_USER, frozenset(EmotionAnalysisUserVars.__annotations__.keys())),
        ("INITIATIVE_SYSTEM", INITIATIVE_SYSTEM, frozenset(InitiativeSystemVars.__annotations__.keys())),
        (
            "INITIATIVE_SYSTEM_SHORT",
            INITIATIVE_SYSTEM_SHORT,
            frozenset(InitiativeShortSystemVars.__annotations__.keys()),
        ),
        ("PATIENT_SYSTEM", PATIENT_SYSTEM, frozenset(PatientSystemVars.__annotations__.keys())),
        ("PATIENT_DYNAMIC", PATIENT_DYNAMIC, frozenset(PatientDynamicVars.__annotations__.keys())),
        ("QA_SYSTEM", QA_SYSTEM, frozenset(QASystemVars.__annotations__.keys())),
        (
            "CASE_GENERATION_CORE",
            CASE_GENERATION_CORE,
            frozenset(CaseGenerationUserVars.__annotations__.keys()),
        ),
        (
            "CASE_GENERATION_DERIVATIVE",
            CASE_GENERATION_DERIVATIVE,
            frozenset(CaseGenerationUserVars.__annotations__.keys()),
        ),
    ]

    warnings: list[str] = []
    for name, template, allowed in checks:
        unknown = validate_template_vars(template, allowed)
        if unknown:
            warnings.append(f"{name}: unknown placeholders {unknown}")
    return warnings
