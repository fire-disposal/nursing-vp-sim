"""add wechat_openid to users

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c["name"] for c in inspector.get_columns("users")]
    if "wechat_openid" not in columns:
        op.add_column("users", sa.Column("wechat_openid", sa.String(64), nullable=True))
    indexes = [i["name"] for i in inspector.get_indexes("users")]
    if "ix_users_wechat_openid" not in indexes:
        op.create_index("ix_users_wechat_openid", "users", ["wechat_openid"], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    indexes = [i["name"] for i in inspector.get_indexes("users")]
    if "ix_users_wechat_openid" in indexes:
        op.drop_index("ix_users_wechat_openid", table_name="users")
    columns = [c["name"] for c in inspector.get_columns("users")]
    if "wechat_openid" in columns:
        op.drop_column("users", "wechat_openid")
