"""add gender check constraint

Revision ID: 17564554d66d
Revises: mryjghn2d3as
Create Date: 2026-07-24 14:07:58.679114

"""

from typing import Sequence, Union

from alembic import op

revision: str = "17564554d66d"
down_revision: Union[str, Sequence[str], None] = "mryjghn2d3as"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_users_gender",
        "users",
        "gender IS NULL OR gender IN ('男', '女')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_gender", "users", type_="check")
