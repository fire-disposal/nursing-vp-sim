#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

msg_info()  { echo -e "  $*"; }
msg_ok()    { echo -e "  ${GREEN}>>${NC} $*"; }
msg_warn()  { echo -e "  ${YELLOW}!!${NC} $*"; }
msg_fatal() { echo -e "  ${RED}!!${NC} $*"; exit 1; }

ENV_NAME="prod"
ROLLBACK_YES="0"
TARGET_VERSION=""
DO_LIST="0"

usage() {
    cat <<'USAGE'
Usage:
  bash rollback.sh [--env prod|staging] --list
  bash rollback.sh [--env prod|staging] [--yes] <version>
  bash rollback.sh [--env prod|staging]

Examples:
  bash rollback.sh --env prod --yes 2026.06.02-2
  bash rollback.sh --env staging --yes 2026.06.02-2
  bash rollback.sh --env staging --list
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            [[ $# -ge 2 ]] || msg_fatal "--env 需要参数: prod 或 staging"
            ENV_NAME="$2"
            shift 2
            ;;
        --env=*)
            ENV_NAME="${1#--env=}"
            shift
            ;;
        --list)
            DO_LIST="1"
            shift
            ;;
        --yes)
            ROLLBACK_YES="1"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            TARGET_VERSION="$1"
            shift
            ;;
    esac
done

case "$ENV_NAME" in
    prod|production)
        ENV_NAME="prod"
        HISTORY_FILE=".version-history-prod"
        COMPOSE_FILE="docker-compose.yml"
        COMPOSE_PROJECT_ARGS=()
        BACKEND_CONTAINER="nursing-vp-sim-backend-1"
        API_HEALTH_URL="http://127.0.0.1:9001/api/health"
        DB_BACKUP_ENV="prod"
        ;;
    staging)
        HISTORY_FILE=".version-history-staging"
        COMPOSE_FILE="docker-compose.staging.yml"
        COMPOSE_PROJECT_ARGS=(-p nursing-vp-staging)
        BACKEND_CONTAINER="nursing-backend-staging"
        API_HEALTH_URL="http://127.0.0.1:9081/api/health"
        DB_BACKUP_ENV="staging"
        ;;
    *)
        msg_fatal "无效环境: ${ENV_NAME}，只能是 prod 或 staging"
        ;;
esac

TARGET_VERSION="${TARGET_VERSION#v}"
ROLLBACK_OVERRIDE=".rollback.${ENV_NAME}.override.yml"

compose() {
    docker compose -f "$COMPOSE_FILE" --env-file .env "${COMPOSE_PROJECT_ARGS[@]}" "$@"
}

compose_with_override() {
    docker compose -f "$COMPOSE_FILE" -f "$ROLLBACK_OVERRIDE" --env-file .env "${COMPOSE_PROJECT_ARGS[@]}" "$@"
}

