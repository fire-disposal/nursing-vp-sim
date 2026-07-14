import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError as PydanticValidationError

from contexts.case_generation.service import generate_case as _generate_case
from core.deps import CurrentUser, DbSession
from core.security import require_permission
from models import Case, User
from profiles.registry import get_profile
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

from infrastructure.exporter import ColumnDef, export_response

router = APIRouter(prefix="/api/cases", tags=["病例"])

_CaseManager = Annotated[User, Depends(require_permission("case_manage"))]


def _to_case_brief(c: Case) -> CaseBrief:
    profile_info = {}
    try:
        p = get_profile(c.training_type or "history_taking")
        profile_info = {"type": p.name, "label": "病史采集" if p.name == "history_taking" else "预检分诊"}
    except KeyError:
        pass
    return CaseBrief(
        id=c.id,
        name=c.name,
        training_type=c.training_type,
        difficulty=c.case_data.get("difficulty", 1) if c.case_data else 1,
        description=c.description,
        time_limit_minutes=c.time_limit_minutes,
        is_open=c.is_open,
        patient_summary=c.case_data.get("patient_info") if c.case_data else None,
        profile_info=profile_info,
        capabilities=c.case_data.get("capabilities", {}) if c.case_data else {},
    )


def _to_manage_item(v: CaseManageView) -> CaseManageItem:
    return CaseManageItem(
        id=v.id,
        name=v.name,
        description=v.description,
        training_type=v.training_type,
        patient_name=v.patient_name,
        patient_age=v.patient_age,
        patient_gender=v.patient_gender,
        chief_complaint=v.chief_complaint,
        time_limit=v.time_limit,
        difficulty=v.difficulty,
        patient_personality=v.patient_personality,
        is_open=v.is_open,
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
    training_type: Annotated[str | None, Query(description="训练类型 history_taking/triage")] = None,
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None,
    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None,
):
    items, total = CaseService(db).list_brief(
        offset, limit, training_type=training_type, difficulty=difficulty, name=name
    )
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
    training_type: Annotated[str | None, Query(description="训练类型 history_taking/triage")] = None,
):
    views, total = CaseService(db).list_manage(
        offset, limit, name=name, difficulty=difficulty, training_type=training_type
    )
    return PaginatedResponse(
        items=[_to_manage_item(v) for v in views],
        total=total,
        offset=offset,
        limit=limit,
    )


# ── LLM 病例生成（委托至 contexts/case_generation/service.py）──


@router.post("/generate", response_model=CaseGenerateResponse)
async def generate_case(
    data: CaseGenerateRequest,
    request: Request,
    current_user: _CaseManager,
    db: DbSession,
):
    return await _generate_case(data, db, current_user, request.app.state.llm_client)


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
        view = svc.create(req.case_data, current_user.id, current_user.role.name if current_user.role else "")
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
        view = svc.update(case_id, req.case_data, current_user.id, current_user.role.name if current_user.role else "")
    except PydanticValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False))
    return _to_manage_item(view)


@router.put("/{case_id}/open", response_model=CaseManageItem)
def toggle_case_open(
    case_id: int,
    db: DbSession,
    current_user: _CaseManager,
    open: bool = Query(..., description="是否向学生开放"),
):
    svc = CaseService(db)
    case = svc.get(case_id)
    case.is_open = open
    db.commit()
    count = svc.repo.training_count(case_id)
    return _to_manage_item(svc._manage_view(case, count))


@router.delete("/{case_id}", response_model=DeleteResponse)
def delete_case(
    case_id: int,
    db: DbSession,
    current_user: _CaseManager,
):
    CaseService(db).delete(case_id, current_user.id, current_user.role.name if current_user.role else "")
    return {"message": "病例已删除"}


@router.post("/export")
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
