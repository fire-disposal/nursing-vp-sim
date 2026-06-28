import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError as PydanticValidationError

from core.deps import CurrentUser, DbSession
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from models import Case, User
from schemas import (
    CaseBrief,
    CaseCreateRequest,
    CaseDetail,
    CaseGenerateRequest,
    CaseGenerateResponse,
    CaseManageItem,
    CaseUpdateRequest,
    DeleteResponse,
    PaginatedResponse,
    PracticeBrief,
)
from services.case import CaseManageView, CaseService

log = logging.getLogger(__name__)

from contexts.patient import format_case_for_prompt
from core.case_schema import assert_valid_case_data
from core.llm_profile import get_llm_config
from infrastructure.exporter import ColumnDef, export_response
from infrastructure.llm.client import CallContext
from infrastructure.prompt import get_registry

router = APIRouter(prefix="/api/cases", tags=["病例"])

_CaseManager = Annotated[User, Depends(require_permission("case_manage"))]


def _to_case_brief(c: Case) -> CaseBrief:
    return CaseBrief(
        id=c.id,
        name=c.name,
        difficulty=c.case_data.get("difficulty", 1) if c.case_data else 1,
        description=c.description,
        patient_summary=c.case_data.get("patient_info") if c.case_data else None,
    )


def _to_manage_item(v: CaseManageView) -> CaseManageItem:
    return CaseManageItem(
        id=v.id,
        name=v.name,
        description=v.description,
        patient_name=v.patient_name,
        patient_age=v.patient_age,
        patient_gender=v.patient_gender,
        chief_complaint=v.chief_complaint,
        time_limit=v.time_limit,
        difficulty=v.difficulty,
        patient_personality=v.patient_personality,
        created_at=v.created_at,
        training_count=v.training_count,
    )


# ── 学生端列表 ──


@router.get("", response_model=PaginatedResponse[CaseBrief])
def list_cases(
    db: DbSession,
    current_user: CurrentUser,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    items, total = CaseService(db).list_brief(offset, limit)
    return PaginatedResponse(
        items=[_to_case_brief(c) for c in items],
        total=total,
        offset=offset,
        limit=limit,
    )


# ── 教师病例管理 ──


@router.get("/manage/list", response_model=PaginatedResponse[CaseManageItem])
def list_cases_manage(
    db: DbSession,
    current_user: _CaseManager,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None,
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None,
):
    views, total = CaseService(db).list_manage(offset, limit, name=name, difficulty=difficulty)
    return PaginatedResponse(
        items=[_to_manage_item(v) for v in views],
        total=total,
        offset=offset,
        limit=limit,
    )


# ── LLM 病例生成 (non-CRUD, kept inline) ──


@router.post("/generate", response_model=CaseGenerateResponse)
async def generate_case(
    data: CaseGenerateRequest,
    request: Request,
    current_user: _CaseManager,
    db: DbSession,
):
    if not data.description.strip():
        raise ValidationError(detail="描述不能为空")

    reference_material = ""
    if data.mode == "reference":
        parts = []
        if data.reference_case_ids:
            ref_cases = db.query(Case).filter(Case.id.in_(data.reference_case_ids)).all()
            found_ids = {c.id for c in ref_cases}
            missing = [cid for cid in data.reference_case_ids if cid not in found_ids]
            if missing:
                raise NotFoundError(detail=f"参考病例不存在: {missing}")
            for c in ref_cases:
                parts.append(f"--- 参考病例: {c.name} ---\n{format_case_for_prompt(c.case_data)}")
        if data.reference_text:
            parts.append(f"--- 补充参考资料 ---\n{data.reference_text}")
        reference_material = "\n\n".join(parts)

    pm = request.app.state.prompt_manager
    tmpl = await pm.get("case_generation")
    defaults = get_registry().get_defaults("case_generation")

    field_instruction = ""
    if data.field:
        field_instruction = f"\n\n当前任务：只生成字段「{data.field}」。"
        if data.current_case_data:
            field_instruction += f"\n\n当前病例上下文：\n{format_case_for_prompt(data.current_case_data)}"

    system_content = tmpl.render(
        description=data.description or defaults.get("description", ""),
        reference_material=reference_material or defaults.get("reference_material", "无"),
        field_instruction=field_instruction or defaults.get("field_instruction", ""),
    )

    messages = [{"role": "system", "content": system_content}]

    try:
        result = await request.app.state.llm_client.call_json(
            messages,
            purpose="case_generation",
            ctx=CallContext(
                purpose="case_generation",
                user_id=current_user.id,
                log_meta={"description": data.description[:200] if data.description else None},
            ),
            **get_llm_config("case_generation"),
        )
    except Exception as e:
        log.exception("case_generation LLM call failed")
        raise HTTPException(status_code=500, detail=f"AI 生成失败: {e!s}")

    if data.field:
        field_value = result.get("field_value") or result.get(data.field)
        return CaseGenerateResponse(field_value=field_value, field=data.field)

    try:
        result = assert_valid_case_data(result)
    except PydanticValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False))
    return CaseGenerateResponse(case_data=result)


# ── 子路由: 病例关联练习 (delegated to service) ──


@router.get("/{case_id}/practices", response_model=list[PracticeBrief])
def list_case_practices(
    case_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    return CaseService(db).list_practices(case_id)


# ── CRUD ──


@router.get("/{case_id}", response_model=CaseDetail)
def get_case(
    case_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    return CaseService(db).get(case_id)


@router.post("", response_model=CaseManageItem)
def create_case(
    req: CaseCreateRequest,
    db: DbSession,
    current_user: _CaseManager,
):
    svc = CaseService(db)
    try:
        view = svc.create(
            req.case_data, current_user.id, current_user.role.name if current_user.role else ""
        )
    except PydanticValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False))
    return _to_manage_item(view)


@router.put("/{case_id}", response_model=CaseManageItem)
def update_case(
    case_id: int,
    req: CaseUpdateRequest,
    db: DbSession,
    current_user: _CaseManager,
):
    svc = CaseService(db)
    try:
        view = svc.update(
            case_id, req.case_data, current_user.id, current_user.role.name if current_user.role else ""
        )
    except PydanticValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False))
    return _to_manage_item(view)


@router.delete("/{case_id}", response_model=DeleteResponse)
def delete_case(
    case_id: int,
    db: DbSession,
    current_user: _CaseManager,
):
    CaseService(db).delete(
        case_id, current_user.id, current_user.role.name if current_user.role else ""
    )
    return {"message": "病例已删除"}


@router.get("/export")
def export_cases(
    current_user: _CaseManager,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from models import Case

    cases = db.query(Case).order_by(Case.name).all()
    columns = [
        ColumnDef("病例名称", key="name"),
        ColumnDef("描述", key="description"),
    ]
    return export_response(cases, columns, "病例列表", "病例列表", format)
