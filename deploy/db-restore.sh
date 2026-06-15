#!/usr/bin/env bash
# ==============================================================
#  db-restore.sh — 数据库恢复
#
#  用法:
#    ./db-restore.sh <备份文件路径>                # 交互恢复
#    ./db-restore.sh <备份文件路径> --yes          # 非交互恢复 (AI 调用)
#    ./db-restore.sh [staging|prod] list           # 列出可用备份
#
#  安全机制:
#    1. 恢复前自动创建急救快照 (emergency_*.sql.gz)
#    2. 交互模式需要确认 (--yes 跳过)
#    3. 检查备份文件完整性 (gzip -t)
#    4. 恢复完成后验证 (SELECT 1)
#
#  退出码:
#    0 = 成功
#    1 = 参数/环境错误
#    2 = 备份文件损坏
#    3 = 恢复失败
# ==============================================================
set -euo pipefail

BACKUP_FILE="${1:-}"
AUTO_YES="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 如果传的是 list 命令 ──
if [ "$1" = "list" ]; then
  ENV="${2:-prod}"
  exec "${SCRIPT_DIR}/db-backup.sh" "$ENV" list
fi

# ── 参数校验 ──
if [ -z "$BACKUP_FILE" ]; then
  echo "[ERR] 缺少备份文件路径"
  echo "  用法: ./db-restore.sh <备份文件> [--yes]"
  echo "        ./db-restore.sh [staging|prod] list"
  exit 1
fi

# 从文件名推断环境
case "$(basename "$BACKUP_FILE")" in
  staging_*) ENV="staging" ;;
  prod_*)    ENV="prod" ;;
  *)
    echo "[ERR] 无法从文件名推断环境 (文件名须以 staging_ 或 prod_ 开头)"
    exit 1
    ;;
esac

case "$ENV" in
  staging) CONTAINER="nursing-db-staging"; COMPOSE_FILE="docker-compose.staging.yml" ;;
  prod)    CONTAINER="nursing-db";        COMPOSE_FILE="docker-compose.prod.yml" ;;
esac

BACKUP_DIR="$(cd "$(dirname "$BACKUP_FILE")" 2>/dev/null && pwd || echo "")"
BACKUP_BASENAME="$(basename "$BACKUP_FILE")"

# ── 文件存在性 + 完整性检查 ──
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[ERR] 备份文件不存在: ${BACKUP_FILE}"
  exit 1
fi

echo "[..] 校验备份文件完整性 ..."
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "[ERR] 备份文件损坏 (gzip 校验失败): ${BACKUP_FILE}"
  exit 2
fi
echo "[OK] 文件完整性校验通过 ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 确认 ──
if [ "${AUTO_YES}" != "--yes" ]; then
  echo ""
  echo "  ⚠  即将恢复 ${ENV} 数据库"
  echo "     源文件: ${BACKUP_FILE}"
  echo ""
  read -r -p "  确认恢复? 现有数据将被覆盖 (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "[..] 已取消"
    exit 0
  fi
fi

echo ""

# ── 第 1 步: 创建急救快照 ──
EMERGENCY_FILE="${BACKUP_DIR}/emergency_${ENV}_$(date +%Y%m%d_%H%M%S).sql.gz"
echo "[..] 创建急救快照 (恢复前的数据) ..."
if docker exec "$CONTAINER" pg_dump -U nursing -d nursing_vp --no-owner 2>/dev/null | gzip > "$EMERGENCY_FILE"; then
  echo "[OK] 急救快照已保存: ${EMERGENCY_FILE} ($(du -h "$EMERGENCY_FILE" | cut -f1))"
else
  echo "[WARN] 急救快照创建失败, 继续恢复"
  rm -f "$EMERGENCY_FILE"
fi

# ── 第 2 步: 恢复 ──
echo "[..] 正在恢复数据库 ..."
# 清空现有数据: 删除所有表 (不删除数据库本身)
docker exec -i "$CONTAINER" psql -U nursing -d nursing_vp -c "
  DO \$\$ DECLARE r RECORD; BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END \$\$;
" >/dev/null 2>&1

# 导入备份
if gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U nursing -d nursing_vp 2>&1; then
  echo "[OK] 数据导入完成"
else
  echo "[ERR] 数据导入失败"
  echo "[..] 如需回退, 可使用: ./db-restore.sh ${EMERGENCY_FILE} --yes"
  exit 3
fi

# ── 第 3 步: 验证 ──
echo "[..] 验证恢复结果 ..."
if docker exec "$CONTAINER" psql -U nursing -d nursing_vp -c "SELECT 1 AS ok" 2>/dev/null | grep -q "1"; then
  echo "[OK] 数据库恢复验证通过"
else
  echo "[WARN] 数据库响应异常, 请手动检查"
fi

echo ""
echo "[OK] 恢复完成"
echo "     如果发现问题, 可运行: ./db-restore.sh ${EMERGENCY_FILE} --yes"
