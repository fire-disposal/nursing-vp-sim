"""Admin schemas — re-exported from sub-modules for backward compatibility."""

from schemas.admin.audit import AuditLogItem
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
from schemas.admin.persona import (
    PersonaCatalogItem,
    UserPersonasResponse,
    UserPersonasUpdateRequest,
)
from schemas.admin.roles import RoleResponse
from schemas.admin.stats import (
    ClassStudentItem,
    ClassSummaryItemSchema,
    DurationStats,
    TeacherSummaryItem,
    TrendStats,
)

__all__ = [
    "AuditLogItem",
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
    "PersonaCatalogItem",
    "RoleResponse",
    "TeacherSummaryItem",
    "TrendStats",
    "UserPersonasResponse",
    "UserPersonasUpdateRequest",
]
