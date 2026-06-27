from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class QuestionnaireQuestionCreate(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)
    question_type: str = Field(min_length=1, max_length=20)
    required: bool = True
    sort_order: int = 0
    options: list[str] | None = None


class QuestionnaireQuestionUpdate(BaseModel):
    model_config = _REQ_CFG
    content: str | None = Field(default=None, max_length=2000)
    question_type: str | None = Field(default=None, max_length=20)
    required: bool | None = None
    sort_order: int | None = None
    options: list[str] | None = None


class QuestionnaireQuestionResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    template_id: int
    content: str
    question_type: str
    required: bool
    sort_order: int
    options: list[str] | None = None


class QuestionnaireQuestionSync(BaseModel):
    """Question payload for template update — id present = update existing, absent = create new."""

    model_config = _REQ_CFG
    id: int | None = None
    content: str = Field(min_length=1, max_length=2000)
    question_type: str = Field(min_length=1, max_length=20)
    required: bool = True
    sort_order: int = 0
    options: list[str] | None = None


class QuestionnaireTemplateCreate(BaseModel):
    model_config = _REQ_CFG
    title: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=20)
    description: str | None = None
    is_active: bool = True
    questions: list["QuestionnaireQuestionCreate"] = []


class QuestionnaireTemplateUpdate(BaseModel):
    model_config = _REQ_CFG
    title: str | None = Field(default=None, max_length=120)
    type: str | None = Field(default=None, max_length=20)
    description: str | None = None
    is_active: bool | None = None
    questions: list["QuestionnaireQuestionSync"] | None = None


class QuestionnaireTemplateResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    type: str
    description: str | None = None
    is_active: bool
    question_count: int = 0
    response_count: int = 0
    created_at: datetime
    updated_at: datetime


class QuestionnaireTemplateDetailResponse(QuestionnaireTemplateResponse):
    questions: list["QuestionnaireQuestionResponse"] = []
    case_ids: list[int] = []


class CaseAssignmentRequest(BaseModel):
    model_config = _REQ_CFG
    case_ids: list[int]
    is_required: bool = True
    trigger_event: str = Field(default="before_training", max_length=30)


class QuestionnaireAnswerSubmit(BaseModel):
    model_config = _REQ_CFG
    question_id: int
    answer_value: str | None = None


class QuestionnaireSubmitRequest(BaseModel):
    model_config = _REQ_CFG
    template_id: int
    case_id: int | None = None
    record_id: int | None = None
    answers: list["QuestionnaireAnswerSubmit"]


class QuestionnaireCheckResponse(BaseModel):
    has_pending: bool
    template_id: int | None = None
    response_id: int | None = None
    template: "QuestionnaireTemplateDetailResponse | None" = None
    is_required: bool = True
    trigger_event: str = "before_training"


class QuestionnaireAnswerItem(BaseModel):
    model_config = _RESP_CFG
    question_id: int
    question_content: str = ""
    question_type: str = ""
    options: list[str] | None = None
    answer_value: str | None = None


class QuestionnaireResponseItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    template_id: int
    template_title: str = ""
    user_id: int
    user_name: str = ""
    case_id: int | None = None
    record_id: int | None = None
    status: str
    answers: list["QuestionnaireAnswerItem"] = []
    completed_at: datetime | None = None
    created_at: datetime


class QuestionnaireStatsResponse(BaseModel):
    template_id: int
    template_title: str = ""
    total_assigned: int = 0
    total_completed: int = 0
    completion_rate: float = 0.0
    questions: list["QuestionStatsItem"] = []


class QuestionStatsItem(BaseModel):
    question_id: int
    content: str = ""
    question_type: str = ""
    response_count: int = 0
    avg_likert: float | None = None
    choice_distribution: dict[str, int] = Field(default_factory=dict)
    text_answers: list[str] = Field(default_factory=list)
