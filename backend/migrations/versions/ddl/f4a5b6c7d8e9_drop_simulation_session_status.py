"""contract: drop simulation_sessions.status —— 状态单真值（docs/16「一个事实、一个 owner」）

``simulation_sessions`` 曾同时存两份结局状态：SQL ``status`` 列与 ``state`` JSONB 里的
``case_status``。两份都由 service 双写，但唯一读点是 JSONB（``build_snapshot`` 与前端
都只读 ``case_status``）——列既管不住 JSONB，也无法被 CHECK 约束保证与业务一致，
只是半迁移残留（tech-debt ASG-12）。

现在定唯一真值：``state.case_status``（词表见 ``core.statuses.SimulationStatus``）。
该列只写不读，删列不丢任何被消费的信息；历史值仍完整保存在 ``state`` JSONB 内。

downgrade 以 ``state->>'case_status'`` 回填真实历史值（而不是回退到默认 ACTIVE），
再恢复 CHECK 约束，使降级后的副本与业务真值一致。

Revision ID: f4a5b6c7d8e9
Revises: e7c3d4e5f6a7
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4a5b6c7d8e9"
down_revision: str | Sequence[str] | None = "e7c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUS_CHECK = "status IN ('ACTIVE', 'SUCCESS', 'FAILURE')"


def upgrade() -> None:
    op.drop_constraint("ck_simulation_sessions_status", "simulation_sessions", type_="check")
    op.drop_column("simulation_sessions", "status")


def downgrade() -> None:
    op.add_column(
        "simulation_sessions",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
    )
    # 真值在 state JSONB：回填历史行，避免降级后副本与业务值不一致。
    op.execute("UPDATE simulation_sessions SET status = COALESCE(state->>'case_status', 'ACTIVE')")
    op.create_check_constraint("ck_simulation_sessions_status", "simulation_sessions", _STATUS_CHECK)
