from sqlalchemy import func

from models import Role, RolePermission, User
from repositories.base import Repository


class RoleRepository(Repository[Role]):
    model = Role

    def list_all(self, search: str = "") -> list[Role]:
        q = self.db.query(Role)
        if search:
            q = q.filter(Role.display_name.ilike(f"%{search}%"))
        return q.order_by(Role.id).all()

    def name_exists(self, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Role).filter(Role.name == name)
        if exclude_id is not None:
            q = q.filter(Role.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def permissions_map(self, role_ids: list[int]) -> dict[int, list[str]]:
        if not role_ids:
            return {}
        rows = self.db.query(RolePermission).filter(RolePermission.role_id.in_(role_ids)).all()
        result: dict[int, list[str]] = {}
        for p in rows:
            result.setdefault(p.role_id, []).append(p.permission)
        return result

    def user_counts(self, role_ids: list[int]) -> dict[int, int]:
        if not role_ids:
            return {}
        rows = (
            self.db.query(User.role_id, func.count(User.id))
            .filter(User.role_id.in_(role_ids))
            .group_by(User.role_id)
            .all()
        )
        return {role_id: cnt for role_id, cnt in rows}

    def get_permissions(self, role_id: int) -> list[str]:
        rows = self.db.query(RolePermission.permission).filter(RolePermission.role_id == role_id).all()
        return [r[0] for r in rows]

    def replace_permissions(self, role_id: int, permissions: list[str]) -> None:
        self.db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()
        for perm in permissions:
            self.db.add(RolePermission(role_id=role_id, permission=perm))

    def user_count(self, role_id: int) -> int:
        return self.db.query(func.count(User.id)).filter(User.role_id == role_id).scalar() or 0
