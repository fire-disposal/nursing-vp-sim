from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import Class, Grade, User, UserClass
from schemas import ClassCreate, ClassResponse, ClassUpdate, DeleteResponse

router = APIRouter(prefix="/api/admin/classes", tags=["班级管理"])


@router.get("", response_model=list[ClassResponse])
def list_classes(
    grade_id: Annotated[int | None, Query()] = None,
    current_user: User = Depends(require_permission("grade_class_manage")),
    db: Session = Depends(get_db),
):
    q = db.query(Class, Grade.name.label("grade_name"))
    q = q.join(Grade, Grade.id == Class.grade_id)
    q = q.filter(Grade.school_id == current_user.school_id)
    if grade_id is not None:
        q = q.filter(Class.grade_id == grade_id)
    rows = q.order_by(Grade.name, Class.name).all()

    result = []
    for cls, grade_name in rows:
        student_count = db.query(func.count(UserClass.user_id)).filter(UserClass.class_id == cls.id).scalar() or 0
        result.append(
            ClassResponse(
                id=cls.id,
                grade_id=cls.grade_id,
                grade_name=grade_name,
                name=cls.name,
                student_count=student_count,
                created_at=cls.created_at,
            )
        )
    return result


@router.post("", response_model=ClassResponse)
def create_class(
    body: ClassCreate,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    grade = db.query(Grade).filter(Grade.id == body.grade_id, Grade.school_id == current_user.school_id).first()
    if not grade:
        raise HTTPException(status_code=404, detail="年级不存在")
    dup = db.query(Class).filter(Class.grade_id == body.grade_id, Class.name == body.name).first()
    if dup:
        raise HTTPException(status_code=400, detail="该年级下班级名称重复")
    cls = Class(grade_id=body.grade_id, name=body.name)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return ClassResponse(
        id=cls.id,
        grade_id=cls.grade_id,
        grade_name=grade.name,
        name=cls.name,
        student_count=0,
        created_at=cls.created_at,
    )


@router.put("/{class_id}", response_model=ClassResponse)
def update_class(
    class_id: int,
    body: ClassUpdate,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    cls = db.query(Class).filter(Class.id == class_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    if body.grade_id is not None:
        grade = db.query(Grade).filter(Grade.id == body.grade_id, Grade.school_id == current_user.school_id).first()
        if not grade:
            raise HTTPException(status_code=404, detail="年级不存在")
        cls.grade_id = body.grade_id
    if body.name is not None:
        dup = (
            db.query(Class)
            .filter(
                Class.grade_id == cls.grade_id,
                Class.name == body.name,
                Class.id != class_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=400, detail="该年级下班级名称重复")
        cls.name = body.name
    db.commit()
    db.refresh(cls)
    grade = db.query(Grade).filter(Grade.id == cls.grade_id).first()
    student_count = db.query(func.count(UserClass.user_id)).filter(UserClass.class_id == cls.id).scalar() or 0
    return ClassResponse(
        id=cls.id,
        grade_id=cls.grade_id,
        grade_name=grade.name if grade else "",
        name=cls.name,
        student_count=student_count,
        created_at=cls.created_at,
    )


@router.delete("/{class_id}", response_model=DeleteResponse)
def delete_class(
    class_id: int,
    current_user: Annotated[User, Depends(require_permission("grade_class_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    cls = db.query(Class).join(Grade).filter(Class.id == class_id, Grade.school_id == current_user.school_id).first()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")
    from sqlalchemy import update as sa_update
    db.execute(sa_update(UserClass).where(UserClass.class_id == class_id).values(class_id=None))
    db.delete(cls)
    db.commit()
    return {"message": f"已删除班级 {cls.name}"}
