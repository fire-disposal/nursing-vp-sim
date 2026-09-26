"""add_context_policy_version_to_training_records

记录级冻结"上下文装配策略身份"（docs/ideas/prompt-context-versioning.md P3/V2）：
策略由预算常量派生（``ctx@{hash}``），因此历史记录无法追溯 —— 新列为 NULL 表示不可知，
**不回填**（回填会伪造"当年用的是这套预算"这一无法证实的事实）。

Revision ID: d9f3b4c5e6a7
Revises: c8e2a3b4d5f6
Create Date: 2026-09-26

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9f3b4c5e6a7"
down_revision: str | Sequence[str] | None = "c8e2a3b4d5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("training_records", sa.Column("context_policy_version", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("training_records", "context_policy_version")
