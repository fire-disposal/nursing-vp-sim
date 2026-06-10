"""Migration integration tests — run via pytest-alembic against real PostgreSQL.

Requires: TEST_DB_URL env var or local PostgreSQL.
Mark: pytest -m pg
"""
import os

import pytest

pytestmark = pytest.mark.pg

os.environ.setdefault("SECRET_KEY", "test-migration-key")
os.environ.pop("SKIP_MIGRATION", None)

TEST_DB_URL = os.environ.get("TEST_DB_URL", "postgresql://postgres:postgres@localhost:5432/nursing_test")
ALEMBIC_URL = TEST_DB_URL.replace("postgresql://", "postgresql+psycopg://", 1)


@pytest.fixture(scope="session")
def alembic_config():
    return {"file": "alembic.ini", "script_location": "migrations"}


@pytest.fixture(scope="session")
def alembic_engine():
    from sqlalchemy import create_engine
    engine = create_engine(ALEMBIC_URL)
    with engine.connect() as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        conn.commit()
    yield engine
    engine.dispose()


def test_migrations_up_to_head(alembic_runner):
    """Verify all migrations apply cleanly from base to head."""
    alembic_runner.migrate_up_to("head")
    heads = alembic_runner.heads
    assert len(heads) == 1, f"Expected 1 head, got {len(heads)}: {heads}"


def test_migrations_up_down_roundtrip(alembic_runner):
    """Verify upgrade → downgrade → upgrade works without errors."""
    alembic_runner.migrate_up_to("head")
    alembic_runner.migrate_down_to("base")
    alembic_runner.migrate_up_to("head")


def test_model_definitions_match_database(alembic_runner):
    """Verify SQLAlchemy model definitions match the migrated database schema."""
    alembic_runner.migrate_up_to("head")
    try:
        alembic_runner.assert_model_definitions_match_database("models")
    except ImportError:
        from core.database import Base
        alembic_runner.assert_model_definitions_match_database(Base.metadata)
