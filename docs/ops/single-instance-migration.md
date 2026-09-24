# 单实例迁移（staging → 正式服）

> 决策：2026-09-14，方案 B（把 staging 库灌进正式栈），随后归档双栈 CI/CD、转为单实例部署。
> 状态（2026-09-14 收尾）：**P1–P4 已人工执行完成** —— 数据已灌入正式栈、`test.205716.xyz` 已改为单跳 301、
> staging 容器已退役（卷保留 7 天冷备）、仓库内双栈残留已同步清理。**剩余「待人工」项汇总见 §9。**

## 0. 事实基础（2026-09-14 实测）

| 项 | prod `nursing-db` | staging `nursing-db-staging` |
|---|---|---|
| 库体积 | 11 MB | **82 MB** |
| users / training_records / messages | 6 / 8 / 29 | **35 / 494 / 10 368** |
| llm_call_logs / feedback | 17 / 0 | **10 875 / 31** |
| alembic current | — | `d4f6a8b0c2e4f6a8`（= 代码 head） |
| 镜像 | `2026.08.30-1` | `2026.08.30-2` |
| 容器 | `nursing-vp-sim-backend-1` / `nursing-vp-sim-frontend-1` / `nursing-db` | `nursing-backend-staging` / `nursing-frontend-staging` / `nursing-db-staging` |
| 端口 | 9001 / 9000 / 5433 | 9081 / 9080 / 5434 |
| 域名 | `iomt.205716.xyz` | `test.205716.xyz` |

**结论：真数据集在 staging**，迁移方向是 staging → prod 栈。

### 已完成的演练（可复现）

```bash
# 1) 导出（16 MB，custom format）
docker exec nursing-db-staging pg_dump -U nursing -d nursing_vp -Fc > /tmp/staging.dump

# 2) 恢复进一次性容器（不碰任何在跑的服务）
docker run -d --name nursing-mig-rehearsal \
  -e POSTGRES_USER=nursing -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=nursing_vp postgres:15
docker exec -i nursing-mig-rehearsal pg_restore -U nursing -d nursing_vp --no-owner --clean --if-exists < /tmp/staging.dump

# 3) 校验（与 staging 逐项一致）
docker exec nursing-mig-rehearsal psql -U nursing -d nursing_vp -t -c \
  "select (select count(*) from users), (select count(*) from training_records), (select count(*) from messages), (select count(*) from cases);"
#   → 35 | 494 | 10368 | 13
docker exec nursing-mig-rehearsal psql -U nursing -d nursing_vp -t -c "select version_num from alembic_version;"
#   → d4f6a8b0c2e4f6a8
docker rm -f nursing-mig-rehearsal
```

## 1. P0 — 冻结写入（随时可做，零风险）

```bash
# 让 staging 成为唯一写入方；prod 栈只读观察
# 1) 不再对 prod 发版（已由 CI 归档保证：deploy-staging/deploy-production 均不激活）
# 2) 确认 prod 无会话：看 /api/metrics 的 active_sessions（已接线 = DB 进行中训练数；规范字段是
#    /api/diagnose 的 sessions.active）
curl -s "http://127.0.0.1:9001/api/metrics" | python3 -c "import json,sys; print(json.load(sys.stdin).get('active_sessions'))"
```

## 2. P1 — 备份双库（人工，5 分钟）

```bash
cd /opt/nursing-vp-sim            # prod 部署目录
mkdir -p backups
docker exec nursing-db         pg_dump -U nursing -d nursing_vp -Fc > backups/prod-$(date +%Y%m%d-%H%M).dump
docker exec nursing-db-staging pg_dump -U nursing -d nursing_vp -Fc > backups/staging-$(date +%Y%m%d-%H%M).dump
ls -lh backups/
```

两份 dump 都留档；**prod 的 dump 是回滚用的**（即使它是空壳）。

## 3. P2 — 灌库 + 单实例起栈（人工，15 分钟，**这是唯一不可秒回退的一步，靠 P1 备份兜底**）

