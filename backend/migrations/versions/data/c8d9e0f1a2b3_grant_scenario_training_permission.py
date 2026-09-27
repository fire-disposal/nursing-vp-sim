"""grant_scenario_training_permission

# Manual override reason: data_only

给存量库的四个系统角色补授权限 `scenario_training`（情境训练 · 2026-09-27 转正式特性，
生产中接收测试：学生侧栏/底部 Tab 需要可见入口，故学生侧不再"登录即可"）。

**为什么必须是一条 data 迁移**：`seed._seed_data()` 在 `roles` 表非空时直接返回，
`core/roles.py` 的改动只在空库首次建库时写入 —— 存量 staging/prod 不吃这一套
（同样的理由见 `f1b2c3d4e5a6_grant_audit_permissions`）。

只插入缺失的那一项（幂等），不做全量 resync —— 避免把其它角色的手工调整一起覆盖。
对空库（含 pre-push roundtrip 的临时库）为无操作。

Revision ID: c8d9e0f1a2b3
Revises: b7d0e2f4a6c8
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d9e0f1a2b3"
down_revision: str | Sequence[str] | None = "b7d0e2f4a6c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSION = "scenario_training"
# 与 core/roles.py 的 SYSTEM_PERMISSIONS 保持一致：四种系统角色都持有。
_ROLES = ("super_admin", "admin", "teacher", "student")


def _grant() -> None:
    bind = op.get_bind()
    for role in _ROLES:
        # 同一个命名参数不能既作 INSERT 的值又与 varchar 列比较（PG 会推出两种类型而报
        # AmbiguousParameter）→ 用两个名字相同内容的参数（同 f1b2c3d4e5a6 的写法）。
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission) "
                "SELECT r.id, :p_insert FROM roles r "
                "WHERE r.name = :n AND r.is_system = true "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = :p_check"
                ")"
            ),
            {"n": role, "p_insert": _PERMISSION, "p_check": _PERMISSION},
        )


def _revoke() -> None:
    bind = op.get_bind()
    for role in _ROLES:
        bind.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission = :p AND role_id IN "
                "(SELECT id FROM roles WHERE name = :n AND is_system = true)"
            ),
            {"n": role, "p": _PERMISSION},
        )


def upgrade() -> None:
    """Upgrade data."""
    _grant()


def downgrade() -> None:
    """Downgrade data."""
    _revoke()
