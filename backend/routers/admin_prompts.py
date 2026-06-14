"""Prompt 模板管理 CRUD"""

import logging
import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from infrastructure.prompt import get_registry, render_template
from models import PromptTemplate as PT
from models import User
from prompts import (
    CASE_GENERATION_SYSTEM,
    PATIENT_CHAT_SYSTEM,
    PATIENT_DYNAMIC_TEMPLATE,
    QA_SYSTEM,
    SCORING_FEEDBACK_SYSTEM,
    SCORING_FEEDBACK_USER,
    SCORING_SYSTEM,
    SCORING_USER,
)
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

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/prompts", tags=["Prompt管理"])


def _extract_vars(text: str | None) -> set[str]:
    if not text:
        return set()
    return set(re.findall(r"\{#([^}#]+)#\}", text))


def _dedup_variables(variables: list[dict]) -> list[dict]:
    """按 name 去重变量列表，保留首次出现的那个"""
    seen: set[str] = set()
    result: list[dict] = []
    for v in variables:
        name = v.get("name", "") if isinstance(v, dict) else str(v)
        if name not in seen:
            seen.add(name)
            result.append(v if isinstance(v, dict) else {"name": name, "desc": ""})
    return result


@router.get("", response_model=list[PromptTemplateResponse])
def list_prompts(
    purpose: str | None = None,
    current_user: User = Depends(require_permission("prompt_manage")),
    db: Session = Depends(get_db),
):
    q = db.query(PT).order_by(PT.purpose, PT.version.desc())
    if purpose:
        q = q.filter(PT.purpose == purpose)
    db_prompts = list(q.all())

    builtins = _build_builtin_prompt_entries(purpose, db_prompts)
    return db_prompts + builtins


def _build_builtin_prompt_entries(purpose_filter: str | None, db_prompts: list[PT]) -> list[PromptTemplateResponse]:
    """为每个 purpose 生成内置提示词条目（锁定，不可编辑/删除）"""
    BUILTIN_MAP: dict[str, tuple[str, str | None, str]] = {
        "patient_chat": (PATIENT_CHAT_SYSTEM, None, "虚拟患者对话 — 内置兜底"),
        "patient_dynamic": (PATIENT_DYNAMIC_TEMPLATE, None, "病情动态数据块 — 内置兜底"),
        "scoring": (SCORING_SYSTEM, SCORING_USER, "训练评分 — 内置兜底"),
        "scoring_feedback": (SCORING_FEEDBACK_SYSTEM, SCORING_FEEDBACK_USER, "评分反馈生成 — 内置兜底"),
        "qa": (QA_SYSTEM, None, "护理学问答 — 内置兜底"),
        "case_generation": (CASE_GENERATION_SYSTEM, None, "病例生成 — 内置兜底"),
    }

    builtin_registry = get_registry()
    now = datetime.now(UTC)
    results: list[PromptTemplateResponse] = []

    for p, (system, user, label) in BUILTIN_MAP.items():
        if purpose_filter and p != purpose_filter:
            continue

        has_active_db = any(t.purpose == p and t.is_active for t in db_prompts)

        var_meta = builtin_registry.get_variables_jsonb(p)
        results.append(
            PromptTemplateResponse(
                id=0,
                purpose=p,
                version=0,
                name=f"内置版本 — {label}",
                system_prompt=system,
                user_prompt=user,
                template_engine="hardcoded",
                variables=var_meta,
                is_active=not has_active_db,
                created_by="system",
                remark="系统内置兜底提示词，不在数据库中。无 DB 激活版本时自动使用。",
                created_at=now,
                updated_at=now,
                is_builtin=True,
                locked=True,
            )
        )

    return results


