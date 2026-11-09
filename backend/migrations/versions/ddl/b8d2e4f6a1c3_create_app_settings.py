"""create app_settings singleton (runtime toggles)

Revision ID: b8d2e4f6a1c3
Revises: a7c1e2f3b4d5
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8d2e4f6a1c3"
down_revision: str | Sequence[str] | None = "a7c1e2f3b4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "feedback_hint_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("INSERT INTO app_settings (id, feedback_hint_enabled) VALUES (1, true)")


def downgrade() -> None:
    op.drop_table("app_settings")
