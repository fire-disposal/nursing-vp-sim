#!/bin/bash
# Staging 部署脚本
# 用法: ./deploy-staging.sh [start|stop|restart|logs]
#   不带参数 → pull latest + up -d
#   start     → 启动（不拉取）
#   stop      → 停止
#   restart   → 重启
#   logs      → 查看日志

set -e

COMPOSE_FILE="docker-compose.staging.yml"
PROJECT_NAME="nursing-vp-staging"
ACTION="${1:-deploy}"

cd "$(dirname "$0")/.."

case "$ACTION" in
  deploy|"")
    echo "=== Pulling latest staging images ==="
    docker pull ghcr.io/fire-disposal/nursing-vp-sim-backend:latest
    docker pull ghcr.io/fire-disposal/nursing-vp-sim-frontend:latest
    echo "=== Starting staging ==="
    docker compose -f "$COMPOSE_FILE" --env-file .env -p "$PROJECT_NAME" up -d --remove-orphans
    echo "=== Waiting for health check ==="
    for i in $(seq 1 30); do
      STATUS=$(docker inspect --format='{{.State.Health.Status}}' nursing-backend-staging 2>/dev/null || echo "unknown")
      if [ "$STATUS" = "healthy" ]; then
        echo "Staging ready ($((i * 2))s)"
        exit 0
      fi
      sleep 2
    done
    echo "Health check timeout - check logs: docker compose -f $COMPOSE_FILE -p $PROJECT_NAME logs"
    exit 1
    ;;
  start)
    docker compose -f "$COMPOSE_FILE" --env-file .env -p "$PROJECT_NAME" up -d
    ;;
  stop)
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down
    ;;
  restart)
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" restart
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs --tail 100 -f
    ;;
  *)
    echo "Usage: $0 [start|stop|restart|logs]"
    exit 1
    ;;
esac
