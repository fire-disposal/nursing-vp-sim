"""extend_notes_schema

Revision ID: 449911a0d604
Revises: 2bf76d5c1796
Create Date: 2026-06-29

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "449911a0d604"
down_revision: str | Sequence[str] | None = "2bf76d5c1796"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("type", sa.String(20), server_default="free", nullable=False))
    op.add_column("notes", sa.Column("title", sa.String(200), server_default="", nullable=False))
    op.add_column("notes", sa.Column("content_jsonb", JSONB, nullable=True))
    op.add_column("notes", sa.Column("tags", JSONB, nullable=True))
    op.add_column("notes", sa.Column("is_private", sa.Boolean, server_default="true", nullable=False))
    op.add_column("notes", sa.Column("training_type", sa.String(50), nullable=True))

    op.alter_column("notes", "record_id", existing_type=sa.Integer, nullable=True,
                    existing_server_default=None)
    op.drop_constraint("notes_record_id_fkey", "notes", type_="foreignkey")
    op.create_foreign_key("notes_record_id_fkey", "notes", "training_records", ["record_id"], ["id"], ondelete="SET NULL")
    op.drop_constraint("notes_user_id_fkey", "notes", type_="foreignkey")
    op.create_foreign_key("notes_user_id_fkey", "notes", "users", ["user_id"], ["id"], ondelete="CASCADE")

    op.create_table(
        "note_comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("note_id", sa.Integer, sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("note_comments")

    op.drop_constraint("notes_user_id_fkey", "notes", type_="foreignkey")
    op.create_foreign_key("notes_user_id_fkey", "notes", "users", ["user_id"], ["id"])
    op.drop_constraint("notes_record_id_fkey", "notes", type_="foreignkey")
    op.create_foreign_key("notes_record_id_fkey", "notes", "training_records", ["record_id"], ["id"])
    op.alter_column("notes", "record_id", existing_type=sa.Integer, nullable=False,
                    existing_server_default=None)

    op.drop_column("notes", "training_type")
    op.drop_column("notes", "is_private")
    op.drop_column("notes", "tags")
    op.drop_column("notes", "content_jsonb")
    op.drop_column("notes", "title")
    op.drop_column("notes", "type")
