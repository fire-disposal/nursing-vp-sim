"""Prompt 模板管理 CRUD"""
import re
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, PromptTemplate as PT
from schemas import (
    PromptTemplateCreate, PromptTemplateUpdate, PromptTemplateResponse,
    PromptValidateRequest, PromptValidateResponse, PromptPreviewResponse,
)
from auth import require_teacher
from services.prompt_manager import refresh_prompts, render_template
from prompt_static import get_sample_vars

_logger = logging.getLogger("nursing")

router = APIRouter(prefix="/api/admin/prompts", tags=["Prompt管理"])


def _extract_vars(text: str | None) -> set[str]:
    if not text:
        return set()
    return set(re.findall(r"\{#([^}#]+)#\}", text))


@router.get("", response_model=list[PromptTemplateResponse])
def list_prompts(
    purpose: str | None = None,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(PT).order_by(PT.purpose, PT.version.desc())
    if purpose:
        q = q.filter(PT.purpose == purpose)
    return q.all()


@router.post("", status_code=201, response_model=PromptTemplateResponse)
async def create_prompt(
    data: PromptTemplateCreate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    max_v = db.query(PT).filter(PT.purpose == data.purpose).order_by(PT.version.desc()).first()
    version = (max_v.version + 1) if max_v else 1

    pt = PT(
        purpose=data.purpose, version=version, name=data.name,
        system_prompt=data.system_prompt, user_prompt=data.user_prompt,
        variables=data.variables or [
            {"name": v, "desc": ""} for v in sorted(_extract_vars(data.system_prompt) | _extract_vars(data.user_prompt))
        ],
        is_active=False, created_by=data.created_by or current_user.username,
        remark=data.remark,
    )
    db.add(pt)
    db.commit()
    db.refresh(pt)

    if data.activate:
        await _activate(pt.id, db)

    return pt


@router.put("/{prompt_id}", response_model=PromptTemplateResponse)
async def update_prompt(
    prompt_id: int,
    data: PromptTemplateUpdate,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(pt, k, v)
    if any(k in data.model_dump(exclude_none=True) for k in ("system_prompt", "user_prompt")):
        pt.variables = [{"name": v, "desc": ""} for v in sorted(
            _extract_vars(pt.system_prompt) | _extract_vars(pt.user_prompt)
        )]
    db.commit()
    db.refresh(pt)
    await refresh_prompts()
    return pt


@router.delete("/{prompt_id}")
async def delete_prompt(
    prompt_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    if pt.is_active:
        raise HTTPException(400, "不能删除当前激活的模板，请先激活其他版本")
    db.delete(pt)
    db.commit()
    return {"ok": True}


@router.post("/{prompt_id}/activate")
async def activate_prompt(
    prompt_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    await _activate(prompt_id, db)
    await refresh_prompts()
    return {"ok": True}


async def _activate(prompt_id: int, db: Session):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(404, "模板不存在")
    db.query(PT).filter(PT.purpose == pt.purpose).update({"is_active": False})
    pt.is_active = True
    db.commit()


@router.post("/validate", response_model=PromptValidateResponse)
def validate_prompt(data: PromptValidateRequest):
    errors = []
    missing = []
    vars_set = _extract_vars(data.system_prompt) | _extract_vars(data.user_prompt)
    dummy = {v: f"<{v}>" for v in vars_set}
    try:
        render_template(data.system_prompt, **dummy)
    except RuntimeError as e:
        errors.append(f"system_prompt 引用未声明的变量: {e}")
    except Exception as e:
        errors.append(f"system_prompt 语法错误: {e}")

    if data.user_prompt:
        try:
            render_template(data.user_prompt, **dummy)
        except RuntimeError as e:
            errors.append(f"user_prompt 引用未声明的变量: {e}")
        except Exception as e:
            errors.append(f"user_prompt 语法错误: {e}")

    declared = {v["name"] for v in (data.variables or [])}
    used = _extract_vars(data.system_prompt) | _extract_vars(data.user_prompt)
    missing = list(used - declared)

    return PromptValidateResponse(valid=len(errors) == 0, errors=errors, missing_vars=missing)


@router.post("/reload")
async def reload_prompts_endpoint(current_user: User = Depends(require_teacher)):
    await refresh_prompts()
    return {"ok": True}


@router.get("/sample-vars")
def get_sample_vars(purpose: str, current_user: User = Depends(require_teacher)):
    sample = get_sample_vars().get(purpose)
    if sample is None:
        raise HTTPException(404, f"未知 purpose: {purpose}")
    return {"purpose": purpose, "vars": sample}


@router.get("/active/preview", response_model=PromptPreviewResponse)
async def preview_active_prompt(
    purpose: str,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    pt = db.query(PT).filter(PT.purpose == purpose, PT.is_active == True).first()
    if not pt:
        raise HTTPException(404, f"「{purpose}」没有激活的模板")
    sample = get_sample_vars().get(purpose, {})
    system_rendered = pt.system_prompt
    user_rendered = pt.user_prompt
    try:
        system_rendered = render_template(pt.system_prompt, **sample) if sample else pt.system_prompt
        if pt.user_prompt:
            user_rendered = render_template(pt.user_prompt, **sample) if sample else pt.user_prompt
    except RuntimeError:
        pass
    return PromptPreviewResponse(
        purpose=pt.purpose,
        version=pt.version,
        system_prompt_raw=pt.system_prompt,
        user_prompt_raw=pt.user_prompt,
        system_prompt_rendered=system_rendered,
        user_prompt_rendered=user_rendered if pt.user_prompt else None,
        sample_vars=sample,
    )
