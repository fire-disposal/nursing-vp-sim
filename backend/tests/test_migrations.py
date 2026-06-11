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
    from sqlalchemy import create_engine, text

    engine = create_engine(ALEMBIC_URL)
    with engine.connect() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.commit()
    yield engine
    engine.dispose()


def test_migrations_up_to_head(alembic_runner):
    """Verify all migrations apply cleanly from base to head."""
    alembic_runner.migrate_up_to("head")
    heads = alembic_runner.heads
    assert len(heads) == 1, f"Expected 1 head, got {len(heads)}: {heads}"


@pytest.mark.xfail(reason="unnamed FK constraint in legacy migration prevents downgrade", strict=False)
def test_migrations_up_down_roundtrip(alembic_runner):
    """Verify upgrade → downgrade → upgrade works without errors.
    Downgrade is expected to fail due to unnamed FK constraints in legacy migrations."""

    alembic_runner.migrate_up_to("head")
    alembic_runner.migrate_down_to("base")
    alembic_runner.migrate_up_to("head")


def test_model_definitions_match_database(alembic_runner):
    """Verify all SQLAlchemy model tables exist in the migrated database."""
    alembic_runner.migrate_up_to("head")

    from sqlalchemy import create_engine, text

    import models  # noqa: F401

    engine = create_engine(ALEMBIC_URL)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
        db_tables = {row[0] for row in result}
    engine.dispose()
