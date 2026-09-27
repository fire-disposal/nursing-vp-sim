"""add_score_raw_detail_and_meta

docs/19 §4.2 第 6 条（保留原始精度）与 §4.4（新记录的规则身份）：

- `scores.raw_detail_scores`：原始刻度（0-raw_scale）的逐项评分快照，含条目状态与证据
  引用。`scores.detail_scores` 继续承载展示投影，两个层次不再互相反推。
- `scores.score_meta`：评分溯源（适用原始满分、不适用条目、rubric 内容身份、评分/反馈
  提示词内容身份、等第政策身份、辅助条件、空反馈说明）。

两列均可空 → 存量历史分保持 NULL，表示"原始精度不可得 / 规则身份不明"，不静默回填。

Revision ID: b1c2d3e4f5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "a9b8c7d6e5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scores", sa.Column("raw_detail_scores", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("scores", sa.Column("score_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("scores", "score_meta")
    op.drop_column("scores", "raw_detail_scores")
