"""feedback_user_id_ondelete_cascade

Revision ID: 6480fcd4c02c
Revises: a4877b5b4500
Create Date: 2026-07-16 23:30:05.825615

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6480fcd4c02c"
down_revision: str | Sequence[str] | None = "a4877b5b4500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Recreate feedbacks.user_id FK with ON DELETE CASCADE."""
    op.drop_constraint("feedbacks_user_id_fkey", "feedbacks", type_="foreignkey")
    op.create_foreign_key(
        "feedbacks_user_id_fkey",
        "feedbacks",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Restore feedbacks.user_id FK without ON DELETE action."""
    op.drop_constraint("feedbacks_user_id_fkey", "feedbacks", type_="foreignkey")
    op.create_foreign_key(
        "feedbacks_user_id_fkey",
        "feedbacks",
        "users",
        ["user_id"],
        ["id"],
    )
