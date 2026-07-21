"""fix_timestamptz_all_columns — Convert all TIMESTAMP columns to TIMESTAMPTZ.

The DB server runs on Asia/Shanghai timezone but the application expects UTC.
TIMESTAMP WITHOUT TIME ZONE strips timezone info on insert, effectively storing
Shanghai-local times under the guise of naive timestamps.  Converting to
TIMESTAMPTZ makes PostgreSQL store UTC internally and return timezone-aware
values, matching the application's usage of ensure_utc() and _now_utc().

Revision ID: 62fb36670ee6
Revises: 3f820bc8b2f8
Create Date: 2026-07-21 12:33:16.277450

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "62fb36670ee6"
down_revision: Union[str, Sequence[str], None] = "3f820bc8b2f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TSTZ = sa.DateTime(timezone=True)

COLUMNS: dict[str, list[str]] = {
    "api_secrets": ["created_at", "degraded_until", "last_used_at", "stats_date", "updated_at"],
    "assignments": ["created_at", "end_time", "start_time", "updated_at"],
    "cases": ["created_at", "updated_at"],
    "classes": ["created_at"],
    "feedbacks": ["auto_fix_at", "created_at", "replied_at"],
    "grades": ["created_at"],
    "knowledge_chunks": ["created_at"],
    "llm_call_logs": ["created_at"],
    "llm_configs": ["created_at", "updated_at"],
    "messages": ["created_at"],
    "notifications": ["created_at", "updated_at"],
    "nursing_records": ["created_at", "updated_at"],
    "qa_records": ["created_at"],
    "qa_sessions": ["created_at", "updated_at"],
    "questionnaire_responses": ["completed_at", "created_at"],
    "questionnaire_templates": ["created_at", "updated_at"],
    "score_reviews": ["created_at"],
    "scores": ["created_at"],
    "scoring_progress": ["created_at", "updated_at"],
    "system_notifications": ["created_at", "published_at", "updated_at"],
    "training_records": ["end_time", "start_time"],
    "training_session_state": ["created_at", "updated_at"],
    "user_class": ["joined_at"],
    "users": ["created_at", "last_login_at", "updated_at"],
    "voice_call_logs": ["created_at"],
    "voice_configs": ["created_at", "updated_at"],
}


def upgrade() -> None:
    for table, columns in COLUMNS.items():
        for col in columns:
            op.alter_column(table, col, type_=TSTZ, existing_type=sa.DateTime(), postgresql_using=f"{col}::timestamptz")


def downgrade() -> None:
    for table, columns in COLUMNS.items():
        for col in columns:
            op.alter_column(table, col, type_=sa.DateTime(), existing_type=TSTZ, postgresql_using=f"{col}::timestamp")
