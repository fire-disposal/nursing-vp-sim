from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import Class, Grade, User, UserClass
from schemas import DeleteResponse, GradeCreate, GradeResponse, GradeUpdate, MessageResponse

router = APIRouter(prefix="/api/admin/grades", tags=["年级管理"])


@router.get("", response_model=list[GradeResponse])
def list_grades(
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    grades = db.query(Grade).filter(Grade.school_id == current_user.school_id).order_by(Grade.name).all()
    result = []
    for g in grades:
        class_count = db.query(func.count(Class.id)).filter(Class.grade_id == g.id).scalar() or 0
        student_count = (
            db.query(func.count(UserClass.user_id))
            .join(Class, Class.id == UserClass.class_id)
            .filter(Class.grade_id == g.id)
            .scalar()
        ) or 0
        result.append(
            GradeResponse(
                id=g.id,
                name=g.name,
                class_count=class_count,
                student_count=student_count,
                created_at=g.created_at,
            )
        )
    return result


@router.post("", response_model=GradeResponse)
def create_grade(
    body: GradeCreate,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    existing = db.query(Grade).filter(Grade.name == body.name, Grade.school_id == current_user.school_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="年级已存在")
    grade = Grade(name=body.name, school_id=current_user.school_id)
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return GradeResponse(
        id=grade.id,
        name=grade.name,
        class_count=0,
        student_count=0,
        created_at=grade.created_at,
    )


@router.put("/{grade_id}", response_model=GradeResponse)
def update_grade(
    grade_id: int,
    body: GradeUpdate,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    grade = db.query(Grade).filter(Grade.id == grade_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    if body.name != grade.name:
        dup = db.query(Grade).filter(Grade.name == body.name, Grade.school_id == current_user.school_id).first()
        if dup:
            raise HTTPException(status_code=400, detail="年级名称重复")
    grade.name = body.name
    db.commit()
    db.refresh(grade)
    class_count = db.query(func.count(Class.id)).filter(Class.grade_id == grade.id).scalar() or 0
    student_count = (
        db.query(func.count(UserClass.user_id))
        .join(Class, Class.id == UserClass.class_id)
        .filter(Class.grade_id == grade.id)
        .scalar()
    ) or 0
    return GradeResponse(
        id=grade.id,
        name=grade.name,
        class_count=class_count,
        student_count=student_count,
        created_at=grade.created_at,
    )


@router.delete("/{grade_id}", response_model=DeleteResponse)
def delete_grade(
    grade_id: int,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    grade = db.query(Grade).filter(Grade.id == grade_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    class_count = db.query(func.count(Class.id)).filter(Class.grade_id == grade_id).scalar() or 0
    from sqlalchemy import delete as sa_delete, update as sa_update
    db.execute(
        sa_update(UserClass)
        .where(UserClass.class_id.in_(db.query(Class.id).filter(Class.grade_id == grade_id)))
        .values(class_id=None)
    )
    db.delete(grade)
    db.commit()
    return {"message": f"已删除年级及其下 {class_count} 个班级"}
