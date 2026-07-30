#!/usr/bin/env bash
# deploy-banner.sh — 测试部署警告横幅
# 用法: bash scripts/deploy-banner.sh [on|off]
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8000}"
TOKEN="${DEPLOY_WARNING_TOKEN:-test-token}"

case "${1:-on}" in
  on)
    echo "→ 激活部署警告横幅..."
    curl -s -X POST "$BASE/api/admin/deploy-warning?token=$TOKEN" \
      -G --data-urlencode "message=系统即将更新，预计 2 分钟，请保存当前进度。" | python3 -m json.tool
    echo ""
    echo "✓ 横幅已激活。打开 http://localhost:3000 查看。"
    echo "  运行 'bash scripts/deploy-banner.sh off' 关闭。"
    ;;
  off)
    echo "→ 关闭部署警告横幅..."
    curl -s -X DELETE "$BASE/api/admin/deploy-warning?token=$TOKEN" | python3 -m json.tool
    echo ""
    echo "✓ 横幅已关闭。"
    ;;
  status)
    echo "→ 查询部署状态..."
    curl -s "$BASE/api/deploy-status" | python3 -m json.tool
    ;;
  *)
    echo "用法: bash scripts/deploy-banner.sh [on|off|status]"
    exit 1
    ;;
esac
