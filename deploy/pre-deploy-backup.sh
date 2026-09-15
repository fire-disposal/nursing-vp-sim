#!/usr/bin/env bash
# pre-deploy-backup.sh —— 部署前全库备份 + 保留裁剪
#
# 为什么单独成脚本：备份/裁剪原先内联在 deploy.yml 的 SSH heredoc 里 —— 不可测试、
# 不可复用，而且**没有任何保留策略**：每次部署留一份明文全库 dump，只增不减
# （nursing 三个月 297 MiB、twinsia 113 份），和生产库挤在同一个 50G 卷上。
#
# 失败语义（与流水线契约一致）：
#   backup   失败 → 非零退出 → **部署中止**（绝不带着不可回退的状态上车）
#   prune    失败 → 只警告，不影响部署（清理是维护动作，不该挡住发布）
#
# 用法：
#   pre-deploy-backup.sh backup    [--dry-run]
#   pre-deploy-backup.sh prune     [--dry-run]
#   pre-deploy-backup.sh list
#   pre-deploy-backup.sh transcode [--dry-run]   # 一次性：历史明文 .sql → .sql.gz
#
# 保留规则（prune；任一条命中即保留，其余删除）：
#   1. 最新 KEEP_N 份
#   2. .pre-deploy-keep 里列的锚点（按“基准名”匹配，.sql 与 .sql.gz 通用）
#   3. 最近 MIN_KEEP_HOURS 小时内新建的（防并发部署互踩）
#
# 同体脚本（仅“站点默认值”一节不同，改动请三处同步）：
#   nursing-vp-sim/deploy/pre-deploy-backup.sh、twinsia/scripts/ops/pre-deploy-backup.sh、
#   emoguard_project/scripts/pre-deploy-backup.sh
set -uo pipefail

# ── 站点默认值（本文件唯一的仓库差异区）──
BACKUP_DIR="${BACKUP_DIR:-/opt/nursing-vp-sim/backups}"
PG_CONTAINER="${PG_CONTAINER:-nursing-db}"
PG_USER="${PG_USER:-nursing}"
PG_DB="${PG_DB:-nursing_vp}"
PG_ENV_ARGS=()                 # 容器内 trust 认证，无需传密码
# 周期备份每 3 天一次且保留 30 天，长周期已有覆盖；pre-deploy 只需覆盖最近几次部署。
KEEP_N="${KEEP_N:-10}"

# ── 覆盖项 ──
MIN_KEEP_HOURS="${MIN_KEEP_HOURS:-6}"
KEEP_LIST="$BACKUP_DIR/.pre-deploy-keep"
STATE_FILE="$BACKUP_DIR/.last-pre-deploy"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >&2; }
die() { log "ERROR $*"; exit 1; }

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || printf '%sB' "$1"; }

base_name() { # 去掉 .sql / .sql.gz → 基准名（锚点按基准名匹配，改后缀不失效）
  local n=${1##*/}
  n=${n%.gz}
  printf '%s' "${n%.sql}"
}

backup_files() { # 按 mtime 新→旧：每行 "<epoch> <path>"
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'pre-deploy-*.sql' -o -name 'pre-deploy-*.sql.gz' \) \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn
}

keep_list_names() {
  [[ -f $KEEP_LIST ]] || return 0
  sed -e 's/#.*//' -e 's/[[:space:]]\{1,\}//g' "$KEEP_LIST" | grep -v '^$' || true
}

ensure_keep_list() { # $1=dry → 只报告不落盘（--dry-run 严格零写入）
  [[ -f $KEEP_LIST ]] && return 0
  if [[ ${1:-} == dry ]]; then
    log "dry-run   keep-list $KEEP_LIST 不存在，正式运行时会创建空模板（锚点此刻无法评估）"
    return 0
  fi
  mkdir -p "$BACKUP_DIR"
  cat >"$KEEP_LIST" <<'EOF'
# pre-deploy 备份的锚点：列在这里的备份永不自动删除。
# 按“基准名”匹配，.sql 与 .sql.gz 通用（写 pre-deploy-20260913-224143 即可）。
#
# 什么时候加：跨结构性变更时 —— 库迁移、大版本 schema 重写、单实例收敛之类。
# 加锚点随时可以；删锚点不可逆。锚点占用的是明文备份的存储，别无代价。
EOF
  log "keep-list $KEEP_LIST 不存在，已生成空模板"
}

is_anchor() {
  keep_list_names | grep -qxF -- "$1"
}

