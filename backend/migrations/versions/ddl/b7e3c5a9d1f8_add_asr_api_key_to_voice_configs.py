"""add independent ASR key and per-channel ENV seed markers

ASR 走独立的火山凭据。TTS/ASR 各记录一次 ENV 初始化状态，避免后续启动覆盖管理页配置。

Revision ID: b7e3c5a9d1f8
Revises: a6f1c3d9e2b4
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "b7e3c5a9d1f8"
down_revision: str | Sequence[str] | None = "a6f1c3d9e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: 加独立 ASR 凭据列（非空，默认空字符串）。"""
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("voice_configs")}
    if "asr_api_key" not in existing:
        op.add_column(
            "voice_configs",
            sa.Column("asr_api_key", sa.Text(), nullable=False, server_default=sa.text("''")),
        )
    # 与模型保持一致：默认值只在存量行回填时用，之后由应用层写入。
    op.alter_column("voice_configs", "asr_api_key", server_default=None)
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("voice_configs")}
    for name in ("tts_env_seeded", "asr_env_seeded"):
        if name not in existing:
            op.add_column("voice_configs", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema: 删除 ASR 凭据列（连同其中的 Key）。"""
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("voice_configs")}
    for name in ("tts_env_seeded", "asr_env_seeded"):
        if name in existing:
            op.drop_column("voice_configs", name)
    if "asr_api_key" not in existing:
        return
    op.drop_column("voice_configs", "asr_api_key")
