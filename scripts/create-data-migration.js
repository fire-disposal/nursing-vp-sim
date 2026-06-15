/**
 * Scaffold a data-only migration file.
 *
 * Usage:
 *   node scripts/create-data-migration.mjs "seed_practices"
 *   node scripts/create-data-migration.mjs "migrate_scores_to_reviews"
 */
const { execSync } = require("node:child_process");
const { writeFileSync, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const desc = process.argv[2];
if (!desc) {
  console.error("Usage: node scripts/create-data-migration.mjs <description>");
  console.error("Example: node scripts/create-data-migration.mjs seed_practices");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const VERSIONS = path.join(BACKEND, "migrations", "versions");

if (!existsSync(VERSIONS)) {
  console.error("Versions directory not found:", VERSIONS);
  process.exit(1);
}

// Get current alembic head
const headOutput = execSync(
  `cd "${BACKEND}" && uv run python -m alembic heads`,
  { encoding: "utf-8" },
).trim();
const head = headOutput.split(" ")[0];
if (!head) {
  console.error("Could not determine current alembic head.");
  process.exit(1);
}

// Generate revision ID (short timestamp + random)
const ts = Date.now().toString(36);
const suffix = Math.random().toString(36).slice(2, 6);
const revId = `${ts}${suffix}`;

// Build file name
const filename = `${revId}_${desc}.py`;
const filepath = path.join(VERSIONS, filename);

// Build file content
const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const content = `"""${desc}

# Manual override reason: data_only

Revision ID: ${revId}
Revises: ${head}
Create Date: ${now}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '${revId}'
down_revision: Union[str, Sequence[str], None] = '${head}'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
`;

writeFileSync(filepath, content, "utf-8");
console.log(`Created: backend/migrations/versions/${filename}`);
console.log(`  Down revision: ${head}`);
console.log();
console.log("Next steps:");
console.log("  1. Edit upgrade() — add your INSERT/UPDATE/seed operations");
console.log("  2. Run: pnpm run db:migrate");
