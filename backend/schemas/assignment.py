from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from core.statuses import TrainingMode
from schemas.common import _REQ_CFG, _RESP_CFG

# 作业可配置的训练模式白名单。blind_box（随机抽取）仅限自主端点，作业不可配；
# 作业隐藏病例信息用独立开关 behavior.hide_case_info（教师指定病例，不做随机抽取）。
_ASSIGNMENT_MODES = {TrainingMode.GUIDED.value, TrainingMode.ASSESSMENT.value}


def _check_behavior(v: dict | None) -> dict | None:
    """behavior 字段校验：mode 必须在作业白名单；hide_case_info 必须是布尔。"""
    if not v:
        return v
    mode = v.get("mode")
    if mode is not None and mode not in _ASSIGNMENT_MODES:
        raise ValueError(f"behavior.mode 必须是 {'/'.join(sorted(_ASSIGNMENT_MODES))}，收到: {mode!r}")
    hide = v.get("hide_case_info")
    if hide is not None and not isinstance(hide, bool):
        raise ValueError("behavior.hide_case_info 必须是布尔值")
    return v


class AssignmentAudience(BaseModel):
    """作业受众（发布/更新时提交）。

    ``class`` = 发布时全班学生成员快照；``selected`` = 发布时显式名单（必须显式给出
    ``user_ids``）。两种模式都在发布时固化到受众快照，之后班级成员变动不再影响它。
    """

    model_config = _REQ_CFG
    mode: Literal["class", "selected"] = "class"
    user_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "AssignmentAudience":
        if len(set(self.user_ids)) != len(self.user_ids):
            raise ValueError("audience.user_ids 不能包含重复用户")
        if any(uid <= 0 for uid in self.user_ids):
            raise ValueError("audience.user_ids 必须是正整数")
        if self.mode == "selected" and not self.user_ids:
            raise ValueError("audience.mode=selected 必须提供 user_ids")
        if self.mode == "class" and self.user_ids:
            raise ValueError("audience.mode=class 不接受 user_ids（全班由发布时成员快照决定）")
        return self


class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict = Field(default_factory=dict)
    audience: AssignmentAudience = Field(default_factory=AssignmentAudience)
    start_time: datetime
    end_time: datetime
    max_attempts: int | None = Field(default=1, description="最大尝试次数；0 或 None 为不限制")

    @field_validator("behavior")
    @classmethod
    def _validate_behavior(cls, v: dict) -> dict | None:
        return _check_behavior(v)


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int | None = None
    class_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] | None = None
    behavior: dict | None = None
    audience: AssignmentAudience | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_closed: bool | None = None
    max_attempts: int | None = Field(
        default=None,
        description="最大尝试次数；显式 null = 不限制，请求未携带该键 = 不修改",
    )

    @field_validator("behavior")
    @classmethod
    def _validate_behavior(cls, v: dict | None) -> dict | None:
        return _check_behavior(v)


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str = ""
    class_name: str = ""
    teacher_name: str = ""
    start_time: datetime
    end_time: datetime
    audience_mode: str = "class"
    student_count: int = 0
    completed_count: int = 0
    created_at: datetime
    is_closed: bool = False
    max_attempts: int | None = None


class AssignmentStudentItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False
    attempt_count: int = 0


class AssignmentDetail(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    class_id: int
    class_name: str = ""
    features: dict = Field(default_factory=dict)
    behavior: dict = Field(default_factory=dict)
    audience_mode: str = "class"
    recipient_ids: list[int] = Field(default_factory=list, description="发布时固化的受众快照")
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int = 0
    completed_count: int = 0
    scored_count: int = 0
    avg_score: float | None = None
    max_score: float | None = None
    min_score: float | None = None
    completion_rate: float = 0.0
    students: list["AssignmentStudentItem"] = Field(default_factory=list)
    max_attempts: int | None = None


class StudentAssignmentItem(BaseModel):
    """学生作业卡片 —— status 取值见 core.statuses.AssignmentProgressStatus。

    与教师端 ``AssignmentStudentItem`` 同一推导（modules.assignments.progress），
    状态词表不再混用训练记录状态（pending → not_started）。
    """

    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str
    start_time: datetime
    end_time: datetime
    status: str = "not_started"
    record_id: int | None = None
    score_total: float | None = None
    scoring_status: str | None = None
    is_overdue: bool = False
    max_attempts: int | None = None
    attempt_count: int = 0