```bash
cd /opt/nursing-vp-sim
VER=<已验证通过的 tag，例如 2026.09.14-1>

# 3.1 停 prod 应用（保留库容器）
docker compose -f docker-compose.yml --env-file .env stop backend frontend

# 3.2 恢复 staging 数据到 prod 库（--clean 会重建对象，故务必先完成 P1）
docker exec -i nursing-db pg_restore -U nursing -d nursing_vp \
  --no-owner --clean --if-exists < backups/staging-<时间戳>.dump

# 3.3 校验（与 staging 一致 + 无遗留连接）
docker exec nursing-db psql -U nursing -d nursing_vp -t -c \
  "select (select count(*) from users), (select count(*) from training_records), (select count(*) from messages);"
docker exec nursing-db psql -U nursing -d nursing_vp -t -c "select version_num from alembic_version;"

# 3.4 起单实例（deploy.yml 平时会自动做这件事；此处手工等价）
IMAGE_VERSION=$VER docker compose -f docker-compose.yml --env-file .env up -d --remove-orphans
# 3.5 迁移到最新 head（本次修复批次可能新增迁移）
docker compose -f docker-compose.yml --env-file .env run --rm --no-deps backend alembic upgrade head
```

### 业务冒烟（必须做完整链路，不能只看 `/api/health`）

1. `https://iomt.205716.xyz` 登录（用 staging 的账号）
2. 新建一次训练 → 对话 3~5 轮 → 结束 → 等待评分 → 打开结果页（评分、轨迹图、证据联动）
3. `curl "https://iomt.205716.xyz/api/diagnose?token=$DIAGNOSE_TOKEN"` → `summary.status` 为 `healthy|degraded`（`sessions.active` 为 DB 进行中训练数，是会话数的规范字段），且历史错误数不再恒为 0（本轮修复项）

### 迁移时会顺带修复的存量数据损伤（已实测）

2026-09-14 对真库只读盘点发现：`cases` 共 13 行，其中 **11 个内置病例全部缺 `tools`**（查体/护理记录配置被教师端保存静默抹掉，P0 缺陷的存量后果），且 `#4/#5/#10` 的 `example_dialogues`/`present_illness` 落后于仓库版本。

`seed_all()` 在每次启动都跑「按 name 收敛」：无指纹的旧行视为可覆盖 → **第一次启动就会把 11 个病例的 `tools` 回填并写入内容指纹**。因此：

- 迁移后请**确认启动日志**出现病例覆盖告警，并抽查 `docker exec nursing-db psql -U nursing -d nursing_vp -t -c "select count(*) from cases where case_data ? 'tools';"` → 期望 11
- 已带指纹且与内容不符的行 = 教师改动，**永不静默回滚**（设计约定，请勿在迁移后手工覆盖）

## 4. P3 — 域名收敛（人工，5 分钟）— 已完成（2026-09-14）

`deploy/nginx/test.205716.xyz.conf` 改为 301 跳转到正式域（保留 vhost，避免旧书签 404）：

```nginx
server {
    listen 443 ssl http2;
    server_name test.205716.xyz;
    # ... 保留 ssl 证书段 ...
    return 301 https://iomt.205716.xyz$request_uri;
}
```

```bash
sudo nginx -t && sudo nginx -s reload
```

## 5. P4 — 退役 staging 栈与旧配置（人工，10 分钟）

```bash
# 5.1 停并删除 staging 三件套（库卷先留 7 天冷备） —— 已完成
docker rm -f nursing-backend-staging nursing-frontend-staging nursing-db-staging
# 5.2 确认无引用后再删卷（含早期项目名残留的第三只卷） —— 待人工，见 §9（7 天冷备期结束后）
docker volume ls | grep nursing
docker volume rm nursing-vp-staging_nursing_staging_pg_data nursing-vp-staging_nursing_staging_logs
docker volume rm nursing-vp-sim_db_data          # 早期项目名残留的空卷
# 5.3 清理旧镜像 —— 待人工，见 §9（同上，待冷备期结束）
docker image prune -a --filter "until=168h"
```

