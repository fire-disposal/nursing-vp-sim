"""scope questionnaire responses by trigger

Revision ID: c9a7e2f4b6d8
Revises: b8f4c1d9e7a2
Create Date: 2026-09-24

Before-training questionnaires remain one response per student/template/case.
After-scoring questionnaires are one response per student/template/training record.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9a7e2f4b6d8"
down_revision: str | Sequence[str] | None = "b8f4c1d9e7a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# downgrade 删除评分后作答行时使用的轻量表对象（ddl/ 禁 op.execute()，故走 Core 语句）。
_RESPONSES = sa.table(
    "questionnaire_responses",
    sa.column("id", sa.Integer),
    sa.column("record_id", sa.Integer),
)


def upgrade() -> None:
    op.drop_constraint(
        "questionnaire_responses_record_id_fkey",
        "questionnaire_responses",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "questionnaire_responses_record_id_fkey",
        "questionnaire_responses",
        "training_records",
        ["record_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("uq_qr_user_template_case", "questionnaire_responses", type_="unique")
    op.create_index(
        "uq_qr_user_template_case_once",
        "questionnaire_responses",
        ["user_id", "template_id", "case_id"],
        unique=True,
        postgresql_where=sa.text("record_id IS NULL"),
    )
    op.create_index(
        "uq_qr_user_template_record",
        "questionnaire_responses",
        ["user_id", "template_id", "record_id"],
        unique=True,
        postgresql_where=sa.text("record_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_qr_user_template_record", table_name="questionnaire_responses")
    op.drop_index("uq_qr_user_template_case_once", table_name="questionnaire_responses")
    # 升级后同一 (user, template, case) 可按训练记录存多行，旧的唯一约束表达不了：
    # 不先清掉评分后作答行，create_unique_constraint 会因重复键失败，整个 downgrade
    # 中止（deploy/rollback.sh 依赖它，失败即中止回滚）。旧代码用 (user, template, case)
    # 定位作答行，这些行回滚后本就无法被区分，删除是唯一无损于旧语义的处置。
    op.get_bind().execute(sa.delete(_RESPONSES).where(_RESPONSES.c.record_id.is_not(None)))
    op.drop_constraint(
        "questionnaire_responses_record_id_fkey",
        "questionnaire_responses",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "questionnaire_responses_record_id_fkey",
        "questionnaire_responses",
        "training_records",
        ["record_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_qr_user_template_case",
        "questionnaire_responses",
        ["user_id", "template_id", "case_id"],
    )
