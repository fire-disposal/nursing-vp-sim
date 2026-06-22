from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class QASessionCreate(BaseModel):
    model_config = _REQ_CFG
    question: str = Field(min_length=1, max_length=4096)
    rag_enabled: bool = False


QAAskRequest = QASessionCreate


class QASessionItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class Citation(BaseModel):
    model_config = _RESP_CFG
    source: str
    section: str


class QAMessageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    role: str
    content: str
    created_at: datetime
    citations: list[Citation] | None = None


class QAAskResponse(BaseModel):
    session_id: int
    answer: str
    citations: list[Citation] | None = None


class QASessionAdminItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    student_name: str = ""
    student_code: str = ""
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class SectionTextResponse(BaseModel):
    source: str
    section: str
    text: str
