#!/bin/bash
# List all GLB/GLTF models on the server with sizes and calibration status.
# Usage: ssh yecaoyun "bash -s" < deploy/list-models.sh
# Or deploy to server and run: /opt/nursing-vp-sim/deploy/list-models.sh

MODELS_DIR="/opt/nursing-vp-sim/models"
REGISTRY="/opt/nursing-vp-sim/models/furniture-registry.json"

echo "=========================================="
echo "  Model Inventory — $(hostname)"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

if [[ ! -d "$MODELS_DIR" ]]; then
  echo "  Models directory not found: $MODELS_DIR"
  exit 1
fi

# Load registry for calibration lookup
declare -A CALIB
if [[ -f "$REGISTRY" ]]; then
  while IFS= read -r line; do
    key=$(echo "$line" | grep -oP '"[^"]+\.glb"' | head -1 | tr -d '"')
    [[ -n "$key" ]] && CALIB["$key"]="yes"
  done < <(grep -l '' "$REGISTRY" 2>/dev/null)
fi

TOTAL_FILES=0
TOTAL_SIZE=0

echo "  Location        Size       File"
echo "  ─────────────────────────────────────────────"

while IFS= read -r -d '' file; do
  name=$(basename "$file")
  dir=$(dirname "$file" | sed "s|$MODELS_DIR/||")
  size=$(stat --format="%s" "$file")
  human=$(numfmt --to=iec "$size")
  calib="${CALIB[$name]:+✅}"
  [[ -z "$calib" ]] && calib="  "
  printf "  %-15s %8s  %s %s\n" "$dir" "$human" "$name" "$calib"
  TOTAL_FILES=$((TOTAL_FILES + 1))
  TOTAL_SIZE=$((TOTAL_SIZE + size))
done < <(find "$MODELS_DIR" -type f \( -name "*.glb" -o -name "*.gltf" \) -print0)

echo ""
echo "  ─────────────────────────────────────────────"
printf "  %-15s %8s  %d files\n" "Total" "$(numfmt --to=iec "$TOTAL_SIZE")" "$TOTAL_FILES"
echo "  ✅ = calibration registered"
echo "=========================================="
