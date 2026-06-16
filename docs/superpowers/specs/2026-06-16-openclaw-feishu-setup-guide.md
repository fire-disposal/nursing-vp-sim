# 飞书应用与多维表格配置指南

> 本文档供项目维护者手动操作。大部分步骤需要在飞书开放平台网页端完成（无法通过 API 自动化）。

---

## 一、创建飞书企业自建应用

### 1.1 登录开放平台

打开 [https://open.feishu.cn](https://open.feishu.cn)，使用飞书管理员账号登录。

### 1.2 创建应用

1. 进入「开发者后台」→「创建应用」
2. 选择「企业自建应用」
3. 应用名称：`Nursing VP 运维助手`
4. 应用描述：`虚拟患者训练系统运维助手，用于错误反馈与自动修复`
5. 上传应用图标（可选）
6. 点击「创建」

### 1.3 获取凭证

创建成功后，进入应用详情页：

1. 左侧菜单 →「凭证与基础信息」
2. 复制 **App ID**（格式：`cli_xxxxxxxxxxxx`）
3. 复制 **App Secret**（格式：一串字符，点击「显示」后复制）

> 这两个值后续填入 OpenClaw 配置的 `channels.feishu.appId` 和 `channels.feishu.appSecret`

---

## 二、配置应用权限

### 2.1 添加权限

左侧菜单 →「权限管理」，搜索并添加以下权限：

| 权限名称 | 权限代码 | 用途 |
|---|---|---|
| 获取群组信息 | `im:chat:readonly` | 读取群信息 |
| 获取与发送单聊、群组消息 | `im:message` | 收发消息 |
| 以应用身份发送消息 | `im:message:send_as_bot` | Bot 身份发送消息 |
| 查看、评论、编辑和管理多维表格 | `bitable:app` | 读写 Bitable |

### 2.2 确认权限

添加完成后，页面顶部会出现「批量开通」按钮，点击确认。

> 注意：部分权限需要管理员审批。如你不是管理员，需要联系管理员通过。

---

## 三、配置事件订阅（WebSocket 模式）

OpenClaw 飞书频道使用 WebSocket 模式接收消息，配置如下：

### 3.1 开启事件

左侧菜单 →「事件订阅」→「添加事件」：

搜索并添加以下事件：

| 事件名称 | 事件 key |
|---|---|
| 接收消息 | `im.message.receive_v1` |

### 3.2 连接模式

在「事件订阅」页面，确认连接模式选择「使用长连接（WebSocket）」。

> OpenClaw 的 Feishu 频道默认使用 WebSocket 模式，无需配置 HTTP 回调地址。

---

## 四、发布应用

### 4.1 创建版本

左侧菜单 →「版本管理与发布」→「创建版本」

- 应用版本号：`1.0.0`
- 更新说明：`初始版本：Nursing VP 运维助手`
- 可用性状态：选择「所有成员」

确认无误后点击「保存」。

### 4.2 申请发布

创建版本后，页面会出现「申请发布」按钮。点击后进入审批流程。

- 如果你有管理员权限：可以自助审批通过
- 如果没有：联系企业管理员在飞书管理后台审批

### 4.3 验证发布

发布成功后，在飞书中应该能搜到你的应用。

---

## 五、将 Bot 添加到飞书群

1. 打开目标飞书群
2. 点击群设置 →「群机器人」→「添加机器人」
3. 搜索「Nursing VP 运维助手」
4. 点击添加

### 5.1 获取群 ID（后续配置用）

1. 打开目标飞书群
2. 点击右上角菜单 →「设置」
3. 找到「群聊 ID」（格式：`oc_xxxxxxxxxxxx`）
4. 记录下来，后续填入 `channels.feishu.groupAllowFrom`

---

## 六、创建多维表格（Bitable）

### 6.1 创建 Base

1. 飞书桌面端 → 左侧导航「多维表格」→「新建多维表格」
2. 命名为「Nursing VP 运维面板」

### 6.2 获取 app_token

创建完成后，浏览器地址栏 URL 为：
```
https://xxx.feishu.cn/base/XXXXXXXXXXXXX?table=tblXXXXXXXX
```
其中 `XXXXXXXXXXXXX` 部分即为 `app_token`。记录下来。

> 如果在知识库或文档中嵌入，app_token 获取方式不同。优先在飞书云空间独立创建 Base。

### 6.3 创建表1：问题跟踪

1. 在 Base 中，将默认表重命名为「问题跟踪」
2. 从 URL 获取 `table_id`（格式：`tblXXXXXXXXXXXX`）
3. 按以下结构添加字段：

| 字段名 | 字段类型 | 必填 | 选项/格式 |
|---|---|---|---|
| 标题 | 多行文本 | 是 | - |
| 状态 | 单选 | 是 | 待确认、处理中、已修复、关闭 |
| 严重程度 | 单选 | 是 | P0紧急、P1高、P2中、P3低 |
| 报告人 | 文本 | 否 | - |
| 关联PR | 链接 | 否 | URL 类型 |
| 描述 | 多行文本 | 否 | - |
| 创建时间 | 日期 | 否 | 创建时自动填入 |

记录 `table_id`。

### 6.4 创建表2：PR 审查

1. 点击左下角「+」新建数据表，命名为「PR 审查」
2. 从 URL 获取 `table_id`
3. 按以下结构添加字段：

| 字段名 | 字段类型 | 必填 | 选项/格式 |
|---|---|---|---|
| PR编号 | 文本 | 是 | 如 "#128" |
| 标题 | 多行文本 | 是 | - |
| 来源 | 单选 | 是 | 人类、OpenClaw |
| 状态 | 单选 | 是 | Draft、待审核、已合入、已拒绝 |
| 关联问题 | 链接 | 否 | 关联问题跟踪表记录 |
| CI状态 | 文本 | 否 | 通过 / 失败 / 运行中 |
| 创建时间 | 日期 | 否 | 创建时自动填入 |

记录 `table_id`。

### 6.5 给应用授权访问 Base

1. 在多维表格右上角「...」→「更多」→「添加文档应用」
2. 搜索「Nursing VP 运维助手」
3. 添加为「可编辑」权限

---

## 七、创建 GitHub 细粒度 PAT

Agent 需要 GitHub PAT 来 push 分支和创建 PR。

### 7.1 创建 Token

1. 打开 [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. 点击「Generate new token」
3. Token name：`openclaw-nursing-vp-sim`
4. Resource owner：选择你的账号或组织
5. Repository access：选择「Only select repositories」→ 选择 `nursing-vp-sim`
6. 权限配置：

| 权限 | Access |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Metadata | Read-only (自动勾选) |

7. 点击「Generate token」，复制 token（格式：`github_pat_xxxxxxxx`）

> 这个 token 将在 OpenClaw onboarding 时配置，或在 openclaw.json 中配置为环境变量。

---

## 八、搜集汇总

完成以上步骤后，你应该拥有以下信息：

| 配置项 | 来源 | 格式示例 |
|---|---|---|
| FEISHU_APP_ID | 飞书应用凭证 | `cli_a7b3c4d5e6f8g9h0` |
| FEISHU_APP_SECRET | 飞书应用凭证 | `abc123...` |
| GROUP_CHAT_ID | 飞书群设置 | `oc_xxxxxxxxxxxx` |
| BITABLE_APP_TOKEN | 多维表格 URL | `XXXXbaseXXXX` |
| ISSUE_TABLE_ID | 问题跟踪表 URL | `tblXXXXXXXXXXXX` |
| PR_TABLE_ID | PR 审查表 URL | `tblXXXXXXXXXXXX` |
| GITHUB_PAT | GitHub 设置 | `github_pat_xxxxxxxx` |
| OPENCLAW_GATEWAY_TOKEN | 随机生成 | `openssl rand -hex 32` |
| OPENCLAW_HOOK_TOKEN | 随机生成 | `openssl rand -hex 32` |

---

## 九、部署命令速查

部署完成后常用命令：

```bash
# 查看 Gateway 状态
docker exec openclaw-gateway openclaw gateway status

# 查看飞书频道状态
docker exec openclaw-gateway openclaw channels status feishu

# 审批飞书 DM 配对
docker exec openclaw-gateway openclaw pairing list feishu
docker exec openclaw-gateway openclaw pairing approve feishu <CODE>

# 查看日志
docker logs -f openclaw-gateway

# 安全审计
docker exec openclaw-gateway openclaw security audit
docker exec openclaw-gateway openclaw security audit --fix

# 重启 Gateway
docker compose -f deploy/docker-compose.openclaw.yml restart
```