> 当前状态：staging 三个容器已删除；两只 staging 卷与早期残留空卷 `nursing-vp-sim_db_data`
> **刻意保留**作为 7 天冷备（至 2026-09-21），旧镜像同理；冷备期内可随时重挂回退。

文档/规则同步（**必须做，否则运维手册与现实矛盾**）—— 本轮已全部完成：

- `AGENTS.md`：部署段落在单实例收敛时改为「单实例 + `production` 环境审批」，2026-09-14 再按实际机制改写
  （`production` 未配 Required reviewers → tag 推送即发版，无审批步骤）
- `docs/09-operations.md`：删除 staging 段落（流水线表、发布流程、回滚、环境参数、端口、容器名、日志与备份命令）
- `docs/09-operations.md` 的「Docker 容器资源上限」条目：已改为「已配置」（compose `mem_limit`）
- `.github/workflows/archive/README.md`：记录归档原因、恢复方式，以及 `deploy/docker-compose.staging.yml` 的删除
  （2026-09-18：整个 `archive/` 已删除 —— GitHub 本就不加载子目录，留着只是陈旧通知步骤的来源）
- 其余同步：`README.md` / `docs/00-dev-onboarding.md` / `docs/01-architecture.md` / `docs/03-database.md` /
  `CONTRIBUTING.md` / `AGENTS.md`（诊断端口）/ `docs/12-patient-presentation-layer.md` /
  `docs/ops/*` 运维手册（backup-restore、server-recovery、llm/tts-troubleshooting、incident 记录）
- 死配置与脚本：删除 `deploy/docker-compose.staging.yml`；`rollback.sh` / `db-backup.sh` / `db-restore.sh`
  的 `staging` 分支改为**快速失败**；`deploy/monitor/`（`_env.py` + `daily_report.py`）改为单实例日报；
  `prune-images.sh` / `docker-cleanup.sh` 去掉 staging 专用分支；`.husky/pre-push` 与
  `commit-format.yml` 注释指向 `deploy.yml`；`frontend` 展示页文案与 `package.json` 报告链接改指正式域
  （2026-09-18：`deploy/monitor/` 已整体迁出本仓 → 运维仓 `server-ops`（本机 git，不上 GitHub），CI 不再向 `/opt/monitor` 投递）

## 6. P5 — 可选：同位预览（保留"敢试错"的能力，但不是第二套栈）

```bash
# 在 9002 起上一版镜像做冒烟，不接公网域名
IMAGE_VERSION=<上一版> docker run -d --name nursing-preview --network host \
  -e DATABASE_URL=...  ghcr.io/fire-disposal/nursing-vp-sim-backend:<上一版>
```

比维护第二套 DB+后端+前端便宜得多，且不产生"两个库谁是真相"的问题。

## 7. 回退路径（每一步都能退）

| 阶段 | 回退方式 | 代价 |
|---|---|---|
| P0–P1 | 无需回退（只读/只备份） | 0 |
| P2 灌库后起栈失败 | `pg_restore` 回 P1 的 prod dump + 用旧 tag 起栈 | ~10 分钟 |
| P2 起栈成功但业务异常 | `bash deploy/rollback.sh --env prod --yes <上一版>`（自动含备份 + 健康检查） | ~5 分钟 |
| P3 域名收敛后异常 | 冷备期内可重挂 staging 卷、把 `test.205716.xyz.conf` 临时改回反代 9080/9081 并恢复 staging 栈 | ~10 分钟 |
| P4 之后 | staging 卷保留 7 天，可重挂；CI 归档目录 `git mv` 回顶层即恢复旧流水线 | ~15 分钟 |

## 8. 顺带收益

- 内存：回收 1 套后端（2 worker ≈ 232 MB）+ master（30 MB）+ 1 个 postgres（66 MB）≈ **330 MB**
- 单实例建议 `UVICORN_WORKERS=1`（异步应用，低流量期），再省 ~120 MB（`mem_limit` 本轮已加）
- `llm_call_logs`（10 875 行）是评测语料，**归档而非删除**

