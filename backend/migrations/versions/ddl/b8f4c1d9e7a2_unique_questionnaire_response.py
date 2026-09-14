"""unique_questionnaire_response

Revision ID: b8f4c1d9e7a2
Revises: d4f6a8b0c2e4f6a8
Create Date: 2026-09-14

同一 (user_id, template_id, case_id) 只允许一行作答记录 —— 问卷提交按该键 upsert，
重复提交（跨标签/超时重试/双端并发）不再累积多条 completed 行。

原非唯一索引 ix_qr_user_template 是该唯一约束的查询前缀，一并移除。
注意：库中若已存在重复行，本迁移会在建约束时报错；先在 data 迁移/手工清理重复
（保留最早 completed 行）后再执行，清理 SQL 见 PR 说明。
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8f4c1d9e7a2"
down_revision: str | Sequence[str] | None = "d4f6a8b0c2e4f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_qr_user_template_case",
        "questionnaire_responses",
        ["user_id", "template_id", "case_id"],
    )
    op.drop_index("ix_qr_user_template", table_name="questionnaire_responses")


def downgrade() -> None:
    op.create_index("ix_qr_user_template", "questionnaire_responses", ["user_id", "template_id"])
    op.drop_constraint("uq_qr_user_template_case", "questionnaire_responses", type_="unique")
