"""Startup schema verification: production verifies the head, never migrates."""

from contextlib import contextmanager

import alembic.command
import alembic.script
import pytest
from sqlalchemy.exc import OperationalError

from core import database
from core.database import SchemaNotReadyError, verify_schema


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _Conn:
    def __init__(self, value=None, error=None):
        self._value = value
        self._error = error

    def execute(self, *args, **kwargs):
        if self._error is not None:
            raise self._error
        return _Result(self._value)


class _Engine:
    """Minimal stand-in for the SQLAlchemy engine used by ``verify_schema``."""

    def __init__(self, value=None, error=None):
        self._value = value
        self._error = error

    @contextmanager
    def connect(self):
        yield _Conn(self._value, self._error)


@pytest.fixture
def production_env(monkeypatch):
    """Force the production path (conftest sets TESTING=1 for the whole session)."""
    monkeypatch.delenv("TESTING", raising=False)
    return monkeypatch


def test_passes_when_db_at_expected_head(production_env):
    production_env.setattr(database, "engine", _Engine("head1"))
    production_env.setattr(alembic.script.ScriptDirectory, "get_heads", lambda self: ["head1"])
    # The production path must never touch alembic.command.upgrade (regression guard).
    production_env.setattr(
        alembic.command, "upgrade", lambda *a, **k: pytest.fail("startup must not run alembic upgrade")
    )

    verify_schema()


def test_rejects_stale_schema(production_env):
    production_env.setattr(database, "engine", _Engine("oldrev"))
    production_env.setattr(alembic.script.ScriptDirectory, "get_heads", lambda self: ["head1"])

    with pytest.raises(SchemaNotReadyError) as exc:
        verify_schema()

    message = str(exc.value)
    assert "oldrev" in message
    assert "head1" in message
    assert "alembic upgrade head" in message


def test_rejects_missing_schema(production_env):
    production_env.setattr(
        database,
        "engine",
        _Engine(error=OperationalError("SELECT 1", {}, Exception("relation does not exist"))),
    )
    production_env.setattr(alembic.script.ScriptDirectory, "get_heads", lambda self: ["head1"])

    with pytest.raises(SchemaNotReadyError) as exc:
        verify_schema()

    assert "alembic upgrade head" in str(exc.value)


def test_rejects_multiple_heads(production_env):
    production_env.setattr(database, "engine", _Engine(error=AssertionError("must not connect when heads diverge")))
    production_env.setattr(alembic.script.ScriptDirectory, "get_heads", lambda self: ["a", "b"])

    with pytest.raises(SchemaNotReadyError) as exc:
        verify_schema()

    assert "2 个 head" in str(exc.value)


def test_testing_mode_uses_create_all(monkeypatch):
    """TESTING=1 is the only create_all escape hatch (test-only)."""
    calls = []
    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setattr(database, "engine", _Engine(error=AssertionError("must not query the DB")))
    monkeypatch.setattr(database.Base.metadata, "create_all", lambda *a, **k: calls.append(k))

    verify_schema()

    assert len(calls) == 1
