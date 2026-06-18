from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class PromptTemplateCreate(BaseModel):
    model_config = _REQ_CFG
    purpose: str = Field(min_length=1, max_length=40)
    name: str | None = Field(default=None, max_length=80)
    system_prompt: str = Field(min_length=10)
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None
    created_by: str | None = None
    remark: str | None = None
    activate: bool = False


class PromptTemplateUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, max_length=80)
    system_prompt: str | None = Field(default=None, min_length=10)
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None
    remark: str | None = None


class PromptTemplateResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    purpose: str
    version: int
    name: str | None
    system_prompt: str
    user_prompt: str | None
    template_engine: str
    variables: list[dict[str, Any]] | None
    is_active: bool
    created_by: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime
    is_builtin: bool = False
    locked: bool = False


class PromptValidateRequest(BaseModel):
    model_config = _REQ_CFG
    purpose: str
    system_prompt: str
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None


class PromptValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    missing_vars: list[str] = []
    warnings: list[str] = []


class PromptPreviewResponse(BaseModel):
    purpose: str
    version: int
    system_prompt_raw: str
    user_prompt_raw: str | None
    system_prompt_rendered: str
    user_prompt_rendered: str | None
    sample_vars: dict[str, Any]
    render_error: str | None = None


class SampleVarsResponse(BaseModel):
    purpose: str
    vars: dict[str, Any]
