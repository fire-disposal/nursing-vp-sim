"""rename_school_admin_to_admin

# Manual override reason: data_only

将 school_admin 系统角色重命名为 admin，移出 role_manage 权限，
更新 display_name 为 "管理员"。幂等 —— 重复执行无副作用。

Revision ID: mrlze6snkjy4
Revises: ca33908908b3
Create Date: 2026-07-15 11:12:51

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "mrlze6snkjy4"
down_revision: Union[str, Sequence[str], None] = "ca33908908b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ADMIN_PERMS = [
    "user_manage",
    "grade_class_manage",
    "case_manage",
    "training_access",
    "score_review",
    "stats_view",
    "qa_access",
    "llm_monitor",
    "assignment_manage",
    "feedback_review",
    "export_data",
    "record_notes",
    "questionnaire_manage",
]

_SCHOOL_ADMIN_PERMS = [*_ADMIN_PERMS, "role_manage"]


def _sql(text: str, **params) -> sa.engine.CursorResult:
    return op.get_bind().execute(sa.text(text), params)


def _resync_perms(role_name: str, perms: list[str]) -> None:
    _sql(
        "DELETE FROM role_permissions WHERE role_id IN "
        "(SELECT id FROM roles WHERE name = :n AND is_system = true)",
        n=role_name,
    )
    for perm in perms:
        _sql(
            "INSERT INTO role_permissions (role_id, permission) "
            "SELECT id, :p FROM roles WHERE name = :n AND is_system = true",
            n=role_name,
            p=perm,
        )


def upgrade() -> None:
    bind = op.get_bind()

    sa_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE name = 'school_admin' AND is_system = true")
    ).fetchone()
    if sa_row is None:
        return

    admin_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE name = 'admin' AND is_system = true")
    ).fetchone()

    if admin_row is not None:
        bind.execute(
            sa.text("UPDATE users SET role_id = :new_id WHERE role_id = :old_id"),
            {"new_id": admin_row[0], "old_id": sa_row[0]},
        )
        bind.execute(sa.text("DELETE FROM role_permissions WHERE role_id = :rid"), {"rid": sa_row[0]})
        bind.execute(sa.text("DELETE FROM roles WHERE id = :rid"), {"rid": sa_row[0]})
    else:
        _sql(
            "UPDATE roles SET name = 'admin', display_name = '管理员' WHERE id = :rid",
            rid=sa_row[0],
        )

    _resync_perms("admin", _ADMIN_PERMS)


def downgrade() -> None:
    _sql(
        "UPDATE roles SET name = 'school_admin', display_name = '学校管理员' WHERE name = 'admin' AND is_system = true"
    )
    _resync_perms("school_admin", _SCHOOL_ADMIN_PERMS)
