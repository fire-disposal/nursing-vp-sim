import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import Case, TrainingRecord, User
from schemas import (
    CaseBrief,
    CaseCreateRequest,
    CaseDetail,
    CaseGenerateRequest,
    CaseGenerateResponse,
    CaseManageItem,
    CaseUpdateRequest,
    DeleteResponse,
    MessageResponse,
    PaginatedResponse,
)

log = logging.getLogger(__name__)

from core.config import get_llm_config
from infrastructure.llm.client import CallContext
from core.pagination import paginate
from infrastructure.prompt import get_registry
from contexts.patient import format_case_for_prompt

router = APIRouter(prefix="/api/cases", tags=["病例"])


def _personality_label(p: dict) -> str:
    """人格维度简要标签，如'高素养·絮叨·安宁·耐心'"""
    if not p:
        return ""
    parts = []
    map_lit = {"low": "低素养", "normal": "中等", "high": "高素养"}
    map_verb = {"terse": "寡言", "normal": "正常", "verbose": "絮叨"}
    map_anx = {"calm": "安宁", "normal": "平常", "anxious": "焦虑"}
    map_pat = {"low": "急躁", "normal": "正常", "high": "耐心"}
    if p.get("health_literacy"):
        parts.append(map_lit.get(p["health_literacy"], ""))
    if p.get("verbosity"):
        parts.append(map_verb.get(p["verbosity"], ""))
    if p.get("anxiety_trait"):
        parts.append(map_anx.get(p["anxiety_trait"], ""))
    if p.get("patience"):
        parts.append(map_pat.get(p["patience"], ""))
    return "·".join(filter(None, parts))


def _to_manage_item(case: Case, training_count: int = 0) -> CaseManageItem:
    cd = case.case_data or {}
    info = cd.get("patient_info", {})
    personality = cd.get("personality", {})
    return CaseManageItem(
        id=case.id,
        name=case.name,
        description=case.description,
        patient_name=info.get("name", ""),
        patient_age=info.get("age"),
        patient_gender=info.get("gender", ""),
        chief_complaint=cd.get("chief_complaint", ""),
        time_limit=cd.get("time_limit", 20),
        difficulty=cd.get("difficulty", 1),
        patient_personality=_personality_label(personality),
        created_at=case.created_at,
        training_count=training_count,
    )


@router.get("", response_model=PaginatedResponse[CaseBrief])
def list_cases(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Case).order_by(Case.id)
    effective_school = resolve_school_filter(current_user, school_id)
    if effective_school is not None:
        query = query.filter((Case.school_id == effective_school) | (Case.school_id.is_(None)))
    items, total = paginate(query, offset, limit)
    return PaginatedResponse(
        items=[
            CaseBrief(
                id=c.id,
                name=c.name,
                difficulty=c.case_data.get("difficulty", 1) if c.case_data else 1,
                description=c.description,
                patient_summary=c.case_data.get("patient_info") if c.case_data else None,
            )
            for c in items
        ],
        total=total,
        offset=offset,
        limit=limit,
    )


# ── 教师病例管理（/manage/list 必须在 /{case_id} 之前声明，避免 "manage" 被当作 case_id）──


