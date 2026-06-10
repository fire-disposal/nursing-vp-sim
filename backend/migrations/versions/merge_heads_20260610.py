"""merge heads

Revision ID: merge_heads_20260610
Revises: e4350c414d9d, a1b2c3d4e5f7, 877be5bc4f3c
Create Date: 2026-06-10 12:50:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "merge_heads_20260610"
down_revision: str | tuple[str, ...] | None = ("e4350c414d9d", "a1b2c3d4e5f7", "877be5bc4f3c")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
