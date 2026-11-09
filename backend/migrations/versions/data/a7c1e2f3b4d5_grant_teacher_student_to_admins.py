"""one-time: grant teacher/student personas to existing school-admin accounts

管理员账号一次性补齐教师/学生视角（用于切换体验与测试训练）。不是持续规则：
新授予的管理员仍由管理员自行选择是否附带教师/学生视角。

# Manual override reason: data_only

Revision ID: a7c1e2f3b4d5
Revises: d5a8b2c4e6f8
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7c1e2f3b4d5"
down_revision: str | Sequence[str] | None = "d5a8b2c4e6f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            INSERT INTO user_school_personas (user_id, school_id, persona)
            SELECT admin_grant.user_id, admin_grant.school_id, extra.persona
            FROM user_school_personas admin_grant
            CROSS JOIN (VALUES ('teacher'), ('student')) AS extra(persona)
            WHERE admin_grant.persona = 'admin'
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade() -> None:
    # 一次性补授不保留"哪些是本次新增"的记录；删除会把原本就有的授予一起抹掉。
    # 数据迁移以 upgrade 为准（与 d5 的回填同一取向）。
    pass
