import logging

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Case, TrainingRecord, User
from schemas import CaseBrief, CaseDetail, CaseCreateRequest, CaseUpdateRequest, CaseManageItem, PaginatedResponse, CaseGenerateRequest, CaseGenerateResponse
from auth import get_current_user, require_teacher
from logger import log
from pagination import paginate
from services.llm_service import call_llm_json
from services.prompt_manager import get_prompt_manager

router = APIRouter(prefix="/api/cases", tags=["病例"])


def _extract_patient_summary(case_data: dict) -> dict:
    """从病例数据中提取可公开的患者基本信息（不含诊断）"""
    info = case_data.get("patient_info", {})
    return {
        "age": info.get("age"),
        "gender": info.get("gender"),
        "chief_complaint": case_data.get("chief_complaint", ""),
    }


def _to_manage_item(case: Case, training_count: int = 0) -> CaseManageItem:
    cd = case.case_data or {}
    info = cd.get("patient_info", {})
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
        created_at=case.created_at,
        training_count=training_count,
    )


@router.get("", response_model=PaginatedResponse[CaseBrief])
def list_cases(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Case).order_by(Case.id)
    items, total = paginate(query, offset, limit)
    return PaginatedResponse(items=[
        CaseBrief(
            id=c.id, name=c.name,
            difficulty=c.case_data.get("difficulty", 1) if c.case_data else 1,
            description=c.description,
            patient_summary=c.case_data.get("patient_info") if c.case_data else None,
        ) for c in items
    ], total=total, offset=offset, limit=limit)


# ── 教师病例管理（/manage/list 必须在 /{case_id} 之前声明，避免 "manage" 被当作 case_id）──

@router.get("/manage/list", response_model=PaginatedResponse[CaseManageItem])
def list_cases_manage(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    name: Optional[str] = Query(None, description="病例名称模糊搜索"),
    difficulty: Optional[int] = Query(None, ge=1, le=3, description="困难程度 1=初级 2=中级 3=高级"),
    db: Session = Depends(get_db),
    _=Depends(require_teacher),
):
    """教师查看所有病例（含训练次数统计）"""
    query = db.query(Case).order_by(Case.created_at.desc())
    if name:
        query = query.filter(Case.name.ilike(f"%{name}%"))
    if difficulty is not None:
        query = query.filter(Case.case_data["difficulty"].as_integer() == difficulty)
    total = query.order_by(None).count()
    cases = query.offset(offset).limit(limit).all()

    training_counts = {}
    if cases:
        rows = db.query(
            TrainingRecord.case_id, func.count(TrainingRecord.id)
        ).filter(
            TrainingRecord.case_id.in_([c.id for c in cases])
        ).group_by(TrainingRecord.case_id).all()
        training_counts = dict(rows)

    return PaginatedResponse(items=[
        CaseManageItem(
            id=c.id, name=c.name, description=c.description,
            patient_name=(c.case_data or {}).get("patient_info", {}).get("name", ""),
            patient_age=(c.case_data or {}).get("patient_info", {}).get("age"),
            patient_gender=(c.case_data or {}).get("patient_info", {}).get("gender", ""),
            chief_complaint=(c.case_data or {}).get("chief_complaint", ""),
            time_limit=(c.case_data or {}).get("time_limit", 20),
            difficulty=(c.case_data or {}).get("difficulty", 1),
            created_at=c.created_at,
            training_count=training_counts.get(c.id, 0),
        ) for c in cases
    ], total=total, offset=offset, limit=limit)


_logger = logging.getLogger("nursing")


