# 告警邮件 → Agent 自动化修复系统设计

## 目标

收到服务器告警邮件 → 自动解析问题 → dispatch opencode agent → 诊断 + 修复 + 推送

## 链路

```
邮件服务器 (IMAP)
    │
    ▼
监控代理 (Arch Linux)
    ├─ 轮询 / IMAP IDLE 接收告警
    ├─ 解析邮件 → 提取关键信息
    └─ dispatch opencode subagent
         │
         ▼
    目标服务器 (yecaoyun)
         ├─ 拉日志
         ├─ 查状态 (docker, systemd)
         ├─ 定位根因
         └─ 修复 + 推送 tag
```

## 组件

### 1. 邮件监控器 (`alert-monitor.py`)

| 功能 | 实现 |
|------|------|
| IMAP 连接 | Python `imaplib`, 支持 SSL |
| 告警识别 | 主题/发件人/关键词匹配 |
| 防重复 | 标记 `\Seen`, 去重 ID |
| 超时保护 | `connect_timeout=15s`, 重试 3 次 |

### 2. 告警解析器 (`alert-parser.py`)

输入：邮件原始内容 → 输出：结构化任务描述

```
原始邮件 → 提取:
  - 服务名 (backend / frontend / db)
  - 错误类型 (health_unhealthy / http_5xx / oom)
  - 时间戳
  - 可执行动作 (查看日志 / 扩容 / 回滚)
```

解析规则写在 `alerts/rules.yaml` 中：

```yaml
alerts:
  - match:
      subject_prefix: "[ALERT]"
      body_contains: "unhealthy"
    action: "ssh yecaoyun 'docker logs --tail 50' && diagnose"

  - match:
      subject_prefix: "[ALERT]"
      body_contains: "OOM"
    action: "ssh yecaoyun 'docker stats && free -m'"
```

### 3. Agent Dispatcher (`agent-dispatch.sh`)

调用 `opencode` 或 `gh` 在指定仓库上启动 agent 会话：

```bash
opencode -p /repo/nursing-vp-sim \
  "收到告警: $TASK_DESC
   1. SSH 到 yecaoyun 查看日志
   2. 诊断根因
   3. 修复并推送"
```

### 4. systemd 服务

Arch Linux 端：

| 单元 | 用途 |
|------|------|
| `alert-monitor.service` | 长驻 IMAP IDLE 监听 |
| `alert-monitor.timer` | 回退轮询 (每 2 分钟) |
| `alert-monitor.path` | (可选) 文件触发 |

```
~/.config/systemd/user/
├── alert-monitor.service   # python alert-monitor.py
├── alert-monitor.timer     # OnUnitActiveSec=2min
└── alert-monitor.conf      # 环境变量 (IMAP 账号等)
```

## 数据流

```json
// 告警邮件
{
  "subject": "[ALERT] backend unhealthy on staging",
  "from": "monitor@205716.xyz",
  "body": "Service nursing-backend-staging is unhealthy at 2026-06-15T12:54:33Z"
}

// → 解析后任务描述
{
  "service": "backend",
  "host": "yecaoyun",
  "error": "container_unhealthy",
  "timestamp": "2026-06-15T12:54:33Z",
  "actions": ["docker_logs", "health_check"]
}

// → 生成的 agent prompt
"服务器 `yecaoyun` 上后端容器异常 (12:54)。
请 SSH 连接查看 `docker logs nursing-backend-staging --tail 50`,
诊断根因并修复后推送 tag。"
```

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| IMAP vs API | IMAP (imaplib) | 通用，不依赖特定邮件服务商 |
| 轮询 vs IDLE | 两者结合 | IDLE 低延迟 + fallback 轮询防断连 |
| agent 本地跑 vs 服务器跑 | Arch 本地跑 | 避免在目标服务器装 opencode |
| 任务描述语言 | 中文 + 结构化 | opencode agent 理解好 |

## 依赖

- Arch: `pacman -S python` (标准库已含 imaplib)
- opencode: 需在 Arch 上安装
- 目标服务器: SSH key 已配 (本地 `~/.ssh/config`)

## 下一步实现

- [ ] `scripts/alerts/rules.yaml` — 告警规则定义
- [ ] `scripts/alert-monitor.py` — IMAP 监听 + 解析 + dispatch
- [ ] `scripts/agent-dispatch.sh` — opencode 调用封装
- [ ] `~/.config/systemd/user/alert-monitor.*` — systemd 单元
- [ ] Arch 上安装 opencode + 配置仓库路径
