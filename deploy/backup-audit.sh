#!/usr/bin/env bash
# backup-audit.sh —— 备份审计：把“备份悄悄停了”变成一次红色构建
#
# 为什么需要它：2026-06-25 nursing 的定时备份 cron 被删，直到 09-15 排查才
# 发现（81 天空档）；同期 twinsia 的每日快照连续 4 次失败也无人知晓。两次都是
# 同一类故障——**备份坏了没人知道**，因为监控只查容器/磁盘/健康检查，不查备份。
# 本脚本把这些检查放进 CI：每天跑一次，失败即置红（并可推钉钉）。
#
# 用法:  bash deploy/backup-audit.sh [user@host]
# 退出码: 0 = 全部通过；1 = 至少一项 FAIL
set -uo pipefail

TARGET="${1:-yecaoyun}"

ssh -o ConnectTimeout=10 -o BatchMode=yes "$TARGET" 'bash -s' <<'REMOTE'
set -uo pipefail

FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

age_h() { # 文件年龄（小时）；不存在 → 9999
  [[ -e $1 ]] || { printf '9999'; return; }
  printf '%s' $(( ($(date +%s) - $(stat -c %Y "$1")) / 3600 ))
}
newest() { ls -1t "$@" 2>/dev/null | head -1; }
size_mb() { # 目录不存在 → 0（绝不能返回空串：$(( )) 会因操作数缺失直接报错）
  local v
  if [[ -d $1 ]]; then
    v=$(du -sm "$1" 2>/dev/null | cut -f1)
  fi
  echo "${v:-0}"
}
human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || printf '%sB' "$1"; }

echo "══ 1. 定时任务是否还在（crontab 被重写删掉是本机真实发生过的事故）"
crontab -l 2>/dev/null | grep -q 'db-backup.sh prod' \
  && ok "nursing 周期备份 cron 在位" \
  || bad "nursing 周期备份 cron 缺失 —— 备份已停，恢复方法见 docs/ops/backup-restore.md"
crontab -l 2>/dev/null | grep -q 'backup-assets.sh run' \
  && ok "twinsia 空间数据备份 cron 在位" \
  || bad "twinsia 空间数据备份 cron 缺失（装法：backup-assets.sh install-cron）"

echo
echo "══ 2. 备份新鲜度"
f=$(newest /opt/nursing-vp-sim/backups/prod/prod_*.sql.gz)
h=$(age_h "$f")
if [[ -n $f ]] && ((h <= 96)); then
  ok "nursing 最新周期备份 ${h}h 前（$(basename "$f")）"
else
  bad "nursing 周期备份 ${h}h 前（应 ≤96h；cron 每 3 天）"
fi
f=$(newest /opt/twinsia/backups/snapshots/db-*.json.zst)
h=$(age_h "$f")
if [[ -n $f ]] && ((h <= 48)); then
  ok "twinsia 最新空间快照 ${h}h 前"
else
  bad "twinsia 空间快照 ${h}h 前（应 ≤48h；cron 每日 04:10）"
fi

last=$(tail -1 /opt/twinsia/backups/backup.log 2>/dev/null)
snap_m=$(stat -c %Y "$(newest /opt/twinsia/backups/snapshots/db-*.json.zst)" 2>/dev/null || echo 0)
log_m=$(stat -c %Y /opt/twinsia/backups/backup.log 2>/dev/null || echo 0)
if [[ -z $last ]]; then
  ok "twinsia backup.log 为空（尚未运行过）"
elif grep -qiE 'error|required in container mode' <<<"$last"; then
  # 只看末行会误报“早已修好的历史错误”——判据是「错误之后有没有更新的成功快照」
  if ((snap_m > log_m)); then
    warn "twinsia backup.log 末行是历史错误，但其后已有成功快照（$(date -d "@$snap_m" '+%F %T')）→ 视为已恢复"
  else
    bad "twinsia backup.log 末行是错误，且其后没有更新的成功快照：${last:0:100}"
  fi
else
  ok "twinsia backup.log 末行正常"
fi
last=$(tail -1 /var/log/db-backup.log 2>/dev/null)
if grep -q '\[ERR\]' <<<"$last"; then
  bad "nursing db-backup.log 末行是错误：${last:0:120}"
else
  ok "nursing db-backup.log 末行正常"
fi

