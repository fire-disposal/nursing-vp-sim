from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from schemas.case_schema import CaseDataSchema
from schemas.common import _REQ_CFG, _RESP_CFG


class CaseBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    difficulty: int = 1
    description: str | None = None
    #: 生命周期（draft/published/archived）—— 学生目录只出现 published
    status: str = "draft"
    time_limit_minutes: int = 30
    is_open: bool = False
    patient_summary: dict[str, Any] | None = None
    profile_info: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, bool] = Field(default_factory=dict)


class CaseDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_data: dict[str, Any]
    status: str = "draft"
    is_open: bool = False
    difficulty: int = 1
    time_limit_minutes: int = 30
    #: 当前版本（学员按它训练）；未发布时为 None
    current_revision_id: int | None = None
    current_revision_no: int | None = None


class CaseCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]
    is_open: bool = True

    @field_validator("case_data")
    @classmethod
    def validate_case_data_schema(cls, v: dict[str, Any]) -> dict[str, Any]:
        CaseDataSchema.model_validate(v)
        return v


class CaseUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]

    @field_validator("case_data")
    @classmethod
    def validate_case_data_schema(cls, v: dict[str, Any]) -> dict[str, Any]:
        CaseDataSchema.model_validate(v)
        return v


class CaseNameRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)


class CaseManageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    status: str = "draft"
    current_revision_id: int | None = None
    current_revision_no: int | None = None
    patient_name: str = ""
    patient_age: int | None = None
    patient_gender: str = ""
    chief_complaint: str = ""
    time_limit: int = 30
    difficulty: int = 1
    patient_personality: str = ""
    capabilities: dict[str, bool] = {}
    is_open: bool = False
    created_at: datetime
    training_count: int = 0


class CaseRevisionItem(BaseModel):
    """病例版本（不可变内容快照）—— 教师侧「版本」视图。"""

    model_config = _RESP_CFG
    id: int
    revision_no: int
    created_at: datetime
    created_by: int | None = None
    published_at: datetime | None = None
    is_current: bool = False


class CaseValidationIssue(BaseModel):
    model_config = _RESP_CFG
    severity: str  # error | warning | info
    field: str = ""
    message: str
    fix_hint: str = ""


class CaseValidationReport(BaseModel):
    """发布门禁报告（复用 modules/cases/validator.py）。"""

    model_config = _RESP_CFG
    case_id: int
    case_name: str
    publishable: bool = False
    errors: list[CaseValidationIssue] = []
    warnings: list[CaseValidationIssue] = []
    infos: list[CaseValidationIssue] = []


class CasePublishResponse(BaseModel):
    model_config = _RESP_CFG
    case: CaseManageItem
    report: CaseValidationReport


class CaseGenerateRequest(BaseModel):
    model_config = _REQ_CFG
    mode: str = Field(default="quick", pattern="^(quick|reference)$")
    description: str = Field(min_length=1, max_length=4096)
    reference_case_ids: list[int] | None = None
    reference_text: str | None = Field(default=None, max_length=16384)
    stage: str = Field(default="full", pattern="^(full|core|derivative)$")
    field: str | None = Field(
        default=None,
        pattern=r"^[a-z][a-z0-9_]*$",
        description="生成/重生成单个顶层字段（如 present_illness、activities）",
    )
    current_case_data: dict[str, Any] | None = None


class CaseGenerateResponse(BaseModel):
    model_config = _RESP_CFG
    case_data: dict[str, Any] | None = None
    field_value: Any | None = None
    field: str | None = None
