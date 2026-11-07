"""backfill user_school_profiles from home student ids

只给家院校已有 student 视角、且有学号的账号建 profile；管理员/超管的 student_id 不写入。

# Manual override reason: data_only

Revision ID: d5a8b2c4e6f8
Revises: c4f7a9b1d3e5
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5a8b2c4e6f8"
down_revision: str | Sequence[str] | None = "c4f7a9b1d3e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            INSERT INTO user_school_profiles (user_id, school_id, student_id)
            SELECT u.id, u.school_id, btrim(u.student_id)
            FROM users u
            WHERE u.school_id IS NOT NULL
              AND NULLIF(btrim(COALESCE(u.student_id, '')), '') IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM user_school_personas usp
                  WHERE usp.user_id = u.id AND usp.school_id = u.school_id AND usp.persona = 'student'
              )
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM user_school_profiles"))
