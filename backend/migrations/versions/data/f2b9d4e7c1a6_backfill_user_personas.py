"""backfill_user_personas

# Manual override reason: data_only

给存量用户回填 `user_personas`（视角 = 权限预设迁移动契）。

规则（与 `core/personas.DEFAULT_PERSONA_BY_ROLE` 一致）：

- `super_admin`：**不回填** —— 超管派生拥有全部视角，不落行；
- `student` → `student`，`teacher` → `teacher`，`admin` → `admin`；
- 其它自定义角色：不回填 —— 它们继续走 legacy `role_permissions`
  （`core.security.resolve_view_persona` 的 legacy 分支）。

幂等：`ON CONFLICT DO NOTHING`，重复执行/空库均为无操作。

Revision ID: f2b9d4e7c1a6
Revises: e3a7c1d9b2f8
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2b9d4e7c1a6"
down_revision: str | Sequence[str] | None = "e3a7c1d9b2f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: 角色名 → 默认视角（与 core/personas.DEFAULT_PERSONA_BY_ROLE 同步）
_BACKFILL: tuple[tuple[str, str], ...] = (
    ("student", "student"),
    ("teacher", "teacher"),
    ("admin", "admin"),
)


def _user_personas_table() -> sa.Table:
    return sa.table(
        "user_personas",
        sa.column("user_id", sa.Integer()),
        sa.column("persona", sa.String(length=20)),
    )


def _users_table() -> sa.Table:
    return sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("role_id", sa.Integer()),
    )


def _roles_table() -> sa.Table:
    return sa.table(
        "roles",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String(length=20)),
    )


def upgrade() -> None:
    bind = op.get_bind()
    users = _users_table()
    roles = _roles_table()
    personas = _user_personas_table()

    for role_name, persona in _BACKFILL:
        user_ids = bind.execute(
            sa.select(users.c.id).select_from(users.join(roles, roles.c.id == users.c.role_id)).where(
                roles.c.name == role_name
            )
        ).scalars()
        rows = [{"user_id": uid, "persona": persona} for uid in user_ids]
        if rows:
            # 用 Core 的 insert + on_conflict_do_nothing（PG）：比逐行 SELECT-再-INSERT 少一半往返
            from sqlalchemy.dialects.postgresql import insert as pg_insert

            bind.execute(pg_insert(personas).values(rows).on_conflict_do_nothing())


def downgrade() -> None:
    # 数据回填不可逆：无法区分"迁移回填"与"迁移后人工授予"。
    # 回滚会清掉 student/teacher/admin 三类视角的**全部**授予行（含迁移后人工加的），
    # 自定义角色的 legacy 权限行不受影响。
    bind = op.get_bind()
    personas = _user_personas_table()
    for _role_name, persona in _BACKFILL:
        bind.execute(personas.delete().where(personas.c.persona == persona))
