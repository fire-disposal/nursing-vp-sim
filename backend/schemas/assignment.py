from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from core.statuses import TrainingMode
from schemas.common import _REQ_CFG, _RESP_CFG

# 作业可配置的训练模式白名单：盲盒（blind_box）仅限自主触发，作业不可配置。
_ASSIGNMENT_MODES = {TrainingMode.GUIDED.value, TrainingMode.ASSESSMENT.value}


def _check_behavior_mode(v: dict | None) -> dict | None:
    """behavior.mode 只允许 guided/assessment；非法值 422 拒绝，防止前端静默按 guided 处理。"""
    if not v:
        return v
    mode = v.get("mode")
    if mode is not None and mode not in _ASSIGNMENT_MODES:
        raise ValueError(f"behavior.mode 必须是 {'/'.join(sorted(_ASSIGNMENT_MODES))}，收到: {mode!r}")
    return v


class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict = Field(default_factory=dict)
    student_ids: list[int] | None = None
    start_time: datetime
    end_time: datetime
    max_attempts: int | None = Field(default=None, description="最大尝试次数，None 为不限制")

    @field_validator("behavior")
    @classmethod
    def _validate_behavior_mode(cls, v: dict) -> dict:
        return _check_behavior_mode(v)


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int | None = None
    class_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    features: dict[str, bool] | None = None
    behavior: dict | None = None
    student_ids: list[int] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_closed: bool | None = None
    max_attempts: int | None = Field(default=None, description="最大尝试次数，None 为不限制")

    @field_validator("behavior")
    @classmethod
    def _validate_behavior_mode(cls, v: dict | None) -> dict | None:
        return _check_behavior_mode(v)


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str = ""
    class_name: str = ""
    teacher_name: str = ""
    start_time: datetime
    end_time: datetime
    student_count: int = 0
    completed_count: int = 0
    created_at: datetime
    is_closed: bool = False


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
    student_ids: list[int] | None = None
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
    model_config = _RESP_CFG
    id: str
    title: str
    case_name: str
    start_time: datetime
    end_time: datetime
    status: str = "pending"
    record_id: int | None = None
    score_total: float | None = None
    is_overdue: bool = False
    max_attempts: int | None = None
    attempt_count: int = 0
