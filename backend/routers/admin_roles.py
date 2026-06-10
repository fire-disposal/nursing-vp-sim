"""角色管理 (school_admin 可管理本校角色)"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import Role, RolePermission, User
from schemas import (
    DeleteResponse,
    RoleCreateRequest,
    RoleResponse,
    RoleUpdateRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/roles", tags=["角色管理"])


@router.get("", response_model=list[RoleResponse])
def list_roles(
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
    search: Annotated[str, Query()] = "",
):
    query = db.query(Role).filter(Role.school_id == current_user.school_id)
    if search:
        query = query.filter(Role.display_name.ilike(f"%{search}%"))
    roles = query.order_by(Role.id).all()

    role_ids = [r.id for r in roles]

    all_perms = db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()
    perms_map = {}
    for p in all_perms:
        perms_map.setdefault(p.role_id, []).append(p.permission)

    if role_ids:
        rows = db.query(User.role_id, func.count(User.id)).filter(User.role_id.in_(role_ids)).group_by(User.role_id).all()
        counts = {role_id: cnt for role_id, cnt in rows}
    else:
        counts = {}

    result = []
    for r in roles:
        result.append(RoleResponse(
            id=r.id, name=r.name, display_name=r.display_name,
            is_system=r.is_system, school_id=r.school_id,
            permissions=perms_map.get(r.id, []),
            user_count=counts.get(r.id, 0),
        ))
    return result


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    req: RoleCreateRequest,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    if db.query(Role).filter(Role.name == req.name, Role.school_id == current_user.school_id).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="角色名已存在")

    role = Role(name=req.name, display_name=req.display_name, school_id=current_user.school_id, is_system=False)
    db.add(role)
    db.flush()

    for perm in req.permissions:
        db.add(RolePermission(role_id=role.id, permission=perm))
    db.commit()
    db.refresh(role)

    log.info("角色已创建: name=%s", req.name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })

    return RoleResponse(
        id=role.id, name=role.name, display_name=role.display_name,
        is_system=role.is_system, school_id=role.school_id,
        permissions=req.permissions, user_count=0,
    )


@router.put("/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    req: RoleUpdateRequest,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id, Role.school_id == current_user.school_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")

    if req.display_name is not None:
        role.display_name = req.display_name

    if req.permissions is not None:
        db.query(RolePermission).filter(RolePermission.role_id == role.id).delete()
        for perm in req.permissions:
            db.add(RolePermission(role_id=role.id, permission=perm))

    db.commit()
    db.refresh(role)

    perms = db.query(RolePermission.permission).filter(RolePermission.role_id == role.id).all()
    user_count = db.query(func.count(User.id)).filter(User.role_id == role.id).scalar() or 0

    log.info("角色已更新: name=%s", role.name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })

    return RoleResponse(
        id=role.id, name=role.name, display_name=role.display_name,
        is_system=role.is_system, school_id=role.school_id,
        permissions=[p.permission for p in perms],
        user_count=user_count,
    )


@router.delete("/{role_id}", response_model=DeleteResponse)
def delete_role(
    role_id: int,
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id, Role.school_id == current_user.school_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="系统角色不可删除")

    user_count = db.query(func.count(User.id)).filter(User.role_id == role.id).scalar() or 0
    if user_count > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"该角色下还有 {user_count} 个用户，无法删除")

    name = role.name
    db.delete(role)
    db.commit()

    log.info("角色已删除: name=%s", name, extra={
        "user_id": current_user.id, "school_id": current_user.school_id,
    })
    return {"message": f"角色 '{name}' 已删除"}
