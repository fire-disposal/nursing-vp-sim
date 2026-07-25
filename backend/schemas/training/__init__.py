"""Training schemas — re-exported from sub-modules for backward compatibility."""

from schemas.training.emotion import (
    EmotionStateResponse,
    InitiativeStateResponse,
    InitiativeTriggerResponse,
)
from schemas.training.exam import ExamOperationResponse, ExamOperationResult
from schemas.training.notification import TrainingNotificationItem
from schemas.training.nursing import NursingRecordResponse, NursingRecordSave
from schemas.training.records import (
    MessageItem,
    ScoreItem,
    ScoreReviewItem,
    TrainingRecordBrief,
    TrainingRecordDetail,
)
from schemas.training.scoring import ScoringStatusResponse, ScoringTriggerResponse
from schemas.training.session import (
    ChatMessageRequest,
    ChatMessageResponse,
    TrainingStartRequest,
    TrainingStartResponse,
)

__all__ = [
    "ChatMessageRequest",
    "ChatMessageResponse",
    "EmotionStateResponse",
    "ExamOperationResponse",
    "ExamOperationResult",
    "InitiativeStateResponse",
    "InitiativeTriggerResponse",
    "MessageItem",
    "NursingRecordResponse",
    "NursingRecordSave",
    "ScoreItem",
    "ScoreReviewItem",
    "ScoringStatusResponse",
    "ScoringTriggerResponse",
    "TrainingNotificationItem",
    "TrainingRecordBrief",
    "TrainingRecordDetail",
    "TrainingStartRequest",
    "TrainingStartResponse",
]