list_versions() {
    if [[ ! -f "$HISTORY_FILE" ]]; then
        msg_fatal "未找到版本历史文件 (${HISTORY_FILE})"
    fi

    mapfile -t entries < "$HISTORY_FILE"

    if [[ ${#entries[@]} -eq 0 ]]; then
        msg_fatal "版本历史为空"
    fi

    local total=${#entries[@]}
    local current=$((total))

    echo ""
    echo "  ${ENV_NAME} 可用部署历史 (最近 ${total} 次):"
    echo "  ┌──────────────────────────────────────────────────────────┐"
    local i=1
    while [[ $i -le $total ]]; do
        IFS='|' read -r ver ts _ _ _ event <<< "${entries[$((i-1))]}"
        local mark=""
        local event_label=""
        if [[ $i -eq $current ]]; then
            mark=" ← 当前"
        fi
        if [[ -n "${event:-}" ]]; then
            event_label=" (${event})"
        fi
        printf "  │ ${CYAN}[%d]${NC} %-12s %s%s  %s\n" "$i" "$ver" "$ts" "$event_label" "$mark"
        i=$((i + 1))
    done
    echo "  └──────────────────────────────────────────────────────────┘"
    echo ""
}

write_override() {
    local backend_img=$1
    local frontend_img=$2
    cat > "$ROLLBACK_OVERRIDE" <<EOF
services:
  backend:
    image: ${backend_img}
  frontend:
    image: ${frontend_img}
EOF
}

backup_before_rollback() {
    local backup_script="deploy/db-backup.sh"
    [[ -f "$backup_script" ]] || msg_fatal "未找到 ${backup_script}，拒绝无备份回滚"

    msg_ok "回滚前备份数据库 (${ENV_NAME}) ..."
    bash "$backup_script" "$DB_BACKUP_ENV" backup || msg_fatal "回滚前数据库备份失败，停止回滚"
}

verify_migration_revision() {
    local target_rev=$1
    [[ -n "$target_rev" ]] || return 0

    local current_rev
    current_rev=$(compose_with_override exec -T backend alembic current 2>/dev/null | head -1 | awk '{print $1}' || true)
    if [[ "$current_rev" != "$target_rev" ]]; then
        msg_fatal "迁移版本不匹配: current=${current_rev:-unknown}, target=${target_rev}"
    fi
    msg_ok "迁移版本已确认: ${target_rev}"
}

verify_api_version() {
    local ver=$1
    local body
    body=$(curl -sf "$API_HEALTH_URL") || msg_fatal "API 健康检查失败: ${API_HEALTH_URL}"

    local actual_ver
    actual_ver=$(printf '%s' "$body" | sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -1)
    actual_ver="${actual_ver#v}"
    if [[ "$actual_ver" == "$ver" ]]; then
        msg_ok "API 版本已确认: ${ver}"
    else
        msg_fatal "API 版本不匹配，目标=${ver}，实际=${actual_ver:-unknown}，响应=${body}"
    fi
}

append_rollback_history() {
    local ver=$1
    local backend_img=$2
    local frontend_img=$3
    local target_rev=$4
    local ts
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "${ver}|${ts}|${backend_img}|${frontend_img}|${target_rev}|rollback" >> "$HISTORY_FILE"
    tail -50 "$HISTORY_FILE" > "${HISTORY_FILE}.tmp" && mv "${HISTORY_FILE}.tmp" "$HISTORY_FILE"
}

rollback_to() {
    local line_num=$1
    local entry
    entry=$(sed -n "${line_num}p" "$HISTORY_FILE")
    IFS='|' read -r ver ts backend_img frontend_img target_rev _ <<< "$entry"

    if [[ -z "$backend_img" ]]; then
        backend_img="ghcr.io/fire-disposal/nursing-vp-sim-backend:${ver}"
    fi
    if [[ -z "$frontend_img" ]]; then
        frontend_img="ghcr.io/fire-disposal/nursing-vp-sim-frontend:${ver}"
    fi

    echo ""
    msg_info "将回滚 ${ENV_NAME} 到:"
    echo "    版本:   ${GREEN}${ver}${NC}"
    echo "    时间:   ${ts}"
    echo "    后端:   ${backend_img}"
    echo "    前端:   ${frontend_img}"
    if [[ -n "$target_rev" ]]; then
        echo "    迁移:   ${target_rev}"
    else
        echo "    迁移:   ${YELLOW}未记录，无法精确校验${NC}"
    fi
    echo ""

    local confirm=""
    if [[ "$ROLLBACK_YES" == "1" ]]; then
        confirm="y"
    else
        read -r -p "  确认回滚? (y/n): " confirm
    fi

    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        msg_warn "已取消"
        exit 0
    fi

    backup_before_rollback

    echo ""
    msg_ok "生成临时 compose override ..."
    write_override "$backend_img" "$frontend_img"

    msg_ok "拉取镜像..."
    docker pull "$backend_img" || msg_fatal "后端镜像拉取失败"
    docker pull "$frontend_img" || msg_fatal "前端镜像拉取失败"

    if [[ -n "$target_rev" ]]; then
        msg_ok "回滚数据库迁移 → ${target_rev} ..."
        compose exec -T backend alembic downgrade "$target_rev" || msg_fatal "迁移回滚失败，停止回滚"
    else
        msg_warn "未记录目标版本迁移 revision，尝试 downgrade -1（无法精确校验）"
        compose exec -T backend alembic downgrade -1 || msg_fatal "迁移回滚失败，停止回滚"
    fi

    msg_ok "重启服务..."
    compose_with_override up -d --remove-orphans

    echo ""
    msg_ok "Docker 健康检查..."
    OK=false
    for i in $(seq 1 30); do
        S=$(docker inspect --format '{{.State.Health.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || echo "")
        case "$S" in
            healthy) echo "  ✓ healthy ($((i * 2))s)"; OK=true; break ;;
            unhealthy)
                msg_fatal "容器不健康，请手动检查" ;;
        esac
        sleep 2
    done
    if [[ "$OK" != "true" ]]; then
        msg_fatal "健康检查超时，请手动检查"
    fi

    verify_api_version "$ver"
    verify_migration_revision "$target_rev"
    append_rollback_history "$ver" "$backend_img" "$frontend_img" "$target_rev"

    echo ""
    msg_ok "回滚完成，${ENV_NAME} 已恢复至 ${ver}"
}

if [[ ! -f "$COMPOSE_FILE" ]]; then
    msg_fatal "未找到 ${COMPOSE_FILE}，请在部署目录下执行此脚本"
fi

if [[ "$DO_LIST" == "1" ]]; then
    list_versions
    exit 0
fi

# 非交互模式：指定版本回滚
if [[ -n "$TARGET_VERSION" ]]; then
    if [[ ! -f "$HISTORY_FILE" ]]; then
        msg_fatal "未找到版本历史文件 (${HISTORY_FILE})"
    fi
    line_num=$(awk -F'|' -v target="$TARGET_VERSION" '$1 == target { line = NR } END { if (line) print line }' "$HISTORY_FILE")
    if [[ -z "$line_num" ]]; then
        echo "!! 未找到版本: ${TARGET_VERSION}"
        echo "   可用版本:"
        cut -d'|' -f1 "$HISTORY_FILE" | sed 's/^/     /'
        exit 1
    fi
    rollback_to "$line_num"
    exit 0
fi

# 交互模式
list_versions

mapfile -t entries < "$HISTORY_FILE"
total=${#entries[@]}

read -r -p "  请选择要回滚的版本 [1-${total}] (q 退出): " choice

if [[ "$choice" == "q" || "$choice" == "Q" ]]; then
    msg_warn "已取消"
    exit 0
fi

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt "$total" ]]; then
    msg_fatal "无效选择: ${choice}"
fi

if [[ "$choice" -eq "$total" ]]; then
    msg_warn "所选版本为当前版本，无需回滚"
    exit 0
fi

rollback_to "$choice"
