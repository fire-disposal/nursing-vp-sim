"""Prompt 模板管理 CRUD — thin router."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from core.deps import DbSession
from core.security import require_permission
from models import User
from schemas import (
    DeleteResponse,
    OkResponse,
    PromptPreviewResponse,
    PromptTemplateCreate,
    PromptTemplateResponse,
    PromptTemplateUpdate,
    PromptValidateRequest,
    PromptValidateResponse,
    SampleVarsResponse,
)
from services.prompt import PromptTemplateService

router = APIRouter(prefix="/api/admin/prompts", tags=["Prompt管理"])

_Manager = Annotated[User, Depends(require_permission("prompt_manage"))]


@router.get("", response_model=list[PromptTemplateResponse])
def list_prompts(current_user: _Manager, db: DbSession, purpose: str | None = None):
    return PromptTemplateService(db).list(purpose)


@router.post("", status_code=201, response_model=PromptTemplateResponse)
async def create_prompt(data: PromptTemplateCreate, request: Request, current_user: _Manager, db: DbSession):
    pt = PromptTemplateService(db).create(data.model_dump(), current_user.username, data.activate)
    if data.activate:
        await request.app.state.prompt_manager.reload()
    return pt


@router.put("/{prompt_id}", response_model=PromptTemplateResponse)
async def update_prompt(
    prompt_id: int, data: PromptTemplateUpdate, request: Request, current_user: _Manager, db: DbSession
):
    pt = PromptTemplateService(db).update(prompt_id, data.model_dump(exclude_none=True))
    await request.app.state.prompt_manager.reload()
    return pt


@router.delete("/{prompt_id}", response_model=DeleteResponse)
def delete_prompt(prompt_id: int, current_user: _Manager, db: DbSession):
    PromptTemplateService(db).delete(prompt_id)
    return {"ok": True}


@router.post("/{prompt_id}/activate", response_model=OkResponse)
async def activate_prompt(
    prompt_id: int, request: Request, current_user: _Manager, db: DbSession, purpose: str | None = None
):
    PromptTemplateService(db).activate(prompt_id, purpose)
    await request.app.state.prompt_manager.reload()
    return OkResponse(ok=True)


@router.post("/validate", response_model=PromptValidateResponse)
def validate_prompt(data: PromptValidateRequest, current_user: _Manager):
    return PromptTemplateService.validate(data.model_dump())


@router.post("/reload", response_model=OkResponse)
async def reload_prompts_endpoint(request: Request, current_user: _Manager):
    await request.app.state.prompt_manager.reload()
    return {"ok": True}


@router.get("/sample-vars", response_model=SampleVarsResponse)
def get_sample_vars(purpose: str, current_user: _Manager):
    return PromptTemplateService.get_sample_vars(purpose)


@router.get("/active/preview", response_model=PromptPreviewResponse)
def preview_active_prompt(purpose: str, current_user: _Manager, db: DbSession):
    return PromptTemplateService(db).preview_active(purpose)
