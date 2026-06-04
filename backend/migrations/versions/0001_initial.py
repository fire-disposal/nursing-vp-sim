"""initial

Revision ID: 0001
Revises: None
Create Date: 2026-06-04
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    import models  # noqa: F401
    from core.database import Base

    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    import models  # noqa: F401
    from core.database import Base

    Base.metadata.drop_all(bind=op.get_bind())