@router.get("/manage/list", response_model=PaginatedResponse[CaseManageItem])
def list_cases_manage(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    name: Annotated[str | None, Query(description="病例名称模糊搜索")] = None,
    difficulty: Annotated[int | None, Query(ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级")] = None,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("case_manage")),
):
    """教师查看所有病例（含训练次数统计）"""
    query = db.query(Case).order_by(Case.created_at.desc())
    effective_school = resolve_school_filter(current_user, school_id)
    if effective_school is not None:
        query = query.filter((Case.school_id == effective_school) | (Case.school_id.is_(None)))
    if name:
        query = query.filter(Case.name.ilike(f"%{name}%"))
    if difficulty is not None:
        query = query.filter(Case.case_data["difficulty"].as_integer() == difficulty)
    total = query.order_by(None).count()
    cases = query.offset(offset).limit(limit).all()

    training_counts = {}
    if cases:
        rows = (
            db.query(TrainingRecord.case_id, func.count(TrainingRecord.id))
            .filter(TrainingRecord.case_id.in_([c.id for c in cases]))
            .group_by(TrainingRecord.case_id)
            .all()
        )
        training_counts = dict(rows)

    return PaginatedResponse(
        items=[
            CaseManageItem(
                id=c.id,
                name=c.name,
                description=c.description,
                patient_name=(c.case_data or {}).get("patient_info", {}).get("name", ""),
                patient_age=(c.case_data or {}).get("patient_info", {}).get("age"),
                patient_gender=(c.case_data or {}).get("patient_info", {}).get("gender", ""),
                chief_complaint=(c.case_data or {}).get("chief_complaint", ""),
                time_limit=(c.case_data or {}).get("time_limit", 20),
                difficulty=(c.case_data or {}).get("difficulty", 1),
                created_at=c.created_at,
                training_count=training_counts.get(c.id, 0),
            )
            for c in cases
        ],
        total=total,
        offset=offset,
        limit=limit,
    )



@router.post("/generate", response_model=CaseGenerateResponse)
async def generate_case(
    data: CaseGenerateRequest,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("case_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    if not data.description.strip():
        raise HTTPException(status_code=400, detail="描述不能为空")

    reference_material = ""
    if data.mode == "reference":
        parts = []
        if data.reference_case_ids:
            ref_cases = db.query(Case).filter(Case.id.in_(data.reference_case_ids)).all()
            found_ids = {c.id for c in ref_cases}
            missing = [cid for cid in data.reference_case_ids if cid not in found_ids]
            if missing:
                raise HTTPException(status_code=404, detail=f"参考病例不存在: {missing}")
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

    return CaseGenerateResponse(case_data=result)


@router.get("/{case_id}", response_model=CaseDetail)
def get_case(
    case_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    effective_school = resolve_school_filter(current_user)
    query = db.query(Case).filter(Case.id == case_id)
    if effective_school is not None:
        query = query.filter(Case.school_id == effective_school)
    case = query.first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    return case


@router.post("", response_model=CaseManageItem)
def create_case(
    req: CaseCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permission("case_manage"))],
):
    """创建新病例"""
    cd = req.case_data
    if not cd.get("name"):
        raise HTTPException(status_code=400, detail="病例数据必须包含 name 字段")
    if len(str(cd.get("name", ""))) > 100:
        raise HTTPException(status_code=400, detail="病例名称不能超过100个字符")
    if "personality" not in cd:
        cd["personality"] = {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"}
    if "deep_background" not in cd:
        cd["deep_background"] = {}
    if "exam_anchors" not in cd:
        cd["exam_anchors"] = {}
    if "example_dialogues" not in cd:
        cd["example_dialogues"] = []
    case = Case(
        name=cd["name"],
        description=cd.get("description", ""),
        case_data=cd,
        school_id=current_user.school_id,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    log.info(
        f"病例创建: case_id={case.id} case_name={case.name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return _to_manage_item(case, 0)


@router.put("/{case_id}", response_model=CaseManageItem)
def update_case(
    case_id: int,
    req: CaseUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permission("case_manage"))],
):
    """编辑病例"""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    cd = req.case_data
    if not cd.get("name"):
        raise HTTPException(status_code=400, detail="病例数据必须包含 name 字段")
    if len(str(cd.get("name", ""))) > 100:
        raise HTTPException(status_code=400, detail="病例名称不能超过100个字符")
    case.name = cd["name"]
    case.description = cd.get("description", "")
    case.case_data = cd
    db.commit()
    db.refresh(case)
    log.info(
        f"病例编辑: case_id={case_id} case_name={case.name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    count = db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar() or 0
    return _to_manage_item(case, count)


@router.delete("/{case_id}", response_model=DeleteResponse)
def delete_case(
    case_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_permission("case_manage"))],
):
    """删除病例（仅当无训练记录时允许）"""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    count = db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar() or 0
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该病例已有 {count} 条训练记录，无法删除。请先删除相关训练记录。",
        )
    case_name = case.name
    db.delete(case)
    db.commit()
    log.info(
        f"病例删除: case_id={case_id} case_name={case_name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "病例已删除"}
