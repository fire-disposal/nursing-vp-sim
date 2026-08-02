#!/usr/bin/env bash
# Stability-aware image pruning for nursing-vp-sim.
#
# Rapid-fire deploys (prototype workflow) pile up transitional images that
# were superseded within hours and never truly served. Instead of a fixed
# time window, treat *runtime* as the stability signal:
#
#   keep  - versions whose container has been running >= STABLE_HOURS
#           (recorded in .stable-versions so the marker survives container
#           swaps — a version that ran a full day is deliberately kept)
#         - images referenced by any *running* container (never prune in use)
#         - the most recent KEEP_RECENT deployed versions per environment
#           (rollback buffer, read from .version-history-{prod,staging})
#   drop  - everything else (transitional versions)
#
# Only touches ghcr.io/fire-disposal/nursing-vp-sim-* images. Non-fatal:
# every prune step tolerates failure (worst case leaves garbage, never
# deletes the wrong thing).
#
# Usage:
#   bash deploy/prune-images.sh            # prune
#   bash deploy/prune-images.sh --dry-run  # show what would be pruned
#
# Exit codes: 0 = ok, 1 = usage error. Prune failures are logged, not fatal.
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# ── 路径自推导（与 db-backup.sh 同约定，不依赖调用方 cwd）──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

STABLE_HOURS="${STABLE_HOURS:-24}"   # 运行满此小时数 → 判定稳定
KEEP_RECENT="${KEEP_RECENT:-2}"      # 每环境保留最近 N 个部署版本（回滚缓冲）
KEEP_STABLE_MAX="${KEEP_STABLE_MAX:-3}"  # 稳定版标记上限，超出淘汰最旧（ghcr 兜底）
REGISTRY_PREFIX="ghcr.io/fire-disposal/nursing-vp-sim"
STABLE_FILE="${DEPLOY_DIR}/.stable-versions"

NOW_EPOCH=$(date +%s)
THRESHOLD_EPOCH=$((NOW_EPOCH - STABLE_HOURS * 3600))

# ── 1) mark long-running versions as stable ──────────────────────────────
touch "$STABLE_FILE"
MARKED=0
for c in $(docker ps --format '{{.ID}}'); do
    img=$(docker inspect --format '{{.Config.Image}}' "$c" 2>/dev/null || true)
    case "$img" in
        "${REGISTRY_PREFIX}-"*)
            started=$(docker inspect --format '{{.State.StartedAt}}' "$c" 2>/dev/null || echo "")
            started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)
            if (( started_epoch > 0 && started_epoch <= THRESHOLD_EPOCH )); then
                tag="${img##*:}"
                if ! grep -qxF "$tag" "$STABLE_FILE"; then
                    echo "$tag" >> "$STABLE_FILE"
                    MARKED=$((MARKED + 1))
                    echo "  stable+: ${tag} (up $(( (NOW_EPOCH - started_epoch) / 3600 ))h)"
                fi
            fi
            ;;
    esac
done
[[ $MARKED -gt 0 ]] || echo "  (no newly stable versions)"

# cap the stable list: keep the most recent KEEP_STABLE_MAX markers (append
# order = time order); older markers drop out so the disk stays bounded —
# ghcr still holds those images for rollback.
tail -n "$KEEP_STABLE_MAX" "$STABLE_FILE" > "$STABLE_FILE.tmp" && mv "$STABLE_FILE.tmp" "$STABLE_FILE"

# ── 2) build the keep set: one exact tag per line ────────────────────────
KEEP_TAGS=$(
    {
        # stable markers
        sed '/^$/d' "$STABLE_FILE"
        # images in use by running containers
        docker ps --format '{{.Image}}' | grep "^${REGISTRY_PREFIX}-" | awk -F: '{print $NF}'
        # most recent deployed versions per environment (rollback buffer)
        for hist in "${DEPLOY_DIR}"/.version-history-*; do
            [[ -f "$hist" ]] && tail -n "$KEEP_RECENT" "$hist" | cut -d'|' -f1
        done
    } | sort -u
)

# ── 3) prune nursing images whose tag is not in the keep set ─────────────
KEEP_FILE=$(mktemp)
trap 'rm -f "$KEEP_FILE"' EXIT
printf '%s\n' "$KEEP_TAGS" > "$KEEP_FILE"

TO_DELETE=$(
    docker images --filter "reference=${REGISTRY_PREFIX}-*" --format '{{.Repository}}:{{.Tag}}' \
        | awk -F: '{print $NF}' \
        | grep -vxF -f "$KEEP_FILE" || true
)

if [[ -z "$TO_DELETE" ]]; then
    echo ">> Nothing to prune (keeping $(echo "$KEEP_TAGS" | wc -l) tag(s))"
    exit 0
fi

COUNT=$(echo "$TO_DELETE" | wc -l)
echo ">> Pruning ${COUNT} transitional image(s), keeping: $(echo "$KEEP_TAGS" | tr '\n' ' ')"
if [[ $DRY_RUN -eq 1 ]]; then
    echo ">> DRY RUN — not deleting"
    exit 0
fi

DELETED=0
for tag in $TO_DELETE; do
    for side in backend frontend; do
        if docker rmi "${REGISTRY_PREFIX}-${side}:${tag}" >/dev/null 2>&1; then
            DELETED=$((DELETED + 1))
        fi
    done
done
echo ">> Deleted ${DELETED} image(s)"
