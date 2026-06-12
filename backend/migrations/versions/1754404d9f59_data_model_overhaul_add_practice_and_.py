"""data_model_overhaul_add_practice_and_cleanup

# Manual override reason: data_only
# Autogenerate base was manually extended with: Phase 3 seed data, Phase 4 data
# migration (config_id→practice_id), Phase 5 sequence fix, and user_class PK restructure.

Revision ID: 1754404d9f59
Revises: merge_heads_20260610
Create Date: 2026-06-12 18:15:53.826809

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '1754404d9f59'
down_revision: Union[str, Sequence[str], None] = 'merge_heads_20260610'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Phase 1: Schema changes ──

    # Practice table
    op.create_table('practices',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('case_id', sa.Integer(), nullable=False),
    sa.Column('school_id', sa.Integer(), nullable=True),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('behavior', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('assessment', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.CheckConstraint("mode IN ('training', 'assessment', 'free_play')", name='ck_practices_mode'),
    sa.ForeignKeyConstraint(['case_id'], ['cases.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['school_id'], ['schools.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_practices_case_id', 'practices', ['case_id'], unique=False)
    op.create_index('ix_practices_school_id', 'practices', ['school_id'], unique=False)

    # ScoreReview table
    op.create_table('score_reviews',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('score_id', sa.Integer(), nullable=False),
    sa.Column('reviewed_by', sa.Integer(), nullable=True),
    sa.Column('detail_scores', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['score_id'], ['scores.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_score_reviews_score_id', 'score_reviews', ['score_id'], unique=False)

    # Assignment: add practice_id, drop old columns
    op.add_column('assignments', sa.Column('practice_id', sa.Integer(), nullable=True))
    op.create_index('ix_assignments_practice', 'assignments', ['practice_id'], unique=False)
    op.create_foreign_key(None, 'assignments', 'practices', ['practice_id'], ['id'], ondelete='RESTRICT')

    # TrainingRecord: add practice fields, keep old ones for data migration
    op.add_column('training_records', sa.Column('practice_id', sa.Integer(), nullable=True))
    op.add_column('training_records', sa.Column('practice_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index('ix_tr_practice_id', 'training_records', ['practice_id'], unique=False)
    op.create_foreign_key('fk_training_records_practice_id', 'training_records', 'practices', ['practice_id'], ['id'])

    # Cases: add updated_at
    op.add_column('cases', sa.Column('updated_at', sa.DateTime(), nullable=True))
    op.execute("UPDATE cases SET updated_at = created_at WHERE updated_at IS NULL")
    op.alter_column('cases', 'updated_at', nullable=False)

    # Grades: add academic_year
    op.add_column('grades', sa.Column('academic_year', sa.String(length=9), nullable=True))

    # Messages: add role index
    op.create_index('ix_msg_role', 'messages', ['role'], unique=False)

    # Roles: drop leftover id_new
    op.execute("ALTER TABLE roles DROP COLUMN IF EXISTS id_new")

    # Scores: migrate review data to score_reviews, then drop old columns
    op.execute("""
        INSERT INTO score_reviews (score_id, reviewed_by, detail_scores, comment, created_at)
        SELECT id, reviewed_by, review_detail_scores, review_comment, reviewed_at
        FROM scores
        WHERE review_status IS NOT NULL
          AND reviewed_at IS NOT NULL
    """)
    op.drop_column('scores', 'reviewed_by')
    op.drop_column('scores', 'review_status')
    op.drop_column('scores', 'reviewed_at')
    op.drop_column('scores', 'review_comment')
    op.drop_column('scores', 'review_detail_scores')

    # UserClass: change from composite PK to auto-increment id PK
    op.execute("ALTER TABLE user_class DROP CONSTRAINT IF EXISTS user_class_pkey")
    op.execute("CREATE SEQUENCE IF NOT EXISTS user_class_id_seq")
    op.add_column('user_class', sa.Column('id', sa.Integer(), server_default=sa.text("nextval('user_class_id_seq')"), nullable=True))
    op.execute("UPDATE user_class SET id = nextval('user_class_id_seq') WHERE id IS NULL")
    op.alter_column('user_class', 'id', nullable=False)
    op.create_primary_key('user_class_pkey', 'user_class', ['id'])

    # Users: add new columns + indexes
    op.add_column('users', sa.Column('email', sa.String(length=120), nullable=True))
    op.add_column('users', sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False))
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('updated_at', sa.DateTime(), nullable=True))
    op.execute("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL")
    op.alter_column('users', 'updated_at', nullable=False)
    op.create_index('ix_users_school_id', 'users', ['school_id'], unique=False)
    op.create_index('ix_users_student_id', 'users', ['student_id'], unique=False)

    # ── Phase 2: CHECK constraints ──
    op.create_check_constraint(
        'ck_training_records_status',
        'training_records',
        "status IN ('in_progress', 'completed', 'abandoned')",
    )
    op.create_check_constraint(
        'ck_training_records_scoring_status',
        'training_records',
        "scoring_status IN ('pending', 'processing', 'completed', 'failed')",
    )
    op.create_check_constraint(
        'ck_training_records_current_phase',
        'training_records',
        "current_phase IN ('history_taking', 'physical_exam', 'ending')",
    )
    op.create_check_constraint(
        'ck_messages_role',
        'messages',
        "role IN ('student', 'patient', 'system')",
    )

    # ── Phase 3: Seed Practice data from session config JSONs ──
    import json
    from pathlib import Path

    config_dir = Path(__file__).resolve().parents[3] / "data" / "session_configs"
    if config_dir.exists():
        for fpath in sorted(config_dir.glob("*.json")):
            config = json.loads(fpath.read_text(encoding="utf-8"))
            case_id = op.get_bind().execute(
                sa.text("SELECT id FROM cases ORDER BY id LIMIT 1")
            ).scalar()
            op.execute(
                sa.text(
                    "INSERT INTO practices (name, description, case_id, mode, features, behavior, assessment, created_at, updated_at) "
                    "VALUES (:name, :desc, :case_id, :mode, :features, :behavior, :assessment, now(), now())"
                ).bindparams(
                    name=config.get("name", config["id"]),
                    desc=None,
                    case_id=case_id or 1,
                    mode=config.get("mode", "training"),
                    features=json.dumps(config.get("features", {})),
                    behavior=json.dumps(config.get("behavior", {})),
                    assessment=json.dumps(config.get("assessment")) if config.get("assessment") else None,
                )
            )

    # ── Phase 4: Migrate existing Assignment data ──
    # Map old config_id → new practice_id by name matching
    op.execute(
        sa.text(
            """
            UPDATE assignments a SET practice_id = (
                SELECT p.id FROM practices p
                WHERE p.name = a.title
                   OR p.name = 'standard-assessment'
                LIMIT 1
            )
            WHERE a.practice_id IS NULL
            """
        )
    )
    # Fallback: any remaining NULL → pick first practice
    op.execute(
        sa.text(
            "UPDATE assignments SET practice_id = (SELECT id FROM practices ORDER BY id LIMIT 1) "
            "WHERE practice_id IS NULL"
        )
    )
    op.alter_column('assignments', 'practice_id', nullable=False)

    # Migrate TrainingRecord: config_id → practice_id
    op.execute(
        sa.text(
            """
            UPDATE training_records tr SET practice_id = (
                SELECT p.id FROM practices p LIMIT 1
            )
            WHERE tr.practice_id IS NULL
            """
        )
    )

    # ── Phase 5: Drop deprecated columns ──
    op.drop_constraint('assignments_case_id_fkey', 'assignments', type_='foreignkey')
    op.drop_index(op.f('ix_assignments_case'), table_name='assignments')
    op.drop_column('assignments', 'feature_overrides')
    op.drop_column('assignments', 'config_id')
    op.drop_column('assignments', 'case_id')
    op.drop_column('training_records', 'config_snapshot')
    op.drop_column('training_records', 'config_id')


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index('ix_users_student_id', table_name='users')
    op.drop_index('ix_users_school_id', table_name='users')
    op.drop_column('users', 'updated_at')
    op.drop_column('users', 'last_login_at')
    op.drop_column('users', 'is_active')
    op.drop_column('users', 'email')
    op.drop_column('user_class', 'id')
    op.add_column('training_records', sa.Column('config_id', sa.VARCHAR(length=40), autoincrement=False, nullable=True))
    op.add_column('training_records', sa.Column('config_snapshot', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True))
    op.drop_constraint('fk_training_records_practice_id', 'training_records', type_='foreignkey')
    op.drop_index('ix_tr_practice_id', table_name='training_records')
    op.drop_column('training_records', 'practice_snapshot')
    op.drop_column('training_records', 'practice_id')
    op.add_column('scores', sa.Column('review_detail_scores', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=True))
    op.add_column('scores', sa.Column('review_comment', sa.TEXT(), autoincrement=False, nullable=True))
    op.add_column('scores', sa.Column('reviewed_at', postgresql.TIMESTAMP(), autoincrement=False, nullable=True))
    op.add_column('scores', sa.Column('review_status', sa.VARCHAR(length=20), autoincrement=False, nullable=True))
    op.add_column('scores', sa.Column('reviewed_by', sa.INTEGER(), autoincrement=False, nullable=True))
    op.add_column('roles', sa.Column('id_new', sa.INTEGER(), autoincrement=False, nullable=True))
    op.drop_index('ix_msg_role', table_name='messages')
    op.drop_column('grades', 'academic_year')
    op.drop_column('cases', 'updated_at')
    op.add_column('assignments', sa.Column('case_id', sa.INTEGER(), autoincrement=False, nullable=False))
    op.add_column('assignments', sa.Column('config_id', sa.VARCHAR(length=50), autoincrement=False, nullable=False))
    op.add_column('assignments', sa.Column('feature_overrides', postgresql.JSONB(astext_type=sa.Text()), autoincrement=False, nullable=False))
    op.drop_constraint(None, 'assignments', type_='foreignkey')
    op.create_foreign_key(op.f('assignments_case_id_fkey'), 'assignments', 'cases', ['case_id'], ['id'], ondelete='RESTRICT')
    op.drop_index('ix_assignments_practice', table_name='assignments')
    op.create_index(op.f('ix_assignments_case'), 'assignments', ['case_id'], unique=False)
    op.drop_column('assignments', 'practice_id')
    op.drop_index('ix_score_reviews_score_id', table_name='score_reviews')
    op.drop_table('score_reviews')
    op.drop_index('ix_practices_school_id', table_name='practices')
    op.drop_index('ix_practices_case_id', table_name='practices')
    op.drop_table('practices')
    # ### end Alembic commands ###
