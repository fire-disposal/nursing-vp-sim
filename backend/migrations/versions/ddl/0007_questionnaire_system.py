"""add questionnaire system tables

- questionnaire_templates: 问卷模板（前后测）
- questionnaire_questions: 模板内题目
- questionnaire_responses: 学生作答记录
- questionnaire_answers: 逐题答案
- case_questionnaires: 病例-问卷关联

Idempotent: IF NOT EXISTS on all create_table calls.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    return table in insp.get_table_names()


def _has_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade() -> None:
    if not _has_table("questionnaire_templates"):
        op.create_table(
            "questionnaire_templates",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("school_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=120), nullable=False),
            sa.Column("type", sa.String(length=20), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_qt_school_id", "questionnaire_templates", ["school_id"])

    if not _has_table("questionnaire_questions"):
        op.create_table(
            "questionnaire_questions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("template_id", sa.Integer(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("question_type", sa.String(length=20), nullable=False),
            sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("options", postgresql.JSONB(), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["questionnaire_templates.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_qq_template_id", "questionnaire_questions", ["template_id"])

    if not _has_table("questionnaire_responses"):
        op.create_table(
            "questionnaire_responses",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("template_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=True),
            sa.Column("record_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'pending'")),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["record_id"], ["training_records.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["template_id"], ["questionnaire_templates.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_qr_user_template", "questionnaire_responses", ["user_id", "template_id"])
        op.create_index("ix_qr_record_id", "questionnaire_responses", ["record_id"])

    if not _has_table("questionnaire_answers"):
        op.create_table(
            "questionnaire_answers",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("response_id", sa.Integer(), nullable=False),
            sa.Column("question_id", sa.Integer(), nullable=False),
            sa.Column("answer_value", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["question_id"], ["questionnaire_questions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["response_id"], ["questionnaire_responses.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("response_id", "question_id", name="uq_qa_response_question"),
        )
        op.create_index("ix_qa_response_id", "questionnaire_answers", ["response_id"])

    if not _has_table("case_questionnaires"):
        op.create_table(
            "case_questionnaires",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("template_id", sa.Integer(), nullable=False),
            sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("trigger_event", sa.String(length=30), nullable=False, server_default="before_training"),
            sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["template_id"], ["questionnaire_templates.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("case_id", "template_id", name="uq_cq_case_template"),
        )


def downgrade() -> None:
    op.drop_table("case_questionnaires")
    op.drop_table("questionnaire_answers")
    op.drop_table("questionnaire_responses")
    op.drop_table("questionnaire_questions")
    op.drop_table("questionnaire_templates")
