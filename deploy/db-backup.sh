#!/usr/bin/env bash
# ==============================================================
#  db-backup.sh — 数据库全量备份（pg_dump）
#
#  用法:
#    ./db-backup.sh [staging|prod]              # 创建备份
#    ./db-backup.sh [staging|prod] list          # 列出可用备份
#    ./db-backup.sh [staging|prod] prune         # 手动清理过期
#
#  退出码:
#    0 = 成功
#    1 = 参数/环境错误
#    2 = 备份失败
#
#  AI 友好:
#    - 非交互式, 结构化的备份记录文件便于解析
#    - 退出码明确, 输出前缀 [OK] [ERR] 等
# ==============================================================
set -euo pipefail

ENV="${1:-prod}"
ACTION="${2:-backup}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_BASE="${DEPLOY_DIR}/backups/${ENV}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="${ENV}_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_BASE}/${FILENAME}"
HISTORY_FILE="${BACKUP_BASE}/.backup-history"
RETENTION_DAYS=30
DOCKER_COMPOSE="docker compose -f ${SCRIPT_DIR}/docker-compose.${ENV}.yml --env-file ${DEPLOY_DIR}/.env"

# ── 容器名映射 ──
case "$ENV" in
  staging) CONTAINER="nursing-db-staging" ;;
  prod)    CONTAINER="nursing-db" ;;
  *)
    echo "[ERR] 环境必须是 staging 或 prod"
    echo "  用法: ./db-backup.sh [staging|prod] [backup|list|prune]"
    exit 1
    ;;
esac

mkdir -p "$BACKUP_BASE"

# ── 子命令: 列出备份 ──
list_backups() {
  echo ""
  echo "  ${ENV} 环境备份列表 (${BACKUP_BASE}):"
  echo "  ┌───────────────────────────────────────────────┐"
  if [ -f "$HISTORY_FILE" ]; then
    while IFS='|' read -r ts size version status; do
      local_mark=""
      [ "$status" = "success" ] && local_mark="✓" || local_mark="✗"
      printf "  │ ${local_mark}  %s  %8s  %-20s  %s\n" "$ts" "$size" "$version" "$status"
    done < "$HISTORY_FILE"
  fi
  local count
  count=$(find "$BACKUP_BASE" -name "${ENV}_*.sql.gz" 2>/dev/null | wc -l)
  echo "  │"
  printf "  │  共 %d 个备份文件, 保留 %d 天\n" "$count" "$RETENTION_DAYS"
  echo "  └───────────────────────────────────────────────┘"
  echo ""
}

# ── 子命令: 清理过期 ──
prune_backups() {
  local old before after
  before=$(find "$BACKUP_BASE" -name "${ENV}_*.sql.gz" 2>/dev/null | wc -l)
  find "$BACKUP_BASE" -name "${ENV}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
  after=$(find "$BACKUP_BASE" -name "${ENV}_*.sql.gz" 2>/dev/null | wc -l)
  local removed=$((before - after))
  echo "[OK] 清理完成: 移除 $removed 个过期备份 (保留 $RETENTION_DAYS 天)"
  # 同步清理 history 文件
  if [ -f "$HISTORY_FILE" ]; then
    local cutoff
    cutoff=$(date -d "-${RETENTION_DAYS} days" +%Y%m%d_%H%M%S 2>/dev/null || echo "")
    [ -n "$cutoff" ] && awk -F'|' "\$1 >= \"$cutoff\"" "$HISTORY_FILE" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
  fi
}

# ── 子命令: 备份 ──
do_backup() {
  # 验证容器在运行
  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "[ERR] 容器 $CONTAINER 未运行"
    exit 1
  fi

  echo "[..] 正在备份 ${ENV} 数据库 ..."

  # 读取当前部署版本（如果存在）
  local version="unknown"
  if [ -f "${DEPLOY_DIR}/.version-history" ]; then
    version=$(tail -1 "${DEPLOY_DIR}/.version-history" | cut -d'|' -f1)
  fi

  # pg_dump + gzip
  local size=0
  if docker exec "$CONTAINER" pg_dump -U nursing -d nursing_vp --no-owner 2>/dev/null | gzip > "$BACKUP_PATH"; then
    size=$(du -h "$BACKUP_PATH" | cut -f1)
    local status="success"
    echo "[OK] 备份完成: ${BACKUP_PATH} (${size})"

    # 写入 history（AI 可解析的结构化记录）
    echo "${TIMESTAMP}|${size}|${version}|${status}" >> "$HISTORY_FILE"
    tail -100 "$HISTORY_FILE" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
  else
    local status="failed"
    echo "${TIMESTAMP}|-|${version}|${status}" >> "$HISTORY_FILE"
    echo "[ERR] 备份失败: ${ENV} $(date +%Y-%m-%d\ %H:%M:%S)"
    rm -f "$BACKUP_PATH"
    exit 2
  fi

  # 自动清理过期
  prune_backups
}

# ── 入口 ──
case "$ACTION" in
  backup) do_backup ;;
  list)   list_backups ;;
  prune)  prune_backups ;;
  *)
    echo "[ERR] 未知操作: ${ACTION}"
    echo "  可用操作: backup, list, prune"
    exit 1
    ;;
esac
