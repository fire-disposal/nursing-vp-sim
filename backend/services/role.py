from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.exceptions import AuthError, ValidationError
from core.security import clear_permission_cache
from core.unit_of_work import unit_of_work
from models import Role, RolePermission
from repositories.role import RoleRepository


@dataclass
class RoleView:
    id: int
    name: str
    display_name: str
    is_system: bool
    permissions: list[str]
    user_count: int


class RoleService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = RoleRepository(db)

    def _view(self, role: Role, permissions: list[str], user_count: int) -> RoleView:
        return RoleView(
            id=role.id,
            name=role.name,
            display_name=role.display_name,
            is_system=role.is_system,
            permissions=permissions,
            user_count=user_count,
        )

    def list_all(self, search: str = "") -> list[RoleView]:
        roles = self.repo.list_all(search)
        role_ids = [r.id for r in roles]
        perms_map = self.repo.permissions_map(role_ids)
        counts = self.repo.user_counts(role_ids)
        return [self._view(r, perms_map.get(r.id, []), counts.get(r.id, 0)) for r in roles]

    def create(self, name: str, display_name: str, permissions: list[str]) -> RoleView:
        if self.repo.name_exists(name):
            raise ValidationError("角色名已存在")
        with unit_of_work(self.db, conflict_detail="角色名已存在"):
            role = self.repo.add(Role(name=name, display_name=display_name, is_system=False))
            for perm in permissions:
                self.db.add(RolePermission(role_id=role.id, permission=perm))
        return self._view(role, list(permissions), 0)

    def update(
        self, role_id: int, *, display_name: str | None = None, permissions: list[str] | None = None
    ) -> RoleView:
        role = self.repo.get_or_404(role_id, "角色不存在")
        if role.is_system:
            raise AuthError("系统角色不可修改", status_code=403)
        with unit_of_work(self.db, conflict_detail="角色冲突"):
            if display_name is not None:
                role.display_name = display_name
            if permissions is not None:
                self.repo.replace_permissions(role.id, permissions)
                clear_permission_cache(role.id)
            self.db.flush()
        perms = self.repo.get_permissions(role.id)
        user_count = self.repo.user_count(role.id)
        return self._view(role, perms, user_count)

    def delete(self, role_id: int) -> str:
        role = self.repo.get_or_404(role_id, "角色不存在")
        if role.is_system:
            raise ValidationError("系统角色不可删除")
        user_count = self.repo.user_count(role.id)
        if user_count > 0:
            raise ValidationError(f"该角色下还有 {user_count} 个用户，无法删除")
        name = role.name
        with unit_of_work(self.db, conflict_detail="角色冲突"):
            self.repo.delete(role)
        return name
