"""drop_knowledge_chunks_table

QA system now uses chapter_index.py (in-memory, direct .md file reads)
for all textbook access.  The ``knowledge_chunks`` DB table and its
ORM model ``KnowledgeChunk`` are redundant — removed.

Revision ID: c4d5e6f7a8b9
Revises: b3f5a1c2d8e0
Create Date: 2026-07-30
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "b3f5a1c2d8e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_knowledge_chunks_source", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")


def downgrade() -> None:
    import sqlalchemy as sa
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("section", sa.String(length=200), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_knowledge_chunks_source", "knowledge_chunks", ["source"])
