"""create user_personas and audit actor_persona

「视角（persona）= 权限预设」（feat/persona-permissions）的 DDL：

- `user_personas(user_id, persona)`：谁被授予了哪些视角。复合主键，
  删用户级联删授权；`persona` 单列索引供"按视角查人"。
- `audit_logs.actor_persona`：操作时**生效**的视角快照（可空，老数据无值）。

只建结构；存量用户回填由紧随其后的 data 迁移完成。

Revision ID: e3a7c1d9b2f8
Revises: c8d2e5f1a3b4
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e3a7c1d9b2f8"
down_revision: str | Sequence[str] | None = "c8d2e5f1a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_personas",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("persona", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_personas_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "persona", name="pk_user_personas"),
    )
    op.create_index("ix_user_personas_persona", "user_personas", ["persona"], unique=False)

    op.add_column("audit_logs", sa.Column("actor_persona", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "actor_persona")
    op.drop_index("ix_user_personas_persona", table_name="user_personas")
    op.drop_table("user_personas")
