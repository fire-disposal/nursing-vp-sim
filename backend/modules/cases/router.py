import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError as PydanticValidationError

from core.deps import CurrentUser, DbSession
from core.exceptions import ValidationError
from core.security import require_permission
from models import Case, User
from modules.cases.gate import build_validation_report, validate_case_row
from modules.cases.generation import generate_case as _generate_case
from modules.cases.prompts import KNOWN_GENERATION_FIELDS
from modules.cases.service import CaseListFilters, CaseService
from modules.training.workflows import workflow_for_case
from schemas import (
    CaseBrief,
    CaseCreateRequest,
    CaseDetail,
    CaseGenerateRequest,
    CaseGenerateResponse,
    CaseManageItem,
    CasePublishResponse,
    CaseRevisionItem,
    CaseUpdateRequest,
    CaseValidationReport,
    DeleteResponse,
    PaginatedResponse,
    WorkflowBrief,
)

log = logging.getLogger(__name__)

from infra.exporter import ColumnDef, export_response

router = APIRouter(prefix="/api/cases", tags=["病例"])

_CaseManager = Annotated[User, Depends(require_permission("case_manage"))]


def _to_case_brief(c: Case) -> CaseBrief:
    workflow = workflow_for_case(c)
    return CaseBrief(
        id=c.id,
        name=c.name,
        status=c.status,
        difficulty=c.difficulty,
        description=c.description,
        time_limit_minutes=c.time_limit_minutes,
        is_open=c.is_open,
        patient_summary=c.case_data.get("patient_info") if c.case_data else None,
        capabilities=workflow.resolve_features(c.case_data),
        workflow=WorkflowBrief(id=workflow.id, label=workflow.label, runtime_ready=workflow.runtime_ready),
    )


# ── 学生端列表 ──


@router.get("", response_model=PaginatedResponse[CaseBrief])
def list_cases(
    db: DbSession,
    current_user: CurrentUser,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None,
    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None,
):
    """学生目录：只返回已发布（published）且向学生开放的病例。"""
    items, total = CaseService(db).list_brief(offset, limit, difficulty=difficulty, name=name)
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
    filters: Annotated[CaseListFilters, Depends()],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    views, total = CaseService(db).list_manage(filters, offset=offset, limit=limit)
    return PaginatedResponse(
        items=[CaseManageItem.model_validate(v) for v in views],
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
    # 逐字段生成只接受已知路径：未知路径此前会回退到通用提示词，并把结果照样写进 case_data
    if data.field and data.field not in KNOWN_GENERATION_FIELDS:
        raise ValidationError(
            detail="未知字段「{}」，允许的字段：{}".format(data.field, "、".join(sorted(KNOWN_GENERATION_FIELDS)))
        )
    return await _generate_case(data, db, current_user, request.app.state.llm_client)


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
    """新建病例（draft）：内容先落工作副本，发布（POST /{id}/publish）才产生版本。"""
    svc = CaseService(db)
    try:
        view = svc.create(
            req.case_data, current_user.id, current_user.role.name if current_user.role else "", is_open=req.is_open
        )
    except PydanticValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False))
    return CaseManageItem.model_validate(view)


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
    return CaseManageItem.model_validate(view)


@router.put("/{case_id}/open", response_model=CaseManageItem)
def toggle_case_open(
    case_id: int,
    db: DbSession,
    current_user: _CaseManager,
    open: bool = Query(..., description="是否向学生开放"),
):
    svc = CaseService(db)
    case = svc.set_open(case_id, open)
    count = svc.training_count(case_id)
    return CaseManageItem.model_validate(svc._manage_view(case, count))


# ── 发布生命周期（docs/15 §六）──


@router.get("/{case_id}/validation", response_model=CaseValidationReport)
def get_case_validation(case_id: int, db: DbSession, current_user: _CaseManager):
    """发布门禁预览：字段级 error/warning（与 CI 病例审计同一份规则）。"""
    case = CaseService(db).get(case_id)
    return build_validation_report(case, validate_case_row(case))


@router.post("/{case_id}/publish", response_model=CasePublishResponse)
def publish_case(case_id: int, db: DbSession, current_user: _CaseManager):
    """发布病例：门禁通过才落版本（error → 422 + 报告）。"""
    svc = CaseService(db)
    view, report = svc.publish(case_id, current_user.id, current_user.role.name if current_user.role else "")
    return CasePublishResponse(
        case=CaseManageItem.model_validate(view), report=build_validation_report(svc.get(case_id), report)
    )


@router.post("/{case_id}/archive", response_model=CaseManageItem)
def archive_case(case_id: int, db: DbSession, current_user: _CaseManager):
    """归档病例：只阻止新使用，历史 revision 与既有训练复盘不受影响。"""
    view = CaseService(db).archive(case_id, current_user.id, current_user.role.name if current_user.role else "")
    return CaseManageItem.model_validate(view)


@router.get("/{case_id}/revisions", response_model=list[CaseRevisionItem])
def list_case_revisions(case_id: int, db: DbSession, current_user: _CaseManager):
    """版本历史（新→旧）：已发布 revision 不可改，编辑产生新版本。"""
    svc = CaseService(db)
    case = svc.get(case_id)
    return [
        CaseRevisionItem(
            id=r.id,
            revision_no=r.revision_no,
            created_at=r.created_at,
            created_by=r.created_by,
            published_at=r.published_at,
            is_current=r.id == case.current_revision_id,
        )
        for r in svc.revisions(case_id)
    ]


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
    filters: Annotated[CaseListFilters, Depends()],
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from core.config import MAX_EXPORT_ROWS

    # 与 /cases/manage/list 同一个筛选 DTO、同一个服务入口；多取一条以便 export_response 统一判超限
    cases, _total = CaseService(db).list_manage(filters, offset=0, limit=MAX_EXPORT_ROWS + 1)
    columns = [
        ColumnDef("病例名称", key="name"),
        ColumnDef("难度", value=lambda c: {1: "初级", 2: "中级", 3: "高级"}.get(c.difficulty, "")),
        ColumnDef("学生可见", value=lambda c: "是" if c.is_open else "否"),
        ColumnDef("状态", key="status"),
        ColumnDef("描述", key="description"),
    ]
    return export_response(cases, columns, "病例列表", "病例列表", format)
