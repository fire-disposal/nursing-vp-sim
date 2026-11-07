"""unify personas into user_school_personas

把家院校授予从 ``user_personas`` 显式迁到 ``user_school_personas``，然后删旧表：
授予从此只有一处事实来源 ``(user_id, school_id, persona)``。平台账号派生全部视角，不落行。

# Manual override reason: data_only

Revision ID: b3e6c8d0f2a4
Revises: a1c7e4f9b2d6
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3e6c8d0f2a4"
down_revision: str | Sequence[str] | None = "a1c7e4f9b2d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO user_school_personas (user_id, school_id, persona)
            SELECT up.user_id, u.school_id, up.persona
            FROM user_personas up
            JOIN users u ON u.id = up.user_id
            WHERE u.school_id IS NOT NULL
              AND u.is_platform IS FALSE
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.drop_table("user_personas")


def downgrade() -> None:
    # 只恢复家院校授予；附加院校授予是新模型，旧模型无法表达。
    op.create_table(
        "user_personas",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("persona", sa.String(length=20), primary_key=True),
    )
    op.create_index("ix_user_personas_persona", "user_personas", ["persona"], unique=False)
    op.execute(
        sa.text(
            """
            INSERT INTO user_personas (user_id, persona)
            SELECT DISTINCT usp.user_id, usp.persona
            FROM user_school_personas usp
            JOIN users u ON u.id = usp.user_id AND u.school_id = usp.school_id
            ON CONFLICT DO NOTHING
            """
        )
    )
