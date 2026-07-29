"""merge training tool requests and discarded status heads

Revision ID: 9a8b7c6d5e4f
Revises: 7c2d8a91f4b6, 7c8f1d2a9b30
Create Date: 2026-07-29
"""

from collections.abc import Sequence

revision: str = "9a8b7c6d5e4f"
down_revision: str | Sequence[str] | None = ("7c2d8a91f4b6", "7c8f1d2a9b30")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
