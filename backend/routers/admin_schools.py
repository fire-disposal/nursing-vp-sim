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
    search: Annotated[str | None, Query(description="搜索学校名称")] = None,
    current_user: User = Depends(require_permission("school_manage")),
    db: Session = Depends(get_db),
):
    q = db.query(School)
    if search:
        q = q.filter(School.name.ilike(f"%{search}%"))
    total = q.count()
    schools = q.order_by(School.created_at.desc()).offset(offset).limit(limit).all()

    school_ids = [s.id for s in schools]
    roles = db.query(Role).filter(Role.school_id.in_(school_ids), Role.name.in_(["teacher", "student"])).all()
    role_lookup = {}
    for r in roles:
        role_lookup.setdefault(r.school_id, {})[r.name] = r.id

    user_counts = (
        db.query(User.school_id, User.role_id, func.count(User.id))
        .filter(User.school_id.in_(school_ids))
        .group_by(User.school_id, User.role_id)
        .all()
    )
    count_lookup = {}
    for sid, rid, cnt in user_counts:
        count_lookup[(sid, rid)] = cnt

    items = []
    for s in schools:
        teacher_role_id = role_lookup.get(s.id, {}).get("teacher")
        student_role_id = role_lookup.get(s.id, {}).get("student")
        teacher_count = count_lookup.get((s.id, teacher_role_id), 0)
        student_count = count_lookup.get((s.id, student_role_id), 0)
        items.append(
            SchoolResponse(
                id=s.id,
                name=s.name,
                teacher_count=teacher_count,
                student_count=student_count,
                created_at=s.created_at,
            )
        )

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
    db.add(
        User(
            username=req.admin_username,
            password_hash=hash_password(req.admin_password),
            role_id=admin_role_id,
            school_id=school.id,
            display_name=req.admin_display_name,
        )
    )
    db.commit()
    db.refresh(school)

    log.info(
        "学校已创建: name=%s",
        req.name,
        extra={
            "user_id": current_user.id,
            "school_id": school.id,
        },
    )

    return SchoolResponse(
        id=school.id,
        name=school.name,
        teacher_count=0,
        student_count=0,
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

    user_count = db.query(func.count(User.id)).filter(User.school_id == school_id).scalar() or 0
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"该校还有 {user_count} 名用户，无法删除",
        )

    name = school.name
    db.delete(school)
    db.commit()

    log.info(
        "学校已删除: name=%s",
        name,
        extra={
            "user_id": current_user.id,
        },
    )
    return {"message": f"学校 '{name}' 已删除"}
