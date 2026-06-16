# OpenClaw + 飞书协作基础设施设计

> 日期: 2026-06-16
> 状态: 已确认
> 目标: 在 nursing-vp-sim 服务器上部署 OpenClaw，通过飞书频道为团队提供 AI 辅助运维、错误反馈处理、代码贡献流水线

---

## 1. 背景与动机

当前 nursing-vp-sim 项目代码设计完善，但协作侧策略较少。唯一开发者即将实习，需要：

1. **飞书群内接收错误反馈**：团队成员发现问题时，@机器人即可报告，Agent 自动记录、排查、甚至修复
2. **AI 辅助运维**：Agent 可读日志、查容器状态，辅助排查服务器问题
3. **代码贡献流水线**：Agent 修复代码后提交 PR，开发者远程审核即可合入
4. **安全隔离**：Agent 不能直接合入 master，所有写操作在沙箱内完成

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        飞书群                                     │
│                                                                   │
│  成员报错 / @机器人提问    ←──WebSocket──→   多维表格（Bitable）    │
│                                                     │             │
│                                            · 问题跟踪表            │
│                                            · PR 审查表             │
└──────────────────────┬──────────────────────────┼─────────────────┘
                       │                          │
                       ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                OpenClaw Gateway (127.0.0.1:18789)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│  │ Feishu 频道   │  │ Bitable 工具  │  │  Webhook (PR事件)  │      │
│  │ (WebSocket)  │  │ (RW 表格)    │  │  POST /hooks/agent │      │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘       │
│         │                 │                    │                  │
│         ▼                 ▼                    ▼                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │                    Agent Session                      │        │
│  │  tools: exec(sandbox), read, write, edit, grep, glob   │        │
│  │  deny: gateway, cron, browser, canvas, nodes          │        │
│  └──────────────────────────────────────────────────────┘        │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              Docker Sandbox (per-session)              │        │
│  │  /workspace: git clone → 修改 → check → push PR       │        │
│  │  /project: 服务器代码 (只读)                           │        │
│  │  /var/log: 系统日志 (只读)                             │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
         │
         │ git push feat/xxx → gh pr create
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                      GitHub                                       │
│  Draft PR → CI(ruff+biome+tsc+test) → Ready → Review → Merge     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 服务器部署

### 3.1 环境约束

| 项 | 值 |
|---|---|
| OS | Debian 12 (bookworm) |
| CPU | 2 cores |
| RAM | 3.8 GiB total, ~2.4 GiB available |
| Disk | 50G (15G used) |
| Docker | 29.4.3 + Compose v5.1.3 |
| Node.js | 需安装 |

已运行的 10 个容器占用 ~758 MiB，留给 OpenClaw 约 1.5-2 GiB。

### 3.2 部署方式

Docker Compose，与 nursing-vp-sim 容器共存：

```yaml
# deploy/docker-compose.openclaw.yml
services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw-gateway
    restart: unless-stopped
    ports:
      - "127.0.0.1:18789:18789"
    volumes:
      - openclaw_config:/home/node/.openclaw
      - /opt/nursing-vp-sim:/project:ro
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - OPENCLAW_GATEWAY_PORT=18789
      - OPENCLAW_GATEWAY_BIND=loopback
      - OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
    networks:
      - nursing-vp-sim_default

volumes:
  openclaw_config:

networks:
  nursing-vp-sim_default:
    external: true
```

### 3.3 前置步骤

1. 安装 Node.js 24（宿主机需要，用于 sandbox 镜像构建）
2. 构建 sandbox 镜像：`docker build -t openclaw-sandbox:bookworm-slim`（需含 git、python3、bash、curl）
3. 启动：`docker compose -f deploy/docker-compose.openclaw.yml up -d`
4. 运行 onboarding：`docker exec -it openclaw-gateway openclaw onboard`

---

## 4. Agent 配置与安全模型

### 4.1 分层隔离

