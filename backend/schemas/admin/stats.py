from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AdminStats(BaseModel):
    total_students: int
    total_records: int
    completed_records: int
    average_score: float | None
    avg_duration_min: float | None = None
    today_records: int = 0


class DurationStats(BaseModel):
    daily: list[dict[str, Any]]
    total_minutes: int
    total_sessions: int


class TrendStats(BaseModel):
    daily: list[dict[str, Any]]
    total_sessions: int
    total_minutes: int
    avg_score: float | None = None


class TeacherSummaryItem(BaseModel):
    user_id: int
    display_name: str
    student_code: str | None = None
    total_sessions: int = 0
    total_minutes: int = 0


class RankingItem(BaseModel):
    user_id: int
    display_name: str
    student_id: str | None = None
    total_sessions: int = 0
    avg_score: float | None = None
    total_score: float = 0
    total_minutes: int = 0
    rank: int = 0


class ClassSummaryItemSchema(BaseModel):
    class_id: int
    class_name: str
    grade_name: str
    student_count: int = 0
    avg_score: float | None = None
    completion_rate: float = 0
    total_sessions: int = 0
    total_minutes: int = 0


class ClassStudentItem(BaseModel):
    """班级学生训练聚合（只读）"""
    user_id: int
    display_name: str
    student_id: str | None = None
    total_sessions: int = 0
    avg_score: float | None = None
    last_start_time: datetime | None = None
