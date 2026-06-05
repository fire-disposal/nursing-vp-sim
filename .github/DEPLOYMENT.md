# 部署流水线文档

## 设计理念

- **Staging 先行，生产跟进** — 所有变更先部署到 staging（`test.205716.xyz`）验证，再由手动触发提升到生产（`iomt.205716.xyz`）
- **生产严格版本控制** — 生产部署拒绝一切未经 staging 验证的版本
- **自动回滚** — 健康检查失败自动回退到上一版本
- **Nginx 入库** — 宿主机 Nginx 配置纳入仓库管理，每次部署同步，避免服务器手动配置漂移
- **维护模式零依赖** — 通过 Nginx 层文件标记实现，不依赖后端进程

---

## 流水线总览

| 文件 | 触发方式 | 用途 |
|------|---------|------|
| `staging.yml` | 推送 `v*` 标签 | 构建镜像 + 推送到 GHCR + 部署到预发布环境 |
| `cd.yml` | 手动触发 (`workflow_dispatch`) | 将已验证的版本从 staging 提升到生产 |
| `rollback.yml` | 手动触发 | 紧急回滚到任一历史版本 |
| `maintenance.yml` | 手动触发 | 开启/关闭指定环境的维护模式 |

**典型发布流程：**
```
1. 确保代码合入 master
2. 打 tag: npm run tag
3. 等待 staging 部署完成（自动）
4. 验证 test.205716.xyz 功能正常
5. 手动触发 cd.yml，输入相同版本号
6. 验证 iomt.205716.xyz
```

---

## 各流水线详解

### staging.yml — 构建 & 预发布部署

**触发：** 推送 `v*` 格式标签（如 `v2026.06.02-2`）

**步骤：**
1. 从标签提取版本号（去除 `v` 前缀）
2. 构建 `Dockerfile.backend` 和 `Dockerfile.frontend`，推送到 GHCR
3. SSH 到服务器：
   - scp nginx 配置到 `/etc/nginx/sites-enabled/` 和 `/etc/nginx/snippets/`
   - reload nginx
   - 拉取新镜像（最多 5 次重试）
   - `docker compose up -d` 启动容器
   - 30 次健康检查（每 2 秒），最长等待 60 秒
   - 不健康则自动回滚到上一个镜像

**部署内容：**
```
deploy/docker-compose.staging.yml → /opt/nursing-vp-sim/docker-compose.staging.yml
deploy/nginx/test.205716.xyz.conf → /etc/nginx/sites-enabled/test.205716.xyz.conf
deploy/nginx/snippets/block-scanners.conf → /etc/nginx/snippets/block-scanners.conf
deploy/nginx/snippets/maintenance.nginx.conf → /etc/nginx/snippets/maintenance.nginx.conf
deploy/nginx/maintenance.html → /opt/nursing-vp-sim/maintenance.html
```

**目标容器：** `nursing-backend-staging` (端口 9081), `nursing-frontend-staging` (端口 9080), `nursing-db-staging` (端口 5434)

---

### cd.yml — 生产部署

**触发：** 手动触发，需输入版本号

**步骤：**
1. SSH 到服务器：
   - scp nginx 配置（同 staging 的结构，使用生产域名配置）
   - scp `deploy/docker-compose.prod.yml` → `/opt/nursing-vp-sim/docker-compose.yml`
   - scp `rollback.sh`
   - reload nginx
2. **数据库备份** — `pg_dump` 导出到 `/opt/nursing-vp-sim/backups/pre-deploy-<timestamp>.sql`
3. **版本门禁** — 检查 staging 当前运行的版本是否等于输入版本，不匹配则拒绝
4. 拉取镜像 + 启动容器 + 健康检查 + 自动回滚
5. 写入 `.version-history`（保留最近 5 条）

**部署内容：**
```
deploy/docker-compose.prod.yml → /opt/nursing-vp-sim/docker-compose.yml
deploy/nginx/iomt.205716.xyz.conf → /etc/nginx/sites-enabled/iomt.205716.xyz.conf
deploy/nginx/snippets/block-scanners.conf → /etc/nginx/snippets/block-scanners.conf
deploy/nginx/snippets/maintenance.nginx.conf → /etc/nginx/snippets/maintenance.nginx.conf
deploy/nginx/maintenance.html → /opt/nursing-vp-sim/maintenance.html
rollback.sh → /opt/nursing-vp-sim/rollback.sh
```

**目标容器：** `nursing-vp-sim-backend-1` (端口 9001), `nursing-vp-sim-frontend-1` (端口 9000), `nursing-db` (端口 5433)

---

### rollback.yml — 紧急回滚

**触发：** 手动触发，需输入目标版本号

**步骤：**
1. SSH 到服务器
2. scp 最新 `rollback.sh` 到服务器（确保使用仓库最新逻辑）
3. 执行 `rollback.sh --yes <version>`

**rollback.sh 行为：**
- 读取 `.version-history`，查找目标版本
- 兼容两种历史记录格式（2 字段旧格式 + 4 字段新格式）
- 拉取目标版本镜像
- sed 替换 `docker-compose.yml` 中的镜像标签
- `docker compose up -d` 重启
- 30 次健康检查确认恢复成功

**镜像路径规则：**
- 新格式 (4 字段): 直接使用记录中的完整镜像路径
- 旧格式 (2 字段): 自动构造为 `ghcr.io/fire-disposal/nursing-vp-sim-{backend|frontend}:<version>`

