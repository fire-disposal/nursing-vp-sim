#!/usr/bin/env bash
set -euo pipefail

HISTORY_FILE=".version-history"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

msg_info()  { echo -e "  $*"; }
msg_ok()    { echo -e "  ${GREEN}>>${NC} $*"; }
msg_warn()  { echo -e "  ${YELLOW}!!${NC} $*"; }
msg_fatal() { echo -e "  ${RED}!!${NC} $*"; exit 1; }

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
    echo "  可用部署历史 (最近 ${total} 次):"
    echo "  ┌──────────────────────────────────────────────────────────┐"
    local i=1
    while [[ $i -le $total ]]; do
        IFS='|' read -r ver ts _ _ <<< "${entries[$((i-1))]}"
        local mark=""
        if [[ $i -eq $current ]]; then
            mark=" ← 当前"
        fi
        printf "  │ ${CYAN}[%d]${NC} %-12s %s  %s\n" "$i" "$ver" "$ts" "$mark"
        i=$((i + 1))
    done
    echo "  └──────────────────────────────────────────────────────────┘"
    echo ""
}

rollback_to() {
    local line_num=$1
    local entry
    entry=$(sed -n "${line_num}p" "$HISTORY_FILE")
    IFS='|' read -r ver ts backend_img frontend_img <<< "$entry"

    echo ""
    msg_info "将回滚到:"
    echo "    版本:   ${GREEN}${ver}${NC}"
    echo "    时间:   ${ts}"
    echo "    后端:   ${backend_img}"
    echo "    前端:   ${frontend_img}"
    echo ""

    local confirm=""
    if [[ "${ROLLBACK_YES:-}" == "1" ]]; then
        confirm="y"
    else
        read -r -p "  确认回滚? (y/n): " confirm
    fi

    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        msg_warn "已取消"
        exit 0
    fi

    echo ""
    msg_ok "拉取镜像..."
    docker pull "$backend_img"
    docker pull "$frontend_img"

    msg_ok "更新 compose 配置..."
    sed -i "s|image: .*nursing-vp-sim-backend:.*|image: ${backend_img}|" docker-compose.yml
    sed -i "s|image: .*nursing-vp-sim-frontend:.*|image: ${frontend_img}|" docker-compose.yml

    msg_ok "重启服务..."
    docker compose up -d

    echo ""
    msg_ok "回滚完成，服务已恢复至 ${ver}"
}

# —— 入口 ————————————————————————————————————

if [[ ! -f docker-compose.yml ]]; then
    msg_fatal "未找到 docker-compose.yml，请在部署目录下执行此脚本"
fi

ROLLBACK_YES="0"
TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --list)
            list_versions
            exit 0
            ;;
        --yes)
            ROLLBACK_YES="1"
            shift
            ;;
        *)
            TARGET_VERSION="$1"
            shift
            ;;
    esac
done

# 非交互模式：指定版本回滚
if [[ -n "$TARGET_VERSION" ]]; then
    if [[ ! -f "$HISTORY_FILE" ]]; then
        msg_fatal "未找到版本历史文件 (${HISTORY_FILE})"
    fi
    line_num=$(grep -n "^${TARGET_VERSION}|" "$HISTORY_FILE" | head -1 | cut -d: -f1)
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
