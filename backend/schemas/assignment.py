from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    practice_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    start_time: datetime
    end_time: datetime


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    practice_id: int | None = None
    class_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_closed: bool | None = None


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    practice_name: str = ""
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
    practice_id: int
    practice_name: str = ""
    class_id: int
    class_name: str = ""
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


class StudentAssignmentItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    practice_name: str
    start_time: datetime
    end_time: datetime
    status: str = "pending"
    record_id: int | None = None
    score_total: float | None = None
    is_overdue: bool = False
