#!/usr/bin/env bash
# push-retry.sh — 带指数退避重试的 git push 包装
# 用法: bash scripts/push-retry.sh [remote] [branch]

set -e

REMOTE="${1:-origin}"
BRANCH="${2:-master}"
MAX_RETRIES=5
RETRY_DELAY=10

for attempt in $(seq 1 $MAX_RETRIES); do
    echo "[attempt $attempt/$MAX_RETRIES] pushing $BRANCH to $REMOTE..."

    if git push "$REMOTE" "$BRANCH" 2>&1; then
        echo "  ✅ push succeeded"
        exit 0
    fi

    if [ "$attempt" = "$MAX_RETRIES" ]; then
        echo "  ❌ push failed after $MAX_RETRIES attempts"
        exit 1
    fi

    DELAY=$((RETRY_DELAY * 2 ** (attempt - 1)))
    echo "  ⚠ push failed, retrying in ${DELAY}s..."
    sleep "$DELAY"
done
