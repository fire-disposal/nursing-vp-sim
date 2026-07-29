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
    PatientPublicInfo,
    ScoreItem,
    ScoreReviewItem,
    TrainingRecordBrief,
    TrainingRecordDetail,
)
from schemas.training.scoring import ScoringStatusResponse, ScoringTriggerResponse
from schemas.training.session import (
    ChatCorrectionRequest,
    ChatMessageRequest,
    ChatMessageResponse,
    MessageCorrectionStatus,
    TrainingSessionData,
    TrainingStartRequest,
    TrainingStartResponse,
)

__all__ = [
    "ChatCorrectionRequest",
    "ChatMessageRequest",
    "ChatMessageResponse",
    "EmotionStateResponse",
    "ExamOperationResponse",
    "ExamOperationResult",
    "InitiativeStateResponse",
    "InitiativeTriggerResponse",
    "MessageCorrectionStatus",
    "MessageItem",
    "NursingRecordResponse",
    "NursingRecordSave",
    "PatientPublicInfo",
    "ScoreItem",
    "ScoreReviewItem",
    "ScoringStatusResponse",
    "ScoringTriggerResponse",
    "TrainingNotificationItem",
    "TrainingRecordBrief",
    "TrainingRecordDetail",
    "TrainingSessionData",
    "TrainingStartRequest",
    "TrainingStartResponse",
]