decide() { # $1=名次(1 起) $2=mtime(epoch) $3=路径 → "keep:<原因>" 或 "prune"
  local rank=$1 mtime=$2 path=$3
  (( rank <= KEEP_N )) && { printf 'keep:最新 %d/%d' "$rank" "$KEEP_N"; return; }
  is_anchor "$(base_name "$path")" && { printf 'keep:锚点'; return; }
  (( $(date +%s) - mtime < MIN_KEEP_HOURS * 3600 )) && { printf 'keep:%sh 内新建' "$MIN_KEEP_HOURS"; return; }
  printf 'prune'
}

cmd_backup() {
  local dry=0
  [[ ${1:-} == --dry-run ]] && dry=1
  if (( dry )); then
    log "dry-run   会 pg_dump $PG_USER@$PG_DB（容器 $PG_CONTAINER）→ $BACKUP_DIR/pre-deploy-<时间戳>.sql.gz，随后裁剪（本次不写盘）"
    ensure_keep_list dry
    return 0
  fi
  ensure_keep_list
  mkdir -p "$BACKUP_DIR" || die "无法创建 $BACKUP_DIR（检查权限/磁盘）"
  local name="pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  local tmp="$BACKUP_DIR/.$name.tmp.$$" errf="$BACKUP_DIR/.$name.err.$$"

  # 上次被 kill（超时/断连）可能留下半成品临时文件；>24h 才清理，避免误删并发运行的
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '.pre-deploy-*.tmp.*' -mmin +1440 -delete 2>/dev/null || true

  log "backup    pg_dump $PG_USER@$PG_DB（容器 $PG_CONTAINER）→ $name"
  # 必须吃到 pg_dump 自己的退出码：只看 gzip 的话，pg_dump 失败会留下一个
  # “完整但空”的 gz，部署照常继续 —— 正是最坏的情况。
  if ! docker exec "${PG_ENV_ARGS[@]}" "$PG_CONTAINER" \
    pg_dump -U "$PG_USER" -d "$PG_DB" 2>"$errf" | gzip -c >"$tmp"; then
    log "pg_dump/gzip 失败，容器 stderr："
    sed 's/^/    /' "$errf" >&2 2>/dev/null || true
    rm -f "$tmp" "$errf"
    die "部署前备份失败 —— 中止部署"
  fi
  rm -f "$errf"

  # 三道校验都过了才让文件出现在正式位置（半成品绝不冒充备份）
  [[ -s $tmp ]] || { rm -f "$tmp"; die "备份文件为空"; }
  gzip -t "$tmp" || { rm -f "$tmp"; die "gzip 完整性校验失败"; }
  local hdr
  hdr=$(gzip -dc "$tmp" 2>/dev/null | head -c 4000)
  case "$hdr" in
    *"PostgreSQL database dump"*) ;;
    *) rm -f "$tmp"; die "产物不是 pg_dump 明文输出（头部校验失败）" ;;
  esac

  mv -f "$tmp" "$BACKUP_DIR/$name" || { rm -f "$tmp"; die "无法写入 $BACKUP_DIR/$name"; }
  printf '%s\n' "$BACKUP_DIR/$name" >"$STATE_FILE"
  log "ok        $name  $(human "$(stat -c%s "$BACKUP_DIR/$name")")"

  cmd_prune || log "WARN 保留裁剪失败（不影响本次部署）"
}

