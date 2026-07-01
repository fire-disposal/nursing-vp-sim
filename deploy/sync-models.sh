#!/bin/bash
# Sync local GLB models to the server.
#
# Usage:
#   deploy/sync-models.sh              # dry-run (preview)
#   deploy/sync-models.sh --apply      # actually upload
#
# Mirrors assets/models/ to yecaoyun:/opt/nursing-vp-sim/models/
# Only transfers changed files (rsync incremental).

set -euo pipefail

LOCAL="$(dirname "$0")/../assets/models"
REMOTE="yecaoyun:/opt/nursing-vp-sim/models"
FLAGS="-avz --progress"

if [[ "${1:-}" != "--apply" ]]; then
  echo "  Dry-run — add --apply to actually upload"
  FLAGS="$FLAGS --dry-run"
fi

if [[ ! -d "$LOCAL" ]]; then
  echo "  Local models directory not found: $LOCAL"
  exit 1
fi

echo "  Syncing $LOCAL → $REMOTE"
rsync $FLAGS --include="*.glb" --include="*.gltf" --include="furniture-registry.json" --exclude="*" "$LOCAL"/ "$REMOTE"/

if [[ "${1:-}" != "--apply" ]]; then
  echo ""
  echo "  Run with --apply to upload for real"
fi
