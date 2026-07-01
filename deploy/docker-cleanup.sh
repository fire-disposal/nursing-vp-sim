#!/bin/bash
# Docker image cleanup — staging keep 2, production keep 5.
# Run nightly via crontab to prevent disk from filling with stale images.
# Cron: 0 3 * * * /opt/nursing-vp-sim/deploy/docker-cleanup.sh

set -euo pipefail
LOG="/opt/nursing-vp-sim/deploy/docker-cleanup.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting docker cleanup..." >> "$LOG"

# Remove dangling images
docker image prune -f >> "$LOG" 2>&1

# Per-repo: keep N latest tags
docker images --format '{{.Repository}}' | sort -u | while read repo; do
  [[ "$repo" == "<none>" ]] && continue

  case "$repo" in
    *staging*) KEEP=2 ;;   # staging images: keep 2 newest
    *prod*|*production*) KEEP=5 ;;  # production: keep 5 for rollback
    *) KEEP=3 ;;
  esac

  COUNT=$(docker images "$repo" --format '{{.Tag}}' | wc -l)
  [[ "$COUNT" -le "$KEEP" ]] && continue

  docker images "$repo" --format '{{.CreatedAt}} {{.ID}}' | sort \
    | head -n -$((COUNT - KEEP)) \
    | awk '{print $NF}' \
    | while read id; do
        echo "  Remove $repo:$id" >> "$LOG"
        docker rmi "$id" 2>/dev/null || true
      done
done

echo "  Done" >> "$LOG"