@router.post("/generate", response_model=CaseGenerateResponse)
async def generate_case(
    data: CaseGenerateRequest,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    if not data.description.strip():
        raise HTTPException(400, "描述不能为空")

    reference_material = ""
    if data.mode == "reference":
        parts = []
        if data.reference_case_ids:
            ref_cases = db.query(Case).filter(Case.id.in_(data.reference_case_ids)).all()
            found_ids = {c.id for c in ref_cases}
            missing = [cid for cid in data.reference_case_ids if cid not in found_ids]
            if missing:
                raise HTTPException(404, f"参考病例不存在: {missing}")
            for c in ref_cases:
                parts.append(f"--- 参考病例: {c.name} ---\n{_format_case_for_prompt(c.case_data)}")
        if data.reference_text:
            parts.append(f"--- 补充参考资料 ---\n{data.reference_text}")
        reference_material = "\n\n".join(parts)

    pm = await get_prompt_manager()
    tmpl = await pm.get("case_generation")
    system_content = tmpl.render(
        description=data.description,
        reference_material=reference_material or "无",
    )

    if data.field:
        system_content += f"\n\n当前任务：只生成字段「{data.field}」。"
        if data.current_case_data:
            system_content += f"\n\n当前病例上下文：\n{_format_case_for_prompt(data.current_case_data)}"

    messages = [{"role": "system", "content": system_content}]

    try:
        result = await call_llm_json(
            messages, temperature=0.3, max_tokens=4096, timeout=120, max_retries=3,
            purpose="case_generation", user_id=current_user.id,
        )
    except Exception as e:
        _logger.exception("case_generation LLM call failed")
        raise HTTPException(500, f"AI 生成失败: {str(e)}")

    if data.field:
        field_value = result.get("field_value") or result.get(data.field)
        return CaseGenerateResponse(field_value=field_value, field=data.field)

    return CaseGenerateResponse(case_data=result)


def _format_case_for_prompt(case_data: dict) -> str:
    info = case_data.get("patient_info", {})
    lines = [
        f"名称: {case_data.get('name', '')}",
        f"患者: {info.get('name', '')}, {info.get('age', '')}岁, {info.get('gender', '')}",
        f"主诉: {case_data.get('chief_complaint', '')}",
        f"开场白: {case_data.get('opening_line', '')}",
        f"现病史: {case_data.get('present_illness', '')}",
        f"既往史: {case_data.get('past_history', '')}",
        f"用药史: {case_data.get('medication_history', '')}",
        f"过敏史: {case_data.get('allergy_history', '')}",
        f"家族史: {case_data.get('family_history', '')}",
        f"社会史: {case_data.get('social_history', '')}",
        f"沟通风格: {case_data.get('communication_style', '')}",
    ]
    hidden_info = case_data.get("hidden_info", [])
    if hidden_info:
        lines.append(f"隐藏信息: {'; '.join(hidden_info)}")
    required = case_data.get("required_inquiries", [])
    if required:
        lines.append(f"必须采集: {'; '.join(required)}")
    return "\n".join(lines)


@router.get("/{case_id}", response_model=CaseDetail)
def get_case(case_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    return case


@router.post("", response_model=CaseManageItem)
def create_case(
    req: CaseCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """创建新病例"""
    cd = req.case_data
    if not cd.get("name"):
        raise HTTPException(status_code=400, detail="病例数据必须包含 name 字段")
    case = Case(
        name=cd["name"],
        description=cd.get("description", ""),
        case_data=cd,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    log.info(f"病例创建: case_id={case.id} case_name={case.name}",
             extra={"user_id": current_user.id, "user_role": current_user.role})
    return _to_manage_item(case, 0)


@router.put("/{case_id}", response_model=CaseManageItem)
def update_case(
    case_id: int,
    req: CaseUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """编辑病例"""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    cd = req.case_data
    if not cd.get("name"):
        raise HTTPException(status_code=400, detail="病例数据必须包含 name 字段")
    case.name = cd["name"]
    case.description = cd.get("description", "")
    case.case_data = cd
    db.commit()
    db.refresh(case)
    log.info(f"病例编辑: case_id={case_id} case_name={case.name}",
             extra={"user_id": current_user.id, "user_role": current_user.role})
    count = db.query(func.count(TrainingRecord.id)).filter(
        TrainingRecord.case_id == case_id
    ).scalar() or 0
    return _to_manage_item(case, count)


@router.delete("/{case_id}")
def delete_case(
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """删除病例（仅当无训练记录时允许）"""
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")
    count = db.query(func.count(TrainingRecord.id)).filter(
        TrainingRecord.case_id == case_id
    ).scalar() or 0
    if count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该病例已有 {count} 条训练记录，无法删除。请先删除相关训练记录。",
        )
    case_name = case.name
    db.delete(case)
    db.commit()
    log.info(f"病例删除: case_id={case_id} case_name={case_name}",
             extra={"user_id": current_user.id, "user_role": current_user.role})
    return {"message": "病例已删除"}
