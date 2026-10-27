from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

MemberRole = Literal["student", "teacher"]


class ClassCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=60)
    cohort_label: str = Field(default="", max_length=40, description="届/年级标签，同一标签下班级名唯一")
    #: 院校归属。院校管理员省略即可（服务端强制本校）；平台角色必须显式给出。
    school_id: int | None = Field(default=None, description="院校 ID（平台角色必填）")


class ClassUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=60)
    cohort_label: str | None = Field(default=None, max_length=40)
    #: 仅平台角色可改归属（院校管理员改动请求一律被忽略）。
    school_id: int | None = None


class ClassResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    school_id: int
    school_name: str = ""
    cohort_label: str = ""
    student_count: int = 0
    teacher_count: int = 0
    assignment_count: int = 0
    created_at: datetime


class ClassMemberItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    username: str
    display_name: str
    student_id: str | None = None
    member_role: str
    joined_at: datetime


class ClassDetailResponse(ClassResponse):
    members: list[ClassMemberItem] = Field(default_factory=list)


class ClassMemberAddRequest(BaseModel):
    model_config = _REQ_CFG
    user_ids: list[int] = Field(min_length=1)
    member_role: MemberRole = "student"


class ClassMemberRemoveRequest(BaseModel):
    model_config = _REQ_CFG
    user_ids: list[int] = Field(min_length=1)


class ClassMemberMutationResult(BaseModel):
    """批量增删成员的落地结果。``updated`` = 已存在但角色被改写的成员数。"""

    added: int = 0
    updated: int = 0
    removed: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


class BulkAssignClassRequest(BaseModel):
    model_config = _REQ_CFG
    user_ids: list[int] = Field(min_length=1)
    class_id: int = Field(gt=0)
    member_role: MemberRole = "student"


class BulkAssignClassResult(BaseModel):
    assigned: int
    updated: int = 0
    skipped: int
    errors: list[str]
