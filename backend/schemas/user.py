from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

_GENDER = Field(default=None, pattern=r"^(男|女)?$")

MemberRole = Literal["student", "teacher"]


class UserMembershipItem(BaseModel):
    """用户所属班级（单用户多班级：一个用户可有多条）。"""

    model_config = _RESP_CFG
    class_id: int | None = None
    class_name: str | None = None
    cohort_label: str | None = None
    member_role: str = "student"
    joined_at: datetime | None = None


class UserMembershipUpdate(BaseModel):
    """用户编辑里的成员关系项 —— 提供 ``memberships`` 即为全量替换。"""

    model_config = _REQ_CFG
    class_id: int = Field(gt=0)
    member_role: MemberRole = "student"


class UserBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    username: str
    role: str
    role_display_name: str
    display_name: str
    student_id: str | None
    gender: str | None = None
    avatar: str | None = None
    memberships: list[UserMembershipItem] = Field(default_factory=list)
    created_at: datetime
    is_active: bool = True
    # 仅 /auth/me 填充（其它列表接口不查权限表，留空）：前端据此在每次加载时刷新侧栏门禁，
    # 否则降权/升权后前端最长 24h 仍按旧权限渲染（2026-09-26 审计 RB-4）。
    permissions: list[str] = Field(default_factory=list)


class UserProfileUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    student_id: str | None = None
    gender: str | None = _GENDER
    avatar: str | None = Field(default=None, max_length=255)


class UserUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = None
    student_id: str | None = None
    memberships: list[UserMembershipUpdate] | None = Field(
        default=None, description="成员关系全量替换；省略该键 = 不修改"
    )
    role: str | None = None
    password: str | None = Field(default=None, min_length=6)
    gender: str | None = _GENDER
    avatar: str | None = Field(default=None, max_length=255)
    #: 启用/停用；停用是软删（保留训练数据，仅切断登录）
    is_active: bool | None = None


class StudentRecentRecord(BaseModel):
    """学生详情页最近训练记录项（TrainingRecordBrief 子集）"""

    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_id: int
    user_display_name: str
    user_student_id: str | None
    status: str
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    assignment_id: str | None = None
    assignment_title: str | None = None


class StudentDailyStat(BaseModel):
    """学生详情页每日训练统计项"""

    model_config = _RESP_CFG
    date: str
    sessions: int = 0
    minutes: float = 0
    avg_score: float | None = None


class StudentDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    created_at: datetime
    total_sessions: int = 0
    total_minutes: int = 0
    avg_score: float | None = None
    recent_records: list[StudentRecentRecord] = []
    daily: list[StudentDailyStat] = []


class BatchUserItem(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=50)
    role: str = Field(default="student", min_length=1, max_length=20)
    student_id: str | None = None
    class_id: int | None = None
    class_name: str | None = None
    cohort_label: str | None = Field(default=None, max_length=40, description="班级名歧义时用于消歧")


class RegisterResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None = None


class BatchCreateResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]