---

### maintenance.yml — 维护模式开关

**触发：** 手动触发

**参数：**
| 参数 | 选项 | 说明 |
|------|------|------|
| `environment` | `staging` / `production` | 目标环境 |
| `action` | `enable` / `disable` | 开启或关闭 |

**原理：**
- 开启：`touch /opt/nursing-vp-sim/maintenance.on`（或 `maintenance.staging.on`），nginx 检测到该文件后所有请求返回 503 + 维护页面
- 关闭：`rm -f` 删除标记文件
- 每次操作后执行 `nginx -t && nginx -s reload`

**维护页面：** `/opt/nursing-vp-sim/maintenance.html` （完全自包含的 HTML 页面，无外部依赖）

---

## GitHub Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 说明 | 示例 |
|--------|------|------|
| `SSH_PRIVATE_KEY` | 服务器 SSH 私钥 | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SSH_HOST` | 服务器 IP 或域名 | `1.2.3.4` 或 `yecaoyun`（SSH config 别名） |
| `SSH_USER` | SSH 用户名 | `root` |

> `GITHUB_TOKEN` 由 GitHub Actions 自动提供，无需手动配置。用于 GHCR 镜像拉取。

---

## 服务器环境变量

服务器需在 `/opt/nursing-vp-sim/.env` 维护环境变量文件。`env_file: - .env` 会在 `docker compose up` 时加载。

### 必填

| 变量 | 说明 | 示例 |
|------|------|------|
| `ENV` | 运行环境 | `production` |
| `DATABASE_URL` | 容器内数据库连接串 | `postgresql://nursing:<pwd>@db:5432/nursing_vp` |
| `SECRET_KEY` | 应用密钥（JWT 签名 + 加密） | 随机字符串，至少 32 字符 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | `sk-...` |
| `CORS_ORIGINS` | 允许的跨域来源 | `https://iomt.205716.xyz,https://test.205716.xyz` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | 与 `DATABASE_URL` 中一致 |

### 可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 默认 LLM 模型 |
| `DEEPSEEK_MODEL_PRO` | `deepseek-v4-pro` | 评分专用模型 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `WECHAT_APPID` | — | 微信小程序 AppID |
| `WECHAT_SECRET` | — | 微信小程序 Secret |
| `SEED_ADMIN_USERNAME` | `admin` | 首次启动自动创建的管理员 |
| `SEED_ADMIN_PASSWORD` | `admin123` | 管理员初始密码 |
| `LLM_CONCURRENT_LIMIT` | `50` | LLM 并发上限 |
| `LLM_MAX_RETRIES` | `3` | LLM 调用最大重试次数 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | JWT 过期时间（分钟） |
| `LLM_CONFIG_JSON` | — | JSON 覆盖 per-purpose LLM 配置 |
| `CLEANUP_INTERVAL_SECONDS` | `30` | 自动结算检查间隔 |
| `LLM_REQUEST_TIMEOUT` | `90` | 单次 LLM 请求超时（秒） |

---

## 服务器目录结构

部署后的服务器文件布局：

```
/etc/nginx/
  sites-enabled/
    iomt.205716.xyz.conf         # 生产 nginx（由 cd.yml 部署）
    test.205716.xyz.conf         # 预发布 nginx（由 staging.yml 部署）
  snippets/
    block-scanners.conf          # 扫描拦截规则
    maintenance.nginx.conf       # 维护模式开关

/opt/nursing-vp-sim/
  .env                           # 环境变量（手动维护）
  docker-compose.yml             # 生产 compose（由 cd.yml 部署）
  docker-compose.staging.yml     # 预发布 compose（由 staging.yml 部署）
  rollback.sh                    # 回滚脚本
  maintenance.html               # 维护页面
  maintenance.on                 # 生产维护标记（由 maintenance.yml 控制）
  maintenance.staging.on         # 预发布维护标记
  .version-history               # 部署历史（最近 5 条）
  backups/
    pre-deploy-*.sql             # 部署前数据库备份
```

---

## 常见操作

### 首次部署到新服务器

1. 在服务器上创建目录结构和 `.env` 文件
2. 确保 nginx 已安装，`/etc/nginx/snippets/` 目录存在
3. 确保 Let's Encrypt 证书已配置（`/etc/letsencrypt/live/iomt.205716.xyz/`）
4. 配置 GitHub Secrets（SSH_PRIVATE_KEY, SSH_HOST, SSH_USER）
5. 打 tag 触发首次 staging 部署
6. 首次 nginx reload 可能因 `maintenance.nginx.conf` 不存在而跳过，第二次部署自动正常

### 手动开启维护模式

```bash
# 或通过 GitHub Actions: maintenance.yml → enable

# 生产
ssh user@server "sudo touch /opt/nursing-vp-sim/maintenance.on && sudo nginx -t && sudo nginx -s reload"

# 预发布
ssh user@server "sudo touch /opt/nursing-vp-sim/maintenance.staging.on && sudo nginx -t && sudo nginx -s reload"

# 关闭维护
ssh user@server "sudo rm -f /opt/nursing-vp-sim/maintenance.on && sudo nginx -t && sudo nginx -s reload"
```

### 跳过 staging 直接部署生产

一般不应这样做，但如果 staging 不可用：
1. 手动触发 `cd.yml`
2. 当检查到 "no staging running" 时会允许直接部署

### 查看历史版本

```bash
ssh user@server "cat /opt/nursing-vp-sim/.version-history"
```
