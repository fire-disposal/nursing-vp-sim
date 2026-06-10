# AGENTS.md — Project Conventions

## Migration Rules (alembic)

**Always use `--autogenerate`**, never hand-write migration files:

```bash
cd backend
alembic revision --autogenerate -m "describe_your_change"
```

This ensures:
- `down_revision` is always set to the current head (prevents branching)
- `upgrade()` and `downgrade()` are auto-generated from model diff
- No manual `depends_on` / `revision` strings

**Exception**: merge migrations (fixing branches) and data-only migrations may be hand-written after
review. If `--autogenerate` produces an empty migration, do not commit it.

## Testing

```bash
# Full test suite (requires local PostgreSQL)
cd backend && pytest -m pg

# Unit tests only (no DB required)
cd backend && pytest -m "not pg"
```

## Pre-commit Checks

All commits must pass:
- `ruff check` / `ruff format` (backend)
- `biome check --write` (frontend)
- `tsc --noEmit` (frontend)

## Commit Format

<emoji> <type>: <description>

Types: feat, fix, refactor, ci, test, style, chore, perf, security, db, docs, remove
