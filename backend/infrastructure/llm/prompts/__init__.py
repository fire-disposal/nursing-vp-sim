"""专用提示词文件 —— 每个功能一个独立文件，便于版本管理和测试"""

from contexts.qa.qa_prompts import QA_SYSTEM
from contexts.training.patient_ai.template import PATIENT_DYNAMIC_TEMPLATE
from contexts.training.scoring.prompts import (
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
from profiles.history_taking.initiative_prompts import INITIATIVE_SYSTEM, INITIATIVE_SYSTEM_SHORT

__all__ = [
    "FEEDBACK_RETRY_USER",
    "INITIATIVE_SYSTEM",
    "INITIATIVE_SYSTEM_SHORT",
    "PATIENT_DYNAMIC_TEMPLATE",
    "QA_SYSTEM",
    "SCORING_FEEDBACK_SYSTEM",
    "SCORING_FEEDBACK_USER",
    "SCORING_RETRY_USER",
    "SCORING_SYSTEM",
    "SCORING_USER",
]
