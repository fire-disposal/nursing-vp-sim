"""Training schemas — re-exported from sub-modules for backward compatibility."""

from schemas.training.emotion import InitiativeTriggerResponse
from schemas.training.notification import TrainingNotificationItem
from schemas.training.nursing import (
    NursingRecordError,
    NursingRecordResponse,
    NursingRecordSave,
    NursingRecordSubmit,
)
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
    "InitiativeTriggerResponse",
    "MessageCorrectionStatus",
    "MessageItem",
    "NursingRecordError",
    "NursingRecordResponse",
    "NursingRecordSave",
    "NursingRecordSubmit",
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