```
服务器文件系统                     沙箱容器（per-session）
┌──────────────────────┐         ┌─────────────────────────┐
│ /opt/nursing-vp-sim   │ ──ro──→│ /project （只读参考）       │
│ ├── AGENTS.md  ✓可读  │         │                          │
│ ├── .env        ✗不可达│         │ git clone → /workspace   │
│ └── logs/        ✓可读 │         │ 修改代码 → check → push  │
│                          │         └─────────────────────────┘
│ /var/log              │ ──ro──→│ /var/log （排错用）        │
│ Docker socket         │ ──ro──→│ docker ps/logs （运维）    │
└──────────────────────┘         └─────────────────────────┘
```

| 层 | 路径 | 权限 | 用途 |
|---|---|---|---|
| 参考代码 | /project | 只读 | 理解项目、回答提问、排查逻辑 |
| 日志/运维 | /var/log, docker.sock | 只读 | 查看日志、检查容器状态 |
| 写工作区 | /workspace | 读写 | git clone → 修改 → push PR |
| 秘密 | .env, SECRET_KEY 等 | deny_paths 拦截 | 绝对不可读 |

### 4.2 安全约束（硬编码）

| 约束 | 实现机制 |
|---|---|
| 不能直接合入 master | agent 没有 git 写入目标仓库权限；只能 push feature 分支 |
| 代码修改在沙箱内 | `sandbox.mode: "all"` + `scope: "session"` |
| 必须走 PR | GitHub 分支保护：master 禁止直接 push |
| 飞书 DM 需审批 | `dmPolicy: "pairing"` |
| 群内需 @ 才响应 | `requireMention: true` + `groupPolicy: "allowlist"` |

### 4.3 核心配置文件

```json5
// openclaw.json
{
  gateway: {
    port: 18789,
    bind: "loopback",
    auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
  },

  channels: {
    feishu: {
      appId: "${FEISHU_APP_ID}",
      appSecret: "${FEISHU_APP_SECRET}",
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      requireMention: true,
      tools: { bitable: true },
    },
  },

  agents: {
    defaults: {
      model: "anthropic/claude-sonnet-4-20250514",
      workspace: "/workspace",

      sandbox: {
        mode: "all",
        scope: "session",
        backend: "docker",
        workspaceAccess: "rw",
        docker: {
          network: "bridge",
          image: "openclaw-sandbox:bookworm-slim",
          binds: [
            "/opt/nursing-vp-sim:/project:ro",
            "/var/log:/var/log:ro",
            "/var/run/docker.sock:/var/run/docker.sock",
          ],
        },
      },

      tools: {
        deny: ["gateway", "cron", "browser", "canvas", "nodes"],
        exec: {
          host: "sandbox",
          security: "deny",
          ask: "always",
        },
        fs: {
          workspaceOnly: true,
          deny_paths: [
            "/project/.env",
            "/project/**/.env",
            "/project/**/secrets/**",
            "/project/**/SECRET_KEY",
          ],
        },
      },
    },
  },

  hooks: {
    enabled: true,
    token: "${OPENCLAW_HOOK_TOKEN}",
    path: "/hooks",
  },
}
```

---

## 5. 飞书集成

### 5.1 频道配置

- 传输模式：WebSocket（默认，持久连接）
- DM 策略：pairing（需 CLI 审批）
- 群策略：allowlist + requireMention
- 消息类型：文本、富文本、图片、文件

### 5.2 多维表格（Bitable）

**表1：问题跟踪**

| 字段 | 类型 | 说明 |
|---|---|---|
| 问题ID | 自动编号 | - |
| 标题 | 文本 | 必填 |
| 状态 | 单选 | 待确认 / 处理中 / 已修复 / 关闭 |
| 严重程度 | 单选 | P0紧急 / P1高 / P2中 / P3低 |
| 报告人 | 文本 | 飞书用户 |
| 关联PR | 链接 | GitHub PR URL |
| 描述 | 多行文本 | - |
| 创建时间 | 日期 | 自动填入 |

