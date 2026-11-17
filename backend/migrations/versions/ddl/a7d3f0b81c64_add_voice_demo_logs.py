"""add voice_demo_logs

Revision ID: a7d3f0b81c64
Revises: c5a8e1f3d7b2
Create Date: 2026-11-17

语音实验室的实验采集表（仅追加）。**不是**训练档案：没有 record_id，不关联
training_records / messages，删表不影响任何训练证据链。学生与角色的每条消息一行，
带当时的四维情绪快照与状态（success / interrupted / error），用于事后分析打断与
长句表现。可逆：``downgrade`` 直接删表（采集数据按设计可整体丢弃）。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a7d3f0b81c64"
down_revision: Union[str, Sequence[str], None] = "c5a8e1f3d7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "voice_demo_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("character_id", sa.String(length=40), nullable=False),
        sa.Column("role", sa.String(length=12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("emotion_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_voice_demo_logs_user_id", "voice_demo_logs", ["user_id"])
    op.create_index("ix_voice_demo_logs_created_at", "voice_demo_logs", ["created_at"])
    op.create_index("ix_vdl_session", "voice_demo_logs", ["session_id", "created_at"])
    op.create_index("ix_vdl_user_created", "voice_demo_logs", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_vdl_user_created", table_name="voice_demo_logs")
    op.drop_index("ix_vdl_session", table_name="voice_demo_logs")
    op.drop_index("ix_voice_demo_logs_created_at", table_name="voice_demo_logs")
    op.drop_index("ix_voice_demo_logs_user_id", table_name="voice_demo_logs")
    op.drop_table("voice_demo_logs")
