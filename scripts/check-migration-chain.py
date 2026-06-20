"""Validate migration chain integrity: single head + all down_revisions resolve."""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from alembic.config import Config
from alembic.script import Script, ScriptDirectory

alembic_ini = BACKEND / "alembic.ini"
if not alembic_ini.exists():
    print("SKIP: alembic.ini not found")
    sys.exit(0)

cfg = Config(alembic_ini)
script = ScriptDirectory.from_config(cfg)

heads = script.get_heads()
if len(heads) > 1:
    print(f"FAIL: {len(heads)} heads found: {heads}")
    print("  Fix: alembic merge heads")
    sys.exit(1)
print(f"ok  single head: {heads[0]}")

for rev_id, rev in script.revision_map._revision_map.items():
    if not isinstance(rev, Script):
        continue
    down_revs = [rev.down_revision] if isinstance(rev.down_revision, str) else (rev.down_revision or [])
    for down in down_revs:
        if down and down not in script.revision_map._revision_map:
            print(f"FAIL: {rev_id} references missing down_revision {down}")
            sys.exit(1)
print("ok  all down_revisions resolve")

db_url = os.environ.get("DATABASE_URL", "")
if not db_url:
    db_url = "postgresql+psycopg://postgres:postgres@localhost:5432/vptest"
else:
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

try:
    from sqlalchemy import create_engine, text

    engine = create_engine(db_url, connect_args={"connect_timeout": 3})
    with engine.connect() as conn:
        db_rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    if db_rev not in script.revision_map._revision_map:
        print(f"WARN: DB is at {db_rev} which is NOT in current migration chain")
        print(f"  Head: {heads[0]}")
        print(f"  If this is intentional (switched branches), stamp the DB:")
        print(f"    alembic stamp {heads[0]}")
    else:
        print(f"ok  DB revision {db_rev} exists in chain")
except Exception as e:
    print(f"SKIP: cannot check DB revision ({e})")

sys.exit(0)
