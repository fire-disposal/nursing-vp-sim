"""batch_a_backfill_data — 从 case_data JSONB 提取字段到专用列。

承接 DDL 迁移 edc17425a5f4（在 cases/training_records 中添加了新列）。
先有列，再回填：# Manual override reason: data_only

Revision ID: mrac4bzvuq7d
Revises: edc17425a5f4
Create Date: 2026-07-07 07:35:52

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'mrac4bzvuq7d'
down_revision: Union[str, Sequence[str], None] = 'edc17425a5f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 从 case_data JSONB 提取 difficulty 和 time_limit 到专用列
    op.execute("UPDATE cases SET difficulty = (case_data->>'difficulty')::int WHERE case_data ? 'difficulty'")
    op.execute("UPDATE cases SET time_limit_minutes = (case_data->>'time_limit')::int WHERE case_data ? 'time_limit'")


def downgrade() -> None:
    # 回退：重置回填的值（列本身由 edc17425a5f4 的降级处理）
    op.execute("UPDATE cases SET difficulty = 1 WHERE difficulty IS NOT NULL AND difficulty != 1")
    op.execute("UPDATE cases SET time_limit_minutes = 20 WHERE time_limit_minutes IS NOT NULL AND time_limit_minutes != 20")