**表2：PR 审查**

| 字段 | 类型 | 说明 |
|---|---|---|
| PR编号 | 文本 | #123 |
| 标题 | 文本 | - |
| 来源 | 单选 | 人类 / OpenClaw |
| 状态 | 单选 | Draft → 待审核 → 已合入 / 已拒绝 |
| 关联问题 | 链接 | 关联表1记录 |
| CI状态 | 文本 | 通过/失败/运行中 |
| 创建时间 | 日期 | 自动填入 |

---

## 6. PR 工作流

### 6.1 Agent 代码修改流程

```
1. git clone <repo> /workspace
2. git checkout -b <type>/<slug>
3. 修改代码
4. npm run check (ruff + biome + tsc)
5. 本地跑测试: cd backend && pytest -m "not pg"
6. git add + git commit (emoji 格式)
7. git push origin <branch>
8. gh pr create --base master --title "emoji type: desc" --body "..."
9. 飞书回复 + 更新 Bitable
```

### 6.2 人类 Review 流程

```
GitHub PR 通知
  → 你远程查看 diff
  → CI 全部通过 (ruff + biome + tsc + pytest)
  → 批准: Squash merge → 删除分支 → Bitable 更新
  → 拒绝: Comment 反馈 → Agent 收到 → 修改 → push -f → 重新请求
```

### 6.3 GitHub 权限（Agent 细粒度 PAT）

| 权限 | 范围 | 用途 |
|---|---|---|
| `contents: write` | 仅此仓库 | push 分支 |
| `pull_requests: write` | 仅此仓库 | 创建 PR |
| `metadata: read` | 仅此仓库 | 读取仓库信息 |

### 6.4 分支保护

- master 分支：禁止直接 push，必须通过 PR
- PR 门禁：至少 1 approve + CI 全绿
- 合并方式：Squash merge

---

## 7. Agent 行为规范

### 7.1 飞书群交互

- 只响应 @机器人的消息
- 仅响应 allowlist 内的群
- 对未知错误：先查日志定位，能修复则修复，不能则记录到 Bitable

### 7.2 代码修改底线

- 所有代码修改在 sandbox 内完成
- 每次修改前 git clone 最新 master
- 修改完成后必须跑 `npm run check`（ruff + biome + tsc）
- 必须本地跑 `pytest -m "not pg"` 通过
- 绝不直接 push master，始终 push 到 feature branch
- 绝不执行 git merge，合入由人类通过 GitHub 完成

### 7.3 飞书交互示例

```
成员: @机器人 网页打不开，白屏

Agent:
  → 读取 /var/log/nginx/error.log 和相关后端日志
  → 分析错误原因
  → 沙箱内修复代码
  → git push feat/fix-xxx
  → gh pr create
  → Bitable 问题表新增记录
  → Bitable PR表新增记录
  → 飞书回复: "已定位：前端路由 404 错误，PR #129 已提交待审核
    问题记录: https://xxx.feishu.cn/base/xxx?table=tblXXX"
```

---

## 8. 资源预估

| 组件 | 预估内存 |
|---|---|
| OpenClaw Gateway (Docker) | 200-400 MB |
| Sandbox 容器 (per-session) | 100-200 MB |
| 总计 | 300-600 MB |

服务器可用 ~2.4 GiB，加上已运行容器的 758 MiB，总计约 1.1-1.4 GiB，安全。

---

## 9. 后续扩展

| 方向 | 说明 |
|---|---|
| GitHub Webhook → Agent | PR 事件（comment、review）自动通知飞书 |
| 定时巡检 | Cron job 定期检查服务器健康状态 |
| 自动部署通知 | 新版本部署后飞书群推送 changelog |
| 更多 AI agent provider | 可绑定 Claude Code / Codex 作为 session 后端 |