cmd_prune() {
  local dry=0
  [[ ${1:-} == --dry-run ]] && dry=1
  ensure_keep_list "$([[ $dry == 1 ]] && echo dry)"
  (( KEEP_N >= 1 )) || die "KEEP_N=$KEEP_N 非法（必须 ≥1）—— 拒绝裁剪，避免删空"
  # 没有 keep-list 时锚点机制等同失效，必须让人看见（而不是安静地按名次裁掉）
  [[ -f $KEEP_LIST ]] || log "WARN $KEEP_LIST 不存在 —— 本次裁剪没有任何锚点保护，只按名次/时限保留"
  # 锚点清单存在但一条有效锚点都没有：多半是编辑时被写没了（本次真实发生过）
  if [[ -f $KEEP_LIST ]] && [[ -z $(keep_list_names) ]]; then
    log "WARN $KEEP_LIST 里没有任何有效锚点 —— 若本应有锚点，请检查文件内容"
  fi
  [[ -e $KEEP_LIST && ! -r $KEEP_LIST ]] && die "$KEEP_LIST 存在但不可读 —— 锚点保护不可用，拒绝裁剪"

  local -a lines
  mapfile -t lines < <(backup_files)
  local total=${#lines[@]}
  (( total > 0 )) || { log "prune     没有 pre-deploy 备份"; return 0; }

  local i=0 kept=0 removed=0 freed=0 line mtime path name size verdict
  for line in "${lines[@]}"; do
    i=$((i + 1))
    mtime=${line%% *}
    path=${line#* }
    name=$(basename "$path")
    size=$(stat -c%s "$path" 2>/dev/null || echo 0)
    verdict=$(decide "$i" "${mtime%.*}" "$path")
    if [[ $verdict == keep:* ]]; then
      kept=$((kept + 1))
      (( dry )) && log "keep      $name  [${verdict#keep:}]"
      continue
    fi
    if (( dry )); then
      log "dry-run   会删除 $name  $(human "$size")"
      continue
    fi
    if rm -f -- "$path"; then
      removed=$((removed + 1))
      freed=$((freed + size))
      log "pruned    $name  $(human "$size")"
    else
      log "WARN 删除失败：$path"
    fi
  done
  log "prune     共 ${total} 份 → 保留 ${kept}，删除 ${removed}，释放 $(human "$freed")"
}

cmd_list() {
  local -a lines
  mapfile -t lines < <(backup_files)
  printf '%-28s %10s  %-19s  %s\n' 文件 大小 时间 判定
  local i=0 line mtime path size verdict
  for line in "${lines[@]}"; do
    i=$((i + 1))
    mtime=${line%% *}
    path=${line#* }
    size=$(stat -c%s "$path" 2>/dev/null || echo 0)
    verdict=$(decide "$i" "${mtime%.*}" "$path")
    printf '%-28s %10s  %-19s  %s\n' "$(basename "$path")" "$(human "$size")" \
      "$(date -d "@${mtime%.*}" '+%F %T')" "${verdict#keep:}"
  done
}

cmd_transcode() { # 历史明文 .sql → .sql.gz：先解压核对字节数，一致才删原件
  local dry=0
  [[ ${1:-} == --dry-run ]] && dry=1
  local f gz tmp orig new n count=0 freed=0
  while IFS= read -r f; do
    [[ -n $f ]] || continue
    gz="$f.gz"
    if [[ -e $gz ]]; then
      log "skip      $(basename "$gz") 已存在"
      continue
    fi
    if (( $(date +%s) - $(stat -c %Y "$f") < 3600 )); then
      log "skip      $(basename "$f") 太新（1h 内），下一轮再压缩"
      continue
    fi
    orig=$(stat -c%s "$f")
    if (( dry )); then
      log "dry-run   会压缩 $(basename "$f")  $(human "$orig")"
      continue
    fi
    tmp="$gz.tmp.$$"
    if ! gzip -c "$f" >"$tmp" || ! gzip -t "$tmp"; then
      rm -f "$tmp"
      log "WARN $(basename "$f") 压缩/校验失败，保留原文件"
      continue
    fi
    n=$(gzip -dc "$tmp" | wc -c)
    if [[ $n != "$orig" ]]; then
      rm -f "$tmp"
      log "WARN $(basename "$f") 解压字节数不符（$n != $orig），保留原文件"
      continue
    fi
    mv -f "$tmp" "$gz" || { rm -f "$tmp"; log "WARN 写入 $gz 失败"; continue; }
    # 落盘后复验：这一步失败时原文件还在（rm 在其后），两边都留着交人工处理
    if ! gzip -t "$gz"; then
      log "WARN $gz 落盘后校验失败 —— 保留原文件与 gz，人工确认"
      continue
    fi
    # 保留原始 mtime：排序（谁最新）与“多久算新鲜”都按备份时间算，不能因为压缩而
    # 把所有文件刷成“刚刚” —— 那会让保留判定错乱（实测：压缩后一次 prune 一份都没删）。
    touch -r "$f" "$gz" 2>/dev/null || true
    new=$(stat -c%s "$gz")
    if rm -f -- "$f"; then
      count=$((count + 1))
      freed=$((freed + orig - new))
      log "transcoded $(basename "$gz")  $(human "$orig") → $(human "$new")"
    else
      log "WARN $(basename "$f") 删除失败，保留 $gz 与原文件（手动处理）"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-deploy-*.sql' -printf '%p\n' 2>/dev/null | sort)
  log "transcode 完成：${count} 个文件，释放 $(human "$freed")"
}

cmd="${1:-backup}"
shift || true
case "$cmd" in
  backup | prune | list | transcode) "cmd_$cmd" "$@" ;;
  *) die "未知命令：$cmd（backup|prune|list|transcode）" ;;
esac
