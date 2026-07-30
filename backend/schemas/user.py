from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

_GENDER = Field(default=None, pattern=r"^(男|女)?$")


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
    class_id: int | None = None
    class_name: str | None = None
    grade_name: str | None = None
    created_at: datetime


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
    class_id: int | None = None
    role: str | None = None
    password: str | None = Field(default=None, min_length=6)
    gender: str | None = _GENDER
    avatar: str | None = Field(default=None, max_length=255)


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
    recent_records: list = []
    daily: list = []


class BatchUserItem(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=50)
    role: str = Field(default="student", min_length=1, max_length=20)
    student_id: str | None = None
    class_id: int | None = None
    class_name: str | None = None


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

