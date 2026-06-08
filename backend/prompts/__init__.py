"""专用提示词文件 —— 每个功能一个独立文件，便于版本管理和测试"""

from prompts.case_generation import CASE_GENERATION_SYSTEM
from prompts.patient_chat import PATIENT_CHAT_SYSTEM
from prompts.patient_dynamic import PATIENT_DYNAMIC_TEMPLATE
from prompts.qa import QA_SYSTEM
from prompts.scoring import SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER, SCORING_SYSTEM, SCORING_USER

__all__ = [
    "CASE_GENERATION_SYSTEM",
    "PATIENT_CHAT_SYSTEM",
    "PATIENT_DYNAMIC_TEMPLATE",
    "QA_SYSTEM",
    "SCORING_FEEDBACK_SYSTEM",
    "SCORING_FEEDBACK_USER",
    "SCORING_SYSTEM",
    "SCORING_USER",
]
