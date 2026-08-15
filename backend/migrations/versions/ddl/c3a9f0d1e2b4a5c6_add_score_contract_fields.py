"""add_score_contract_fields

Phase 1 评分契约：raw_total（原始分 Σ条目）、mapping_version（映射曲线版本）、
fallback（兜底/降级标记）、dim_total（LLM 维度自评快照）、reviewed_total（复核写回）。

Revision ID: c3a9f0d1e2b4a5c6
Revises: 9d4e2f6a8b0c
Create Date: 2026-08-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3a9f0d1e2b4a5c6"
down_revision: str | Sequence[str] | None = "9d4e2f6a8b0c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scores", sa.Column("raw_total", sa.Float(), nullable=True))
    op.add_column("scores", sa.Column("mapping_version", sa.Integer(), server_default="0", nullable=False))
    op.add_column("scores", sa.Column("fallback", sa.dialects.postgresql.JSONB(), nullable=True))
    op.add_column("scores", sa.Column("dim_total", sa.dialects.postgresql.JSONB(), nullable=True))
    op.add_column("scores", sa.Column("reviewed_total", sa.Float(), nullable=True))
    op.add_column("scores", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("scores", "reviewed_at")
    op.drop_column("scores", "reviewed_total")
    op.drop_column("scores", "dim_total")
    op.drop_column("scores", "fallback")
    op.drop_column("scores", "mapping_version")
    op.drop_column("scores", "raw_total")