echo
echo "══ 3. 部署前备份是否存在"
for d in /opt/nursing-vp-sim/backups /opt/twinsia/backups /opt/emoguard/backups; do
  [[ -d $d ]] || { echo "  - $d 不存在（尚未接入 pre-deploy 备份）"; continue; }
  n=$(find "$d" -maxdepth 1 -type f \( -name 'pre-deploy-*.sql' -o -name 'pre-deploy-*.sql.gz' \) | wc -l)
  ((n > 0)) && ok "$d 有 $n 份" || bad "$d 一份都没有"
  # 明文残留：只会在“部署历史 tag”（用旧流水线代码）后出现，提醒压缩即可
  raw=$(find "$d" -maxdepth 1 -type f -name 'pre-deploy-*.sql' | wc -l)
  ((raw > 0)) && warn "$d 有 $raw 份未压缩明文（跑 pre-deploy-backup.sh transcode 可省约 80% 空间）"
  # 锚点可见性：编辑 keep-list 时把锚点写没，会让保护**静默**失效（本次真实发生过一次）。
  # 期望条数 = 备份恢复文档里登记的锚点清单条数；预期为 0 的栈不产生噪声。
  kl="$d/.pre-deploy-keep"
  if [[ -f $kl ]]; then
    a=$(grep -v '^#' "$kl" | grep -cv '^$')
    exp=0
    case "$d" in
      /opt/nursing-vp-sim/backups) exp=2 ;;
      /opt/twinsia/backups) exp=1 ;;
    esac
    if ((a >= exp)); then
      echo "  - $kl 锚点 $a 条（期望 ≥$exp）"
    else
      warn "$kl 锚点只有 $a 条，期望 ≥$exp —— 可能编辑时被写没了（清单见 docs/ops/backup-restore.md）"
    fi
  fi
done

echo
echo "══ 4. 体积预算（防止无上界增长把生产卷写满）"
check_budget() { # $1=目录 $2=预算 MiB
  local dir=$1 budget=$2 mb
  [[ -d $dir ]] || { echo "  - $dir 不存在，跳过"; return; }
  mb=$(size_mb "$dir")
  if ((mb <= budget)); then
    ok "$dir $(human "$((mb * 1048576))")（预算 $(human "$((budget * 1048576))")）"
  else
    bad "$dir $(human "$((mb * 1048576))") 超出预算 $(human "$((budget * 1048576))") —— 检查保留策略"
  fi
}
check_budget /opt/nursing-vp-sim/backups 1024
check_budget /opt/twinsia/backups 512
check_budget /opt/emoguard/backups 256

avail=$(df -Pm / | awk 'NR==2 {print $4}')
if ((avail >= 5120)); then
  ok "根分区可用 $((avail / 1024)) GiB"
else
  bad "根分区可用仅 $((avail / 1024)) GiB —— 低于 5 GiB 安全线"
fi

echo
echo "══ 5. 概览"
echo "  nursing  backups : $(human "$(( $(size_mb /opt/nursing-vp-sim/backups) * 1048576 ))")"
echo "  twinsia  backups : $(human "$(( $(size_mb /opt/twinsia/backups) * 1048576 ))")"
echo "  emoguard backups : $(human "$(( $(size_mb /opt/emoguard/backups) * 1048576 ))")"

echo
echo "══ 6. 退役实例冷备（staging→prod 合并于 2026-09-14，现为单实例）"
# 这些文件不是 pre-deploy-* 命名，因此**不受保留策略影响、永远不会被自动删除**；
# 本节只报告存在性与大小，让人知道冷备还在不在，避免“以为有、其实早没了”。
for f in /opt/nursing-vp-sim/backups/prod-*.dump /opt/nursing-vp-sim/backups/staging-*.dump; do
  [[ -e $f ]] || continue
  echo "  - $(basename "$f")  $(human "$(stat -c%s "$f")")  $(date -r "$f" '+%F')"
done
n=$(find /opt/nursing-vp-sim/backups/staging -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null | wc -l)
echo "  - backups/staging/ 退役实例旧周期备份 ${n} 份（不受保留策略影响）"
if docker volume ls --format '{{.Name}}' | grep -q '^nursing-vp-staging_'; then
  warn "staging 冷备卷仍在（迁移文档 §9 计划 ≥2026-09-21 清理，届时本条转为提示消失）"
else
  ok "staging 冷备卷已清理"
fi

echo
if ((FAIL == 0)); then
  echo "结果：全部通过 ✅"
  exit 0
fi
echo "结果：${FAIL} 项失败 ❌"
exit 1
REMOTE
