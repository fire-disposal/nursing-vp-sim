from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Case, TrainingRecord, User
from schemas import CaseBrief, CaseDetail, CaseCreateRequest, CaseUpdateRequest, CaseManageItem, PaginatedResponse
from auth import get_current_user, require_teacher
from logger import log_info
from pagination import paginate

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
    db: Session = Depends(get_db),
    _=Depends(require_teacher),
):
    """教师查看所有病例（含训练次数统计）"""
    query = db.query(Case).order_by(Case.created_at.desc())
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
    log_info(f"病例创建: case_id={case.id} case_name={case.name}",
             user_id=current_user.id, user_role=current_user.role)
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
    log_info(f"病例编辑: case_id={case_id} case_name={case.name}",
             user_id=current_user.id, user_role=current_user.role)
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
    log_info(f"病例删除: case_id={case_id} case_name={case_name}",
             user_id=current_user.id, user_role=current_user.role)
    return {"message": "病例已删除"}
