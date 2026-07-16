"""remove_record_notes_permission

# Manual override reason: data_only

从 role_permissions 中删除 record_notes 权限项。

Revision ID: a35d80cbe22c
Revises: 17e4b40c7546
Create Date: 2026-07-16 23:56:36.323899

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a35d80cbe22c"
down_revision: str | Sequence[str] | None = "17e4b40c7546"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.get_bind().execute(sa.text("DELETE FROM role_permissions WHERE permission = 'record_notes'"))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    role_names = ["super_admin", "admin", "teacher"]
    for name in role_names:
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission) "
                "SELECT id, 'record_notes' FROM roles WHERE name = :n AND is_system = true "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM role_permissions rp "
                "  WHERE rp.role_id = roles.id AND rp.permission = 'record_notes'"
                ")"
            ),
            {"n": name},
        )
