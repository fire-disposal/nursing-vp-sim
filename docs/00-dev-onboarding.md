# 00 — 参与开发快速指南

> 写给新加入项目的人。5 分钟完成开发环境搭建，10 分钟掌握提交规范和 OpenCode 辅助开发。

---

## 一、环境准备

### 1.1 前置条件

| 工具 | 版本要求 | 用途 | 安装方式 |
|------|---------|------|----------|
| Python | ≥ 3.13 | 后端 FastAPI | [python.org](https://www.python.org/downloads/) |
| Node.js | ≥ 18 LTS | 前端 + 根 npm scripts | [nodejs.org](https://nodejs.org/) |
| PostgreSQL | 15 | 数据库 | [EDB Installer](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)（Windows） |
| uv | 最新 | Python 包管理 | `pip install uv` |
| Git | ≥ 2.40 | 版本控制 | [git-scm.com](https://git-scm.com/) |
| DBeaver | 最新 | 数据库 GUI 管理（推荐） | [dbeaver.io](https://dbeaver.io/download/) |

> **为什么不用 Docker？** Docker 在 Windows 上通过 WSL2/Hyper-V 运行，会额外占用 2-4 GB 内存和磁盘 I/O 开销，且文件系统跨层性能损耗明显。本地安装 PostgreSQL 更轻量、启动更快、调试更直接。Docker 保留给生产部署场景使用。

> **Windows 用户注意**：确保 Git Bash 可用（安装 Git 时勾选 "Git Bash Here"），npm scripts 中部分 shell 脚本依赖它。

### 1.2 克隆与安装

```bash
# 1. 克隆仓库
git clone git@github.com:fire-disposal/nursing-vp-sim.git
cd nursing-vp-sim

# 2. 安装根依赖（husky + commitlint + concurrently）
npm install

# 3. 安装后端依赖
cd backend && uv sync && cd ..

# 4. 安装前端依赖
cd frontend && npm install && cd ..
```

### 1.3 终端配置（推荐）

#### 为什么要折腾终端？

终端是你和项目打交道的主战场——启动服务、运行测试、执行 git 命令、与 AI 编程助手对话，全都发生在终端里。Windows 自带的 PowerShell 或 cmd 功能简陋（单色文字、无 Tab、字体粗糙），一套好的终端配置能显著提升开发效率和心情：

- **看得快**：Git 分支、文件状态、命令耗时一行就看清
- **敲得少**：自动补全、命令历史搜索、多 Tab 切换
- **不费眼**：等宽字体 + 清晰的图标 + 舒适的配色

以下是推荐的"入门三件套"，安装总耗时约 5 分钟。

#### 1. Windows Terminal

Windows Terminal 是微软官方的现代终端模拟器，免费、开源，在 Microsoft Store 可直接安装。

**安装**：打开 Microsoft Store，搜索 "Windows Terminal"，点击安装。

**为什么比自带终端好？**
- **多标签页**：Ctrl+Shift+T 新标签，Ctrl+Tab 切换，再也不用开一堆窗口
- **GPU 加速渲染**：文字渲染平滑流畅，拖动窗口无撕裂感
- **多 Profile 支持**：同一个窗口里可以同时开 PowerShell、Git Bash、cmd、WSL
- **Ctrl+Shift+P 命令面板**：类似 VS Code，搜索即可执行操作

**配置建议**：安装后打开设置（Ctrl+,），在"外观"中将默认配色方案改为 **One Half Dark**（经典护眼方案）。

#### 2. Starship —— 让提示符说话

Starship 是一个跨 Shell 的提示符美化工具。安装后，你的终端提示符会从这样：

```
PS C:\Users\用户名\nursing-vp-sim>
```

变成这样：

```
nursing-vp-sim on  master [!] is 📦 v0.1.0 via 🐍 v3.13.5 took 2s
```

一行即看清：当前目录、Git 分支、是否有未提交改动、Node 版本、Python 版本、上条命令耗时——所有这些信息在你按下 Enter 的瞬间自动更新。

**安装**（PowerShell 管理员模式）：

```powershell
# 方式一：winget（Windows 11 自带）
winget install Starship.Starship

# 方式二：scoop（推荐包管理器，需先装 scoop.sh）
scoop install starship

# 方式三：直接下载
# 从 https://starship.rs 下载 exe，放到 PATH 目录下
```

**启用**（在 PowerShell 中执行）：

```powershell
# 编辑 PowerShell 配置文件
notepad $PROFILE
```

在打开的（或新建的）文件中添加一行：

```powershell
Invoke-Expression (&starship init powershell)
```

保存后重新打开终端即可看到效果。

> **Starship 极简配置**：Starship 开箱即用，无需配置文件。如果你对默认样式不满意，创建 `~/.config/starship.toml` 即可自定义。初学者建议先不改配置，用一周再根据自己的偏好微调。

#### 3. JetBrains Mono Nerd Font —— 图标不会"口"

当你安装 Starship 后，可能会发现提示符中有一些方框乱码 `□`——比如 Git 分支图标、Python 图标显示不出来。这是因为默认字体不包含编程图标。

**Nerd Font** 是一类打过"图标补丁"的等宽字体，在程序员常用字体（如 Fira Code、JetBrains Mono、Cascadia Code）的基础上内嵌了数千个开发用图标（Git、Docker、语言 Logo、电源符号等），让终端能正确显示这些特殊字符。

推荐 **JetBrainsMono Nerd Font**——JetBrains Mono 是 IntelliJ 团队设计的编程字体，字距清晰、l/I/1 高度可辨，搭配 Nerd Font 图标补丁后是终端配置的黄金选择。

**安装步骤**：

1. 前往 [nerdfonts.com](https://www.nerdfonts.com/font-downloads) 或 [GitHub Releases](https://github.com/ryanoasis/nerd-fonts/releases/latest)
2. 搜索 "JetBrainsMono"，下载 **JetBrainsMono.zip**
3. 解压，全选所有 `.ttf` 文件 → 右键 → **"为所有用户安装"**
4. 打开 **Windows Terminal** → 设置（Ctrl+,）→ 左侧选择你的默认 Profile（如 PowerShell）
5. 外观 → 字体 → 选择 **"JetBrainsMono Nerd Font"** → 保存

安装后重新打开终端，Starship 的图标应该全部正常显示了。

> **备选字体**：如果你更喜欢微软风格，**CaskaydiaCove Nerd Font**（基于 Cascadia Code）也是很好的选择，网感类似但风格稍有不同。

### 1.4 PostgreSQL 安装与初始化（Windows）

#### 什么是 PostgreSQL？

PostgreSQL（简称 PG）是一个开源的关系型数据库。本项目用它来存储用户、病例、训练记录、评分结果等所有业务数据。后端通过 SQLAlchemy（Python 的 ORM 框架）与它交互——你不需要写 SQL，但理解数据库的基本概念有助于调试。

#### 安装步骤

1. 前往 [EDB PostgreSQL 下载页](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)，选择 **Windows x86-64**，下载 **PostgreSQL 15.x** 安装包

2. 运行安装程序，一路 Next，注意以下关键步骤：
   - **安装目录**：保持默认 `C:\Program Files\PostgreSQL\15`
   - **组件选择**：必须勾选 **PostgreSQL Server** 和 **Command Line Tools**（pgAdmin 4 可选，不推荐——后续用 DBeaver 更好）
   - **数据目录**：保持默认 `C:\Program Files\PostgreSQL\15\data`
   - **密码**：设置 `postgres` 超级用户的密码。**建议用 `postgres`**（和项目默认配置一致，省去修改环境变量的麻烦）
   - **端口**：保持默认 `5432`
   - **区域设置**：保持默认 `Default locale`

3. 安装完成后，**PostgreSQL 会作为 Windows 服务自动启动**（服务名：`postgresql-x64-15`）。每次开机自动运行，无需手动启动。

#### 创建项目数据库

安装完成后需要创建本项目使用的数据库 `vptest`：

**方式一：使用命令行（最简）**

```powershell
# 打开 PowerShell 或 cmd，执行：
& "C:\Program Files\PostgreSQL\15\bin\createdb.exe" -U postgres vptest
# 输入密码后即可创建
```

**方式二：使用 DBeaver（图形界面）**

先按下一节 [1.5 DBeaver 连接配置](#15-dbeaver-连接配置) 完成安装和连接，然后在左侧导航栏中：
1. 右键数据库连接 → Create → Database
2. Database name 填 `vptest` → OK

> **数据库 vs 表的概念**：`vptest` 是一个**数据库**（Database），相当于一个独立的"仓库"。仓库里面有多个**表**（Table），比如 `users`（用户表）、`training_records`（训练记录表）等。表由后端启动时通过 Alembic 自动创建，你不需要手动建表。

### 1.5 DBeaver 连接配置

#### 什么是 DBeaver？

DBeaver 是一个免费的通用数据库管理工具（GUI）。它让你可以像使用 Excel 一样浏览数据库——查看表结构、浏览数据、执行查询、导入导出，全都有图形界面。开发过程中你经常需要：确认数据是否正确写入、手动修改测试数据、排查数据层面的 bug——这些用 DBeaver 比写 SQL 命令行要直观得多。

#### 安装与连接

1. 前往 [dbeaver.io](https://dbeaver.io/download/)，下载 **Windows 安装版**并安装（一路 Next 即可）

2. 首次打开后，创建数据库连接：
   - 点击工具栏的 **"新数据库连接"** 图标（蓝色插头+加号）
   - 选择 **PostgreSQL** → 下一步

3. 填写连接信息：

   | 字段 | 值 | 说明 |
   |------|-----|------|
   | Host | `localhost` | 数据库在你本机，所以填 localhost |
   | Port | `5432` | PostgreSQL 的默认端口 |
   | Database | `vptest` | 刚才创建的项目数据库 |
   | 用户名 | `postgres` | PostgreSQL 安装时创建的超级用户 |
   | 密码 | 你安装时设的密码 | PostgreSQL 安装时设置的密码 |

4. 点击 **"Test Connection"** 测试连接。首次会提示下载 PostgreSQL 驱动，点 Download 即可。

5. 测试成功后点击 **Finish**。左侧导航栏会出现数据库连接，展开可以看到 `vptest` → Schemas → public → Tables（初始为空，等后端第一次启动后会自动建表）。

> **为什么连接参数要这样填？** 这五个参数组合起来就构成了环境变量中的 `DATABASE_URL`：
> ```
> postgresql://postgres:密码@localhost:5432/vptest
>              └─用户─┘ └密码┘ └主机─┘ └端口┘ └数据库┘
> ```

### 1.6 环境变量配置

```bash
# 复制模板
cp .env.example .env
```

编辑 `.env`，至少填入以下必填项：

```bash
SECRET_KEY=<随机字符串，至少 32 字符>
DEEPSEEK_API_KEY=sk-your-deepseek-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vptest
```

> `DATABASE_URL` 各字段与 DBeaver 连接参数一一对应。如果你安装 PostgreSQL 时密码不是 `postgres`，记得修改 URL 中的密码部分。

> **完整变量清单**:
> 
> | 变量 | 默认值 | 说明 |
> |------|--------|------|
> | `SECRET_KEY` | (必填) | JWT签名密钥 + API Key 加密派生 |
> | `DEEPSEEK_API_KEY` | (必填) | 首次启动自动 seed 为默认 Provider |
> | `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/vptest` | 数据库连接 |
> | `LLM_CHAT_TIMEOUT` | 30 | 聊天请求超时(秒) |
> | `LLM_CHAT_MAX_TOKENS` | 512 | 聊天最大输出token |
> | `LLM_SCORING_TIMEOUT` | 120 | 评分请求超时(秒) |
> | `LLM_SCORING_MAX_TOKENS` | 2048 | 评分最大输出token |
> | `LLM_CONCURRENT_LIMIT` | 10 | LLM并发调用上限 |
> | `LLM_MAX_RETRIES` | 3 | LLM调用失败最大重试次数 |
> | `LLM_CONNECTION_POOL_SIZE` | 20 | HTTP连接池大小 |
> | `LLM_CONNECTION_KEEPALIVE` | 10 | HTTP Keepalive连接数 |
> | `ACCESS_TOKEN_EXPIRE_MINUTES` | 480 | JWT过期时间(分钟) |
> 
> Provider、模型、定价等 LLM 参数均在教师管理面板「API 管理」中配置，无需环境变量。

### 1.7 启动开发

```
┌─────────────────────────┐
│ 1. 确保 PostgreSQL 运行  │  ← 开机自启的 Windows 服务，通常已在运行
├─────────────────────────┤
│ 2. 启动后端 :8000        │  ← 首次自动 Alembic 迁移 + seed 数据
├─────────────────────────┤
│ 3. 启动前端 :3000        │  ← Vite dev server，/api 代理到 8000
├─────────────────────────┤
│ 4. 打开 localhost:3000   │  ← 登录 admin/admin123
└─────────────────────────┘
```

**一键启动（推荐）**

```bash
npm run dev
```

自动并行启动前后端（蓝色=后端，绿色=前端），Ctrl+C 同时停止。

**分步启动**

```bash
# 1. 启动后端
npm run dev:backend
# → 输出: Uvicorn running on http://0.0.0.0:8000

# 2. 新开终端，启动前端
npm run dev:frontend
# → 输出: Local: http://localhost:3000/
```

> 不需要手动启动 PostgreSQL——安装时已注册为 Windows 服务，开机自动运行。可通过任务管理器 → 服务 → `postgresql-x64-15` 查看状态。

### 1.8 默认账号

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 教师 | admin | admin123 | 管理后台、评分复核 |
| 学生 | student1 ~ student5 | 123456 | 训练、查看成绩 |

### 1.9 环境验证

```bash
# 后端健康检查
curl http://localhost:8000/api/health        # → {"status":"ok"}

# 后端 API 文档
start http://localhost:8000/docs             # FastAPI 自动生成的 Swagger

# 前端是否能打开
start http://localhost:3000                  # 看到登录页面即可
```

### 1.10 常见坑

**Q: PostgreSQL 服务没在运行？**
```powershell
# 检查服务状态
Get-Service postgresql-x64-15

# 如果已停止，启动它
Start-Service postgresql-x64-15
```

**Q: 数据库连接失败（`DATABASE_URL` 相关错误）？**
1. 确认 PostgreSQL 正在运行：任务管理器 → 服务 → `postgresql-x64-15` → 状态应为"正在运行"
2. 确认数据库 `vptest` 已创建：用 DBeaver 连接，看左侧导航栏是否有该数据库
3. 确认密码正确：安装时设置的密码是否与 `.env` 中 `DATABASE_URL` 的密码一致

**Q: `npm run dev:backend` 报 `uv` 未找到？**
安装 uv：`pip install uv`，然后 `cd backend && uv sync`

**Q: 前端代理不通？**
确保后端在 8000 端口运行。Vite 配置 `frontend/vite.config.ts` 中 `/api` 代理到 `http://127.0.0.1:8000`。

**Q: 数据库想清空重来？**
用 DBeaver 连接后，右键 `vptest` 数据库 → 工具 → 执行脚本，运行：
```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```
然后重启后端，Alembic 会重新建表并 seed 默认数据。

---

## 二、提交规范（Husky 门卫体系）

### 2.1 三道门禁

```
git add . → git commit → git push
              │              │
         ┌────┴────┐   ┌────┴────┐
         │ pre-commit│   │ pre-push │
         │ Biome格式  │   │ Tag格式   │
         └────┬────┘   └────┬────┘
              │              │
         ┌────┴────┐        │
         │commit-msg│        │
         │Emoji校验 │        │
         └────┬────┘        │
              ▼              ▼
         通过则提交      通过则推送
```

| Hook | 触发时机 | 检查内容 | 失败后果 |
|------|---------|----------|----------|
| `pre-commit` | `git commit` 前 | Biome 格式化前端代码（lint-staged） | 自动修复并暂存 |
| `commit-msg` | 填写 message 后 | Emoji + type 格式 + commitlint 规则 | 拒绝提交，显示正确格式 |
| `pre-push` | `git push` 前 | 推送的 tag 格式是否为 `vYYYY.MM.DD-N` | 拒绝推送 |

### 2.2 Emoji 提交格式

**格式：** `<emoji> <type>: <描述>`

```
✅ 正确示例：
✨ feat: 添加患者对话评分功能
🐛 fix: 修复评分结果 JSON 解析错误
📝 docs: 更新部署文档
♻️ refactor: 重构 LLM 服务调用链
✅ test: 添加评分模块单元测试
🔀 merge: feature/rbac-classes-management

❌ 错误示例：
添加了评分功能              ← 缺少 emoji 和 type
fix scoring bug            ← 缺少 emoji
✨ feat                     ← 缺少描述
:feat: 添加功能            ← 缺少 emoji
```

### 2.3 完整类型表

| Emoji | Type | 何时使用 |
|-------|------|----------|
| ✨ | feat | 新功能 |
| 🐛 | fix | 修 bug |
| 📝 | docs | 改文档 |
| ♻️ | refactor | 重构（功能不变） |
| 🔧 | chore | 配置 / 依赖 / 杂项 |
| ✅ | test | 加测试 |
| 🎨 | style | UI / 样式 |
| 🚀 | ci | 部署 / CI 流程 |
| 📦 | build | 构建配置 |
| ⚡ | perf | 性能优化 |
| 🔀 | merge | 分支合并 |
| 🔒 | security | 安全相关 |
| 🗃️ | db | 数据库 / 迁移 |
| ⏪ | revert | 回退变更 |
| 🔥 | remove | 删除功能 / 代码 |

> 提交前自动运行 Biome 格式化前端代码，不用手动 format。提交后自动运行 commitlint 校验 type 枚举和格式，不匹配则拦截。

### 2.4 快速复制前缀

```
✨ feat:       🐛 fix:        📝 docs:
♻️ refactor:   🔧 chore:      ✅ test:
🎨 style:      🚀 ci:         📦 build:
⚡ perf:       🔀 merge:      🔒 security:
🗃️ db:         ⏪ revert:     🔥 remove:
```

---

## 三、OpenCode 辅助开发

### 3.1 前置：安装 OpenCode

OpenCode 是命令行 AI 编程助手，已集成本项目的 Skills 体系。

```bash
# 安装（全局）
npm install -g @anthropic/opencode

# 在项目目录启动
cd nursing-vp-sim
opencode
```

### 3.2 可用 Skills

本项目的 OpenCode 配置了以下 Superpowers Skills，无需额外配置即可使用：

| Skill | 用途 | 何时使用 |
|-------|------|----------|
| **brainstorming** | 创意设计 → 规范文档 | 开始新功能前，将想法变成设计 |
| **writing-plans** | 设计 → 实施计划 | 设计完成后，输出分步执行计划 |
| **executing-plans** | 按计划逐步实施 | 有执行计划后，逐步实现 |
| **test-driven-development** | 测试先行开发 | 实现任何功能或修 bug |
| **systematic-debugging** | 结构化调试 | 遇到 bug、测试失败 |
| **requesting-code-review** | 代码审查 | 完成任务或大特性后 |
| **receiving-code-review** | 响应审查意见 | 收到 code review 反馈后 |
| **finishing-a-development-branch** | 分支收尾 | 实现完成测试通过后 |
| **subagent-driven-development** | 并行独立任务 | 多个无依赖的并行任务 |
| **dispatching-parallel-agents** | 分发并行子任务 | 2+ 独立任务可同时推进 |
| **using-git-worktrees** | 隔离工作区 | 需要多个独立工作区时 |
| **verification-before-completion** | 完成前验证 | 声称完成/修复/通过前 |

### 3.3 典型开发场景

**场景 A：实现一个新功能**

```
1. 描述需求 → OpenCode 自动加载 brainstorming 设计功能
2. 设计确认 → OpenCode 调用 writing-plans 生成执行计划
3. 按计划执行 → 可选择 subagent 并行推进独立任务
4. 完成后 → verification-before-completion 跑测试验证
5. 提交代码 → 遵循 Emoji 格式，Husky 自动检查
```

**场景 B：修一个 bug**

```
1. 描述 bug → OpenCode 调用 systematic-debugging 分析
2. 定位根因 → OpenCode 给出修复方案
3. 确认修复 → 先写测试再修代码（TDD 可选）
4. 验证 → 跑测试确保无回归
5. 提交 → 🐛 fix: 修复XXX问题
```

**场景 C：代码审查**

```
1. 完成开发后 → requesting-code-review
2. OpenCode 检查代码质量、潜在问题
3. 修复问题后再次验证
```

### 3.4 与项目约定的协作

OpenCode 在本项目中会自动遵循以下约定：

- **提交格式**：生成的 commit 消息遵循 `<emoji> <type>: <描述>` 格式
- **语言约定**：文件名/变量名英文，用户可见文本中文
- **API 路径**：所有 API 以 `/api/` 为前缀
- **代码风格**：后端遵循 ruff 风格，前端遵循 Biome 风格
- **文档位置**：设计文档写入 `docs/superpowers/specs/`，实施计划写入 `docs/superpowers/plans/`
- **测试要求**：修改代码前理解现有测试，新增功能需补测试

### 3.5 快捷 NPM Scripts

除了 `npm run dev` 外，这些 scripts 也经常用到：

| Script | 作用 | 场景 |
|--------|------|------|
| `npm run dev` | 一键启动前后端 | 日常开发 |
| `npm run dev:backend` | 只启动后端 | 只改后端时 |
| `npm run dev:frontend` | 只启动前端 | 只改前端时 |
| `npm run tag` | 自动生成日期版本号并推送 | 发版 |
| `npm run tag:local` | 只生成本地 tag | 暂不推送 |
| `npm run db:migrate` | 执行数据库迁移 | 数据库变更后 |
| `npm run api:update` | 更新 OpenAPI spec + 生成 TS 类型 | 改 API 后 |
| `npm run api:update:all` | 更新所有 API 客户端（含小程序） | 改 API 影响小程序时 |

---

## 四、Git 管理规范

### 4.1 分支命名

```
主干:
  master                    ← 稳定分支，只通过 PR 合并

功能分支:
  feature/<描述>             ← 新功能，如 feature/rbac-classes-management
  fix/<描述>                 ← 修 bug，如 fix/score-nan
  refactor/<描述>            ← 重构，如 refactor/llm-service-chain

发布:
  vYYYY.MM.DD-N             ← tag，推送自动触发部署

热修复:
  hotfix/<描述>              ← 紧急修复，从 master 切出
```

### 4.2 日常开发流程

```
       master
         │
         ├── 切分支 ─────────────────────────┐
         │   git checkout -b feature/xxx       │
         │                                     ▼
         │                                 feature/xxx
         │                                     │
         │                          写代码 → commit → push
         │                                     │
         │                              GitHub 创建 PR
         │                                     │
         │                              Review → 通过
         │                                     │
         ◄────────── merge ───────────────────┘
         │
         ▼
      npm run tag → v2026.06.07-1
         │
         ▼
      Staging 自动部署
         │
         ▼
      你验证通过 → 手动触发 Production 部署
```

### 4.3 版本号与 Tag

**格式：** `vYYYY.MM.DD-N`

```
v2026.06.07-1    ← 2026年6月7日（第一个版本，N=1 ）
v2026.06.07-2    ← 当天第二个版本
v2026.06.07-3    ← 当天第三个版本
```

**快捷操作：**

```bash
npm run tag           # 自动计算版本号 → git tag → git push → 触发 Staging 部署
npm run tag:local     # 只创建本地 tag，不推送（手动审查后再 push）
```

> Tag 推送时 pre-push hook 自动校验格式和计数器，不合规的 tag 会被拦截。

### 4.4 PR 规范

```
PR 标题: 遵循 Emoji 格式
PR 描述:
  - 改了什么
  - 为什么改
  - 测试是否通过
  - 截图（涉及 UI 时）
```

### 4.5 版本发布流程（Staging → Production）

```
1. 代码合入 master
2. npm run tag → 自动部署到测试服 (test.205716.xyz)
3. 在测试服验证功能
4. GitHub Actions → Deploy to Production
   输入与测试服相同的版本号
5. 验证正式服 (iomt.205716.xyz)

⚠ 版本号必须与测试服当前版本一致，否则 CD 门禁拒绝
```

---

## 五、GitHub Actions 功能说明

### 5.1 流水线总览

| Action | 文件 | 触发方式 | 用途 |
|--------|------|---------|------|
| **Build & Deploy Staging** | `staging.yml` | 推送 `v*` tag（自动） | 构建镜像 → GHCR → 部署测试服 |
| **Deploy to Production** | `cd.yml` | 手动触发 (`workflow_dispatch`) | 测试服验证通过 → 提升到正式服 |
| **Emergency Rollback** | `rollback.yml` | 手动触发 | 紧急回滚到历史版本 |
| **Maintenance Mode** | `maintenance.yml` | 手动触发 | 开启/关闭维护页面 |

### 5.2 staging.yml — 构建 & 测试服部署

**触发条件：** 推送任何 `v*` 格式的 tag

**流程：**

```
git push origin v2026.06.07-1
        │
        ▼
1. 提取版本号（去 v 前缀）
2. 构建 Dockerfile.backend + Dockerfile.frontend
3. 推送到 GHCR (ghcr.io/fire-disposal/nursing-vp-sim-*)
4. SSH 到服务器：
   ├─ 同步 Nginx 配置 + reload
   ├─ 拉取新镜像（最多 5 次重试）
   ├─ docker compose up -d
   ├─ 健康检查（30 次 / 每 2 秒，最长 60 秒）
   └─ 失败 → 自动回滚到上一个镜像
```

**用时：** 约 2-3 分钟  
**部署目标：** `test.205716.xyz`

### 5.3 cd.yml — 生产部署

**触发条件：** 手动触发，需填入已在测试服验证的版本号

**流程：**

```
输入: 2026.06.07-1
        │
        ▼
1. SSH 同步 Nginx 配置 + docker-compose.yml + rollback.sh
2. 数据库备份 → backups/pre-deploy-<timestamp>.sql
3. ✅ 版本门禁：检查测试服当前版本 == 输入版本
   ├─ ✗ 不匹配 → 拒绝部署
   └─ ✓ 匹配 → 继续
4. 拉取镜像 + docker compose up -d + 健康检查
5. 写入 .version-history（保留最近 5 条）
6. 失败 → 自动回滚到上一版本
```

**用时：** 约 1-2 分钟  
**部署目标：** `iomt.205716.xyz`

> **版本门禁**确保所有上生产的版本必须先经过测试服验证，杜绝未经测试的部署。

### 5.4 rollback.yml — 紧急回滚

**触发条件：** 手动触发，需输入目标版本号

**两种操作方式：**

**方式一：GitHub Actions（推荐）**
```
Actions → Emergency Rollback → 输入版本号 → Run
```

**方式二：SSH 交互式**
```bash
ssh <user>@<host> "cd /opt/nursing-vp-sim && bash rollback.sh"
# 列出最近 5 次部署 → 数字选择 → y/n 确认
```

> 回滚使用 `.version-history` 中记录的历史版本，自动拉取对应镜像并重启。

### 5.5 maintenance.yml — 维护模式

**触发条件：** 手动触发，选择环境 + 操作

| 参数 | 选项 |
|------|------|
| 环境 | staging / production |
| 动作 | enable / disable |

**原理：** 在服务器创建/删除标记文件（`maintenance.on`），Nginx 检测到后所有请求返回 503 + 维护页面。不依赖后端进程，即使后端挂了也能正常展示。

```
开启维护: touch /opt/nursing-vp-sim/maintenance.on → nginx reload
关闭维护: rm /opt/nursing-vp-sim/maintenance.on    → nginx reload
```

### 5.6 一键操作速查

| 想做什么 | 操作 |
|----------|------|
| 部署测试服 | `npm run tag` |
| 部署正式服 | GitHub Actions → Deploy to Production → 输入版本号 |
| 回滚生产 | GitHub Actions → Emergency Rollback → 输入版本号 |
| 开启维护 | GitHub Actions → Maintenance Mode → enable |
| 关闭维护 | GitHub Actions → Maintenance Mode → disable |
| 查看历史 | SSH → `cat /opt/nursing-vp-sim/.version-history` |

---

## 六、测试

开发过程中请确保测试通过：

```bash
# 后端测试（pytest）
cd backend
uv run python -m pytest tests/ -v

# 前端测试（Vitest）
cd frontend
npx vitest run
```

> CI 流水线在 PR 时会自动运行全部测试。测试不通过则无法合并。

---

## 七、快速参考卡片

```
┌─────────────────────────────────────────────────────────┐
│  环境搭建                                                │
│  npm install && cd backend && uv sync && cd .. &&        │
│  cd frontend && npm install && cd ..                     │
│  cp .env.example .env     # 填写 SECRET_KEY + API_KEY   │
│  npm run dev              # 一键启动                      │
├─────────────────────────────────────────────────────────┤
│  提交规范                                                │
│  <emoji> <type>: <描述>                                  │
│  例: ✨ feat: 添加XXX功能                                 │
│       🐛 fix: 修复XXX问题                                │
├─────────────────────────────────────────────────────────┤
│  发版                                                    │
│  npm run tag              # 自动版本号 + push + 部署测试服│
│  GitHub Actions → Deploy to Production（手动）           │
├─────────────────────────────────────────────────────────┤
│  应急                                                    │
│  GitHub Actions → Emergency Rollback                     │
│  GitHub Actions → Maintenance Mode                       │
├─────────────────────────────────────────────────────────┤
│  OpenCode                                                │
│  opencode                 # 启动 AI 编程助手              │
│  说你要做什么 → Skills 自动匹配最佳工作流                 │
└─────────────────────────────────────────────────────────┘
```

## 进一步阅读

| 文档 | 说明 |
|------|------|
| [README.md](../README.md) | 项目总览 |
| [01-系统架构](01-architecture.md) | 技术栈与架构设计 |
| [02-API 接口文档](02-api-reference.md) | 完整 API 端点 |
| [09-运维安全指南](09-operations.md) | 生产运维、应急预案 |
| [GIT-GUIDE.md](../GIT-GUIDE.md) | Git/Husky/CI-CD 快速入门 |
| [.github/DEPLOYMENT.md](../.github/DEPLOYMENT.md) | 部署流水线详解 |
