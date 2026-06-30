"""专用提示词文件 —— 每个功能一个独立文件，便于版本管理和测试"""

from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE
from prompts.qa import QA_SYSTEM
from prompts.scoring import (
    FEEDBACK_RETRY_USER,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_RETRY_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)

__all__ = [
    "FEEDBACK_RETRY_USER",
    "PATIENT_DYNAMIC_TEMPLATE",
    "QA_SYSTEM",
    "SCORING_FEEDBACK_SYSTEM",
    "SCORING_FEEDBACK_USER",
    "SCORING_RETRY_USER",
    "SCORING_SYSTEM",
    "SCORING_USER",
]
