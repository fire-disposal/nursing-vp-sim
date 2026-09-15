#!/usr/bin/env bash
# pre-deploy-backup.sh —— 部署前全库备份 + 保留裁剪
#
# 为什么单独成脚本：备份/裁剪原先内联在 deploy.yml 的 SSH heredoc 里 —— 不可测试、
# 不可复用，而且**没有任何保留策略**：每次部署留一份明文全库 dump，只增不减
# （nursing 三个月 297 MiB、twinsia 113 份），和生产库挤在同一个 50G 卷上。
#
# 失败语义（与流水线契约一致）：
#   backup   失败 → 非零退出 → 部署中止；文件校验不等于恢复演练
#   backup 后的 prune 失败只警告；独立 prune 失败返回非零
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
#   3. 最近 MIN_KEEP_HOURS 小时内新建的（额外保留窗口）
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
  [[ -r $KEEP_LIST ]] || return 1
  sed -e 's/#.*//' -e 's/[[:space:]]\{1,\}//g' -e '/^$/d' "$KEEP_LIST"
}

validate_retention() {
  [[ $KEEP_N =~ ^[1-9][0-9]{0,5}$ ]] || { log "ERROR KEEP_N 必须为 1–999999"; return 1; }
  [[ $MIN_KEEP_HOURS =~ ^(0|[1-9][0-9]{0,5})$ ]] || { log "ERROR MIN_KEEP_HOURS 必须为 0–999999"; return 1; }
  [[ -f $KEEP_LIST && -r $KEEP_LIST ]] || { log "ERROR $KEEP_LIST 缺失或不可读，拒绝裁剪"; return 1; }
}

is_anchor() {
  keep_list_names | grep -xF -- "$1" >/dev/null
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
    return 0
  fi
  mkdir -p "$BACKUP_DIR" || die "无法创建 $BACKUP_DIR（检查权限/磁盘）"
  local name="pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  # 锁已排除并发；同秒重复调用也不能覆盖已有备份。
  while [[ -e $BACKUP_DIR/$name ]]; do
    sleep 1
    name="pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  done
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
  # 完成标记用于排除明显截断；不证明 SQL 可恢复、角色或扩展兼容。
  local trailer
  trailer=$(gzip -dc "$tmp" 2>/dev/null | tail -c 4000)
  case "$trailer" in
    *"PostgreSQL database dump complete"*) ;;
    *) rm -f "$tmp"; die "备份不完整（缺少 pg_dump 完成标记）—— 中止部署" ;;
  esac

  mv -f "$tmp" "$BACKUP_DIR/$name" || { rm -f "$tmp"; die "无法写入 $BACKUP_DIR/$name"; }
  printf '%s\n' "$BACKUP_DIR/$name" >"$STATE_FILE.tmp.$$" &&
    mv -f "$STATE_FILE.tmp.$$" "$STATE_FILE" || die "备份已保存，但无法更新 $STATE_FILE"
  log "ok        $name  $(human "$(stat -c%s "$BACKUP_DIR/$name")")"

  (cmd_prune) || log "WARN 保留裁剪失败（不影响本次部署）"
  return 0
}

cmd_prune() {
  local dry=0
  [[ ${1:-} == --dry-run ]] && dry=1
  validate_retention || return 1

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

cmd_transcode() { # 历史明文 .sql → .sql.gz：逐字节相同才删原件
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
    if ! gzip -dc "$tmp" | cmp -s "$f" -; then
      rm -f "$tmp"
      log "WARN $(basename "$f") 解压内容不符，保留原文件"
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
    touch -r "$f" "$gz" || { log "WARN 无法保留时间戳，保留原文件"; continue; }
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
# 所有写操作共用锁；list 和 dry-run 不创建目录、锁或状态文件。
case "$cmd" in
  backup | prune | transcode)
    if [[ ${1:-} != --dry-run ]]; then
      mkdir -p "$BACKUP_DIR" || die "无法创建 $BACKUP_DIR"
      exec 9>"$BACKUP_DIR/.pre-deploy.lock" || die "无法打开备份锁"
      flock -w 60 9 || die "另一备份维护操作仍在运行"
    fi
    ;;
esac
case "$cmd" in
  backup | prune | list | transcode) "cmd_$cmd" "$@" ;;
  *) die "未知命令：$cmd（backup|prune|list|transcode）" ;;
esac
