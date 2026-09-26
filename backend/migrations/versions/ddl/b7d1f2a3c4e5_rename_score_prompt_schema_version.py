"""rename_score_prompt_version_to_prompt_schema_version

`prompt_version` 存的是 prompt_snapshot 的**形状**版本（1/2），名字却被读成
「提示词内容第几版」（docs/17 §三#1、tech-debt PIP-8）。改名为 `prompt_schema_version`
只摆正语义，不新增列、不新增概念，历史取值原样保留。

Revision ID: b7d1f2a3c4e5
Revises: a9d0c1b2e3f4
Create Date: 2026-09-26

"""

from collections.abc import Sequence

from alembic import op

revision: str = "b7d1f2a3c4e5"
down_revision: str | Sequence[str] | None = "a9d0c1b2e3f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("scores", "prompt_version", new_column_name="prompt_schema_version")


def downgrade() -> None:
    op.alter_column("scores", "prompt_schema_version", new_column_name="prompt_version")
