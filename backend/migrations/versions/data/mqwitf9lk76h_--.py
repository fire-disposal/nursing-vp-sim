"""--

# Manual override reason: data_only

Revision ID: mqwitf9lk76h
Revises: c975c67840ab
Create Date: 2026-06-27 15:34:34

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "mqwitf9lk76h"
down_revision: str | Sequence[str] | None = "c975c67840ab"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Re-point any user sitting on a NULL-school template role to the same-named
    # school-scoped role (normally 0 rows), so the templates become unreferenced.
    op.execute(
        """
        UPDATE users u SET role_id = r2.id
        FROM roles r1
        JOIN roles r2 ON r2.name = r1.name AND r2.school_id IS NOT NULL
        WHERE u.role_id = r1.id AND r1.school_id IS NULL
        """
    )
    # Delete the unused NULL-school template roles (role_permissions cascade via FK).
    # Guard: only delete roles with no users referencing them (roundtrip-safe).
    op.execute(
        """
        DELETE FROM roles
        WHERE school_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM users WHERE users.role_id = roles.id)
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
