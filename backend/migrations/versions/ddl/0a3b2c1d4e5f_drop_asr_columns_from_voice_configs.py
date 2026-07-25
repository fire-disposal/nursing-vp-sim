"""drop asr columns from voice_configs

Revision ID: 0a3b2c1d4e5f
Revises: 17564554d66d
Create Date: 2026-07-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0a3b2c1d4e5f"
down_revision: str | Sequence[str] | None = "17564554d66d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# columns dropped in upgrade, restored in downgrade
# (name, type, server_default for backfill on downgrade)
_ASR_COLUMNS: list[tuple[str, sa.types.TypeEngine, str]] = [
    ("asr_resource_id", sa.String(length=64), "volc.bigasr.sauc.duration"),
    ("asr_sample_rate", sa.Integer(), "16000"),
    ("asr_endpoint_mode", sa.String(length=24), "bigmodel_nostream"),
]


def upgrade() -> None:
    insp = inspect(op.get_bind())
    existing = {c["name"] for c in insp.get_columns("voice_configs")}

    for name, _t, _d in _ASR_COLUMNS:
        if name in existing:
            op.drop_column("voice_configs", name)


def downgrade() -> None:
    insp = inspect(op.get_bind())
    existing = {c["name"] for c in insp.get_columns("voice_configs")}

    for name, col_type, default in reversed(_ASR_COLUMNS):
        if name in existing:
            continue
        op.add_column(
            "voice_configs",
            sa.Column(name, col_type, nullable=False, server_default=default),
        )
        op.alter_column("voice_configs", name, server_default=None)
