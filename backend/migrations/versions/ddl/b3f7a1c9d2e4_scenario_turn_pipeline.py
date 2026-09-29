"""情境机制重设计：唯一回合管线所需的请求身份与归档表（docs/scenario.md）。

三件事：

1. `st_session_requests`：**请求身份**唯一约束（`session_id + request_id`）+ 输入摘要 + 已提交结果。
   幂等与冲突必须落在**数据库提交边界**，不能只靠前端 busy：同 id 同输入复用、同 id 异输入拒绝。
   覆盖所有会改变会话记录的请求（回合 / 澄清 / 求提示 / 结束）。
2. `st_session_archives`：旧机制会话的**不可变归档投影**（视图 / 报告 / 回放 + 形状版本），
   按原 `session_id` 唯一。原始 `st_sessions` / `st_events` / `st_pack_revisions` 原样保留。
3. `st_events.kind` 词表：**新机制只写** `session_opened` / `turn_committed` /
   `clarification_exchange` / `hint_requested` / `session_closed`；旧种类保留在约束里只为
   **历史行可读可复制**（约束描述"能写入什么"，不描述"历史长什么样"），新代码不再写它们。

Revision ID: b3f7a1c9d2e4
Revises: e9f1a2b3c4d5
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b3f7a1c9d2e4"
down_revision: str | Sequence[str] | None = "e9f1a2b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEGACY = (
    "'session_opened', 'student_action', 'action_attributed', 'dm_step', 'dm_turn', "
    "'anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected', "
    "'effects_applied', 'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
)
_NEW = (
    "'session_opened', 'turn_committed', 'clarification_exchange', 'hint_requested', 'session_closed', "
    "'student_action', 'action_attributed', 'dm_step', 'dm_turn', "
    "'anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected', "
    "'effects_applied', 'cues_revealed', 'entity_line', 'judge_result'"
)


def _swap_kinds(kinds: str) -> None:
    op.drop_constraint("ck_st_events_kind", "st_events", type_="check")
    op.create_check_constraint("ck_st_events_kind", "st_events", f"kind IN ({kinds})")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "st_session_requests",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("input_sha", sa.String(length=64), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.CheckConstraint("kind IN ('turn', 'close')", name="ck_st_session_requests_kind"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "request_id", name="uq_st_session_requests_session_request"),
    )
    op.create_index("ix_st_session_requests_session", "st_session_requests", ["session_id"])

    op.create_table(
        "st_session_archives",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("pack_key", sa.String(length=120), nullable=False),
        sa.Column("pack_revision_id", sa.Integer(), nullable=False),
        sa.Column("shape_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'completed'"), nullable=False),
        sa.Column("turn", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ended_reason", sa.String(length=32), server_default=sa.text("''"), nullable=False),
        sa.Column("has_report", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("note", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()"), nullable=False),
        sa.CheckConstraint("shape_version >= 1", name="ck_st_session_archives_shape"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", name="uq_st_session_archives_session"),
    )
    op.create_index("ix_st_session_archives_pack", "st_session_archives", ["pack_key"])

    _swap_kinds(_NEW)


def downgrade() -> None:
    """Downgrade schema：只回退词表约束；两张**只增不改**的新表随降级删除。

    若库里已经存在新机制的回合事件，旧词表会**显式拒绝**这次降级（PG 报约束冲突）——
    这是刻意的：删数据不是迁移该替操作者做的决定。

    `st_session_requests` 是幂等登记（丢掉只会让重放变成"再执行一次"），
    `st_session_archives` 是旧会话的归档投影（丢掉则旧局在切换后只剩只读原始事件）。
    降级前请先确认这两处是否还需要。
    """
    _swap_kinds(_LEGACY)
    op.drop_index("ix_st_session_archives_pack", table_name="st_session_archives")
    op.drop_table("st_session_archives")
    op.drop_index("ix_st_session_requests_session", table_name="st_session_requests")
    op.drop_table("st_session_requests")
