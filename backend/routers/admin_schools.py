"""学校管理 (仅 super_admin 可访问)"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import hash_password, require_permission
from models import Role, RolePermission, School, User
from schemas import (
    DeleteResponse,
    MessageResponse,
    PaginatedResponse,
    SchoolCreate,
    SchoolResponse,
)

log = logging.getLogger(__name__)

from core.roles import SYSTEM_PERMISSIONS, SYSTEM_ROLES

router = APIRouter(prefix="/api/admin/schools", tags=["学校管理"])


@router.get("", response_model=PaginatedResponse[SchoolResponse])
def list_schools(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(School.id)).scalar() or 0
    schools = db.query(School).order_by(School.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for s in schools:
        teacher_role = db.query(Role).filter(Role.name == "teacher", Role.school_id == s.id).first()
        student_role = db.query(Role).filter(Role.name == "student", Role.school_id == s.id).first()
        teacher_count = db.query(func.count(User.id)).filter(User.school_id == s.id, User.role_id == teacher_role.id).scalar() if teacher_role else 0
        student_count = db.query(func.count(User.id)).filter(User.school_id == s.id, User.role_id == student_role.id).scalar() if student_role else 0
        items.append(SchoolResponse(
            id=s.id, name=s.name,
            teacher_count=teacher_count, student_count=student_count,
            created_at=s.created_at,
        ))

    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.post("", response_model=SchoolResponse, status_code=status.HTTP_201_CREATED)
def create_school(
    req: SchoolCreate,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    if db.query(School).filter(School.name == req.name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="学校名称已存在")

    school = School(name=req.name)
    db.add(school)
    db.flush()

    role_map = {}
    for name, display_name in SYSTEM_ROLES:
        role = Role(name=name, display_name=display_name, school_id=school.id, is_system=True)
        db.add(role)
        db.flush()
        role_map[name] = role.id
        for perm in SYSTEM_PERMISSIONS.get(name, []):
            db.add(RolePermission(role_id=role.id, permission=perm))

    admin_role_id = role_map.get("school_admin")
    db.add(User(
        username=req.admin_username,
        password_hash=hash_password(req.admin_password),
        role_id=admin_role_id,
        school_id=school.id,
        display_name=req.admin_display_name,
    ))
    db.commit()
    db.refresh(school)

    log.info("学校已创建: name=%s", req.name, extra={
        "user_id": current_user.id,
        "school_id": school.id,
    })

    return SchoolResponse(
        id=school.id, name=school.name,
        teacher_count=0, student_count=0,
        created_at=school.created_at,
    )


@router.delete("/{school_id}", response_model=DeleteResponse)
def delete_school(
    school_id: int,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    if school_id == current_user.school_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己所在的学校")

    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="学校不存在")

    name = school.name
    db.delete(school)
    db.commit()

    log.info("学校已删除: name=%s", name, extra={
        "user_id": current_user.id,
    })
    return {"message": f"学校 '{name}' 已删除"}
