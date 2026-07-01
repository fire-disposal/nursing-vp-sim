#!/bin/bash
# Sync calibrated GLB models to the server.
#
# Only uploads models that have entries in furniture-registry.json.
# Unregistered .glb files are ignored — calibration must happen first.
#
# Usage:
#   deploy/sync-models.sh              # dry-run
#   deploy/sync-models.sh --apply      # upload

set -euo pipefail

ROOT="$(dirname "$0")/.."
LOCAL="$ROOT/assets/models"
REGISTRY="$LOCAL/furniture-registry.json"
REMOTE="yecaoyun:/opt/nursing-vp-sim/models"
FLAGS="-avz --progress"

if [[ ! -f "$REGISTRY" ]]; then
  echo "  Registry not found: $REGISTRY"
  exit 1
fi

# Collect GLB filenames referenced in the registry (enabled ones only)
FILES=()
while IFS= read -r glb; do
  [[ -n "$glb" ]] && FILES+=("$glb")
done < <(python3 -c "
import json, sys
data = json.load(open('$REGISTRY'))
for entry in data.values():
    if entry.get('enabled', False) and entry.get('glb'):
        sys.stdout.write(entry['glb'].lstrip('/') + '\n')
")

echo "  Syncing ${#FILES[@]} calibrated models + registry to server..."
rsync "${FLAGS}" "${INCLUDES[@]}" --include="furniture-registry.json" --exclude="*" "$LOCAL"/ "$REMOTE"/ 2>&1
echo "  Done"