@router.post("", status_code=201, response_model=PromptTemplateResponse)
async def create_prompt(
    data: PromptTemplateCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("prompt_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    max_v = db.query(PT).filter(PT.purpose == data.purpose).order_by(PT.version.desc()).first()
    version = (max_v.version + 1) if max_v else 1

    template_vars = _extract_vars(data.system_prompt) | _extract_vars(data.user_prompt)
    errors, warnings = get_registry().validate_template_vars(data.purpose, template_vars)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    if warnings:
        log.warning("create_prompt %s: %s", data.purpose, "; ".join(warnings))

    if data.variables:
        registry_map = get_registry().get_variable_map(data.purpose)
        merged = []
        for uv in data.variables:
            name = uv["name"] if isinstance(uv, dict) else uv
            if isinstance(uv, dict) and name in registry_map:
                rv = registry_map[name]
                merged.append(
                    {
                        "name": name,
                        "desc": uv.get("desc", rv.description),
                        "source": uv.get("source", rv.source),
                        "type": uv.get("type", rv.type),
                        "example": uv.get("example", rv.default_example),
                    }
                )
            elif isinstance(uv, dict):
                merged.append(uv)
            else:
                merged.append({"name": name, "desc": ""})
        default_vars = merged
    else:
        default_vars = get_registry().get_variables_jsonb(data.purpose)

    pt = PT(
        purpose=data.purpose,
        version=version,
        name=data.name,
        system_prompt=data.system_prompt,
        user_prompt=data.user_prompt,
        variables=_dedup_variables(default_vars),
        is_active=False,
        created_by=data.created_by or current_user.username,
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
    request: Request,
    current_user: Annotated[User, Depends(require_permission("prompt_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="模板不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(pt, k, v)
    if any(k in data.model_dump(exclude_none=True) for k in ("system_prompt", "user_prompt")):
        template_vars = _extract_vars(pt.system_prompt) | _extract_vars(pt.user_prompt)
        errors, warnings = get_registry().validate_template_vars(pt.purpose, template_vars)
        if errors:
            raise HTTPException(status_code=400, detail="; ".join(errors))
        if warnings:
            log.warning("update_prompt %s v%d: %s", pt.purpose, pt.version, "; ".join(warnings))
        existing_map = {v["name"]: v for v in (pt.variables or [])}
        registry_map = get_registry().get_variable_map(pt.purpose)
        new_vars = []
        for vname in sorted(template_vars):
            if vname in existing_map:
                new_vars.append(existing_map[vname])
            elif vname in registry_map:
                rv = registry_map[vname]
                new_vars.append(
                    {
                        "name": vname,
                        "desc": rv.description,
                        "source": rv.source,
                        "type": rv.type,
                        "example": rv.default_example,
                    }
                )
            else:
                new_vars.append({"name": vname, "desc": ""})
        pt.variables = _dedup_variables(new_vars)
    db.commit()
    db.refresh(pt)
    await request.app.state.prompt_manager.reload()
    return pt


@router.delete("/{prompt_id}", response_model=DeleteResponse)
def delete_prompt(
    prompt_id: int,
    current_user: Annotated[User, Depends(require_permission("prompt_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="模板不存在")
    if pt.is_active:
        raise HTTPException(status_code=400, detail="不能删除当前激活的模板，请先激活其他版本")
    db.delete(pt)
    db.commit()
    return {"ok": True}


@router.post("/{prompt_id}/activate", response_model=OkResponse)
async def activate_prompt(
    prompt_id: int,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("prompt_manage"))],
    db: Annotated[Session, Depends(get_db)],
    purpose: str | None = None,
):
    """激活指定版本。prompt_id=0 表示切换到内置兜底（停用该 purpose 所有 DB 版本）。"""
    if prompt_id == 0:
        if not purpose:
            raise HTTPException(status_code=400, detail="切换到内置版本需要指定 purpose")
        db.query(PT).filter(PT.purpose == purpose).update({"is_active": False})
        db.commit()
        await request.app.state.prompt_manager.reload()
        return {"ok": True}

    await _activate(prompt_id, db)
    await request.app.state.prompt_manager.reload()
    return {"ok": True}


async def _activate(prompt_id: int, db: Session):
    pt = db.query(PT).filter(PT.id == prompt_id).first()
    if not pt:
        raise HTTPException(status_code=404, detail="模板不存在")
    db.query(PT).filter(PT.purpose == pt.purpose).update({"is_active": False})
    pt.is_active = True
    db.commit()


@router.post("/validate", response_model=PromptValidateResponse)
def validate_prompt(
    data: PromptValidateRequest, current_user: Annotated[User, Depends(require_permission("prompt_manage"))]
):
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

    reg_errors, reg_warnings = get_registry().validate_template_vars(data.purpose, vars_set)
    all_errors = errors + reg_errors
    all_warnings = list(reg_warnings)
    return PromptValidateResponse(
        valid=len(all_errors) == 0, errors=all_errors, missing_vars=missing, warnings=all_warnings
    )


@router.post("/reload")
async def reload_prompts_endpoint(
    request: Request, current_user: Annotated[User, Depends(require_permission("prompt_manage"))]
):
    await request.app.state.prompt_manager.reload()
    return {"ok": True}


@router.get("/sample-vars", response_model=SampleVarsResponse)
def get_sample_vars(purpose: str, current_user: Annotated[User, Depends(require_permission("prompt_manage"))]):
    known = {"patient_chat", "patient_dynamic", "scoring", "scoring_feedback", "qa", "case_generation"}
    if purpose not in known:
        raise HTTPException(status_code=404, detail=f"未知 purpose: {purpose}")
    return {"purpose": purpose, "vars": get_registry().get_sample_kwargs(purpose)}


@router.get("/active/preview", response_model=PromptPreviewResponse)
def preview_active_prompt(
    purpose: str,
    current_user: Annotated[User, Depends(require_permission("prompt_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    pt = db.query(PT).filter(PT.purpose == purpose, PT.is_active).first()
    if not pt:
        raise HTTPException(status_code=404, detail=f"「{purpose}」没有激活的模板")
    sample = get_registry().get_sample_kwargs(purpose)
    # 合并自定义变量（不在 registry 中但模板自带 default_value 的变量）
    for v in pt.variables or []:
        name = v.get("name", "") if isinstance(v, dict) else str(v)
        if name and name not in sample:
            default_val = v.get("default_value", "") if isinstance(v, dict) else ""
            sample[name] = default_val or v.get("example", "") if isinstance(v, dict) else ""
    system_rendered = pt.system_prompt
    user_rendered = pt.user_prompt
    render_error = None
    try:
        system_rendered = render_template(pt.system_prompt, **sample) if sample else pt.system_prompt
        if pt.user_prompt:
            user_rendered = render_template(pt.user_prompt, **sample) if sample else pt.user_prompt
    except RuntimeError as e:
        render_error = str(e)
        log.warning("preview render failed purpose=%s v%d: %s", purpose, pt.version, e)
    return PromptPreviewResponse(
        purpose=pt.purpose,
        version=pt.version,
        system_prompt_raw=pt.system_prompt,
        user_prompt_raw=pt.user_prompt,
        system_prompt_rendered=system_rendered,
        user_prompt_rendered=user_rendered if pt.user_prompt else None,
        sample_vars=sample,
        render_error=render_error,
    )
