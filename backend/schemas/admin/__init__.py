"""Admin schemas — re-exported from sub-modules for backward compatibility."""

from schemas.admin.classes import ClassCreate, ClassResponse, ClassUpdate
from schemas.admin.grades import GradeCreate, GradeResponse, GradeUpdate
from schemas.admin.llm import LLMCallLogItem, LLMStatsResponse
from schemas.admin.roles import RoleCreateRequest, RoleResponse, RoleUpdateRequest
from schemas.admin.stats import (
    AdminStats,
    ClassSummaryItemSchema,
    DurationStats,
    RankingItem,
    TeacherSummaryItem,
    TrendStats,
)

__all__ = [
    "AdminStats",
    "ClassCreate",
    "ClassResponse",
    "ClassSummaryItemSchema",
    "ClassUpdate",
    "DurationStats",
    "GradeCreate",
    "GradeResponse",
    "GradeUpdate",
    "LLMCallLogItem",
    "LLMStatsResponse",
    "RankingItem",
    "RoleCreateRequest",
    "RoleResponse",
    "RoleUpdateRequest",
    "TeacherSummaryItem",
    "TrendStats",
]
