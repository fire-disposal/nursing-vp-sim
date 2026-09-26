"""Admin schemas — re-exported from sub-modules for backward compatibility."""

from schemas.admin.classes import (
    BulkAssignClassRequest,
    BulkAssignClassResult,
    ClassCreate,
    ClassDetailResponse,
    ClassMemberAddRequest,
    ClassMemberItem,
    ClassMemberMutationResult,
    ClassMemberRemoveRequest,
    ClassResponse,
    ClassUpdate,
)
from schemas.admin.llm import LLMCallLogItem, LLMStatsResponse
from schemas.admin.roles import RoleCreateRequest, RoleResponse, RoleUpdateRequest
from schemas.admin.stats import (
    AdminStats,
    ClassStudentItem,
    ClassSummaryItemSchema,
    DurationStats,
    RankingItem,
    TeacherSummaryItem,
    TrendStats,
)

__all__ = [
    "AdminStats",
    "BulkAssignClassRequest",
    "BulkAssignClassResult",
    "ClassCreate",
    "ClassDetailResponse",
    "ClassMemberAddRequest",
    "ClassMemberItem",
    "ClassMemberMutationResult",
    "ClassMemberRemoveRequest",
    "ClassResponse",
    "ClassStudentItem",
    "ClassSummaryItemSchema",
    "ClassUpdate",
    "DurationStats",
    "LLMCallLogItem",
    "LLMStatsResponse",
    "RankingItem",
    "RoleCreateRequest",
    "RoleResponse",
    "RoleUpdateRequest",
    "TeacherSummaryItem",
    "TrendStats",
]