## 9. 待人工项（收尾清单）

P0–P4 已完成，剩余动作全部需要正式服 / 仓库设置权限，**不由 Agent 执行**：

| # | 事项 | 位置 | 说明 |
|---|------|------|------|
| 1 | ~~`production` 环境加 Required reviewers~~ **已决：不加** | 仓库 Settings → Environments → `production` | 决策：保持无审批闸门，tag 推送即发版（`deploy.yml` / `rollback.yml` 不再等待批准）。tag 只由人工/已验收的改动推送，文档已同步为实际机制 |
| 2 | 7 天后（≥ 2026-09-21）清理冷备卷与旧镜像 | 线上服务器 | `docker volume rm nursing-vp-staging_nursing_staging_pg_data nursing-vp-staging_nursing_staging_logs`；`docker image prune -a --filter "until=168h"` |
| 3 | 清理早期残留空卷 `nursing-vp-sim_db_data` | 线上服务器 | `docker volume ls` 确认无引用后删除（早期项目名遗留，与本次迁移无关） |

## 9. 2026-09-14 事故记录：iomt 证书过期（HTTPS 不可用）

**现象**：`https://iomt.205716.xyz` 浏览器报证书过期；`test.` 域名仍指向另一站点的旧 vhost。

**根因（两条独立）**
1. **证书 SAN 含无 vhost 的域名**：`iomt` 证书 SAN = `iomt` + `test` + `claw`，而 certbot renewal 的 `webroot_map` 只映射了 `claw.205716.xyz`，该域名没有服务它的 vhost → HTTP-01 挑战必然失败。`/var/log/letsencrypt` 在 2026-09-13 20:14 已记录 `Failed to renew certificate iomt.205716.xyz: Some challenges have failed`，**但没有任何告警**，证书于 2026-09-14 02:53Z 到期。
2. **`.bak` 文件被 nginx 加载**：手工改 vhost 时留下的 `sites-enabled/test.205716.xyz.conf.bak-*` 会被 `include sites-enabled/*` 一起加载（重复 server_name + 指向已删除容器的 `proxy_pass 9080/9081`）。已移到 `/root/nginx-archive/`。

**处置**
- 重签证书，SAN 缩到 **仅 `iomt.205716.xyz`**（`certbot certonly --cert-name iomt.205716.xyz --webroot -w /var/www/html -d iomt.205716.xyz`），新证书有效 90 天；
- `test.205716.xyz` **不特判**：删除其 vhost，由主机级 `/etc/nginx/conf.d/00-catch-all.conf`（`default_server`）兜底 —— HTTP 一律 404、HTTPS 在 TLS 阶段拒绝握手；未知/废弃域名（含 `claw.205716.xyz`）同样被拒，不会回落到其它站点；
- 移除仓库里的 `deploy/nginx/test.205716.xyz.conf`（该文件已无对应线上配置）。

**遗留改进（未做）**
- 证书续期缺**校验与告警**：建议服务器级加 `certs.yaml`（cert → domains → vhost → webroot）+ `cert-check`（校验 SAN 与实际 vhost/webroot 一致、<14 天且续期不可行即告警），并接进 `/opt/server-ops/monitor` 的钉钉通道；所有证书统一挂 `--deploy-hook "systemctl reload nginx"`。
- **域名退役清单**（本次即违反）：删 vhost ＋ 从所有证书 SAN 移除 ＋ 从 renewal `webroot_map` 移除。此三条应写入 `docs/09-operations.md`。
- 注意 `nginx -t` 失败时 `nginx -s reload` 会静默保留旧配置（软失败）。`deploy.yml` 的 nginx 下发已改为
  「暂存 → 备份 → 安装 → `nginx -t` → reload，任一步失败即恢复原配置并以非零退出」，人工操作也应按同一顺序。
