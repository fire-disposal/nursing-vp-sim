# 从这里开始

> 如果你是第一次接触这个项目，从这里开始。不需要会编程，只要会用电脑就能参与。

---

## 一、这个项目是做什么的？

这是一个**护理学生练习问诊的网站**。

学生打开网页，和一个 AI 扮演的"虚拟病人"打字聊天，练习怎么问病史。聊完之后，AI 自动打分——评价学生问了哪些关键问题、沟通方式好不好。老师可以看到每个学生的成绩，手动调整评分。

```
学生 → 打字问"您哪里不舒服？"
         ↓
AI 病人 → 回答"胸口闷，喘不上气，已经两天了"
         ↓
学生 → 继续追问、排查...
         ↓
结束 → AI 自动评分（14 项沟通 + 5 项病史采集）
         ↓
老师 → 查看成绩、逐项复核
```

---

## 二、三个重要概念

### 什么是 "Vibe Coding"？

**Vibe Coding = 用日常语言告诉 AI 你想要什么，AI 帮你写代码。**

不用学编程语言。你只需要用自然语言描述：

- "在这个页面加一个按钮，点了之后弹出'提交成功'"
- "把登录页的背景色改成蓝色"
- "修复评分结果有时候显示 NaN 的问题"

AI（本项目用 **OpenCode**）会理解你的意思，自动写出代码。你看了没问题就接受，有问题就让它改。

### 什么是 "自动 Lint"？

**自动 Lint = 代码格式自动整理。写代码时不用管空格、缩进、换行——系统自动帮你调成团队统一的风格。**

比如你写代码时缩进不一致、多了空行、没用统一的分号规则——保存文件时自动修复。如果有什么格式问题没法自动修，提交代码时会拦下来告诉你哪里不对。

你只管写逻辑，格式的事全自动。

### 什么是 "自动部署"？

**自动部署 = 代码推上去，网站自动更新。**

你在本地改好代码 → 提交 → 打一个版本号 → GitHub 自动把新版本放到测试网站（`test.205716.xyz`）。你在测试站验证没问题 → 去 GitHub 点一下按钮 → 正式站（`iomt.205716.xyz`）更新。

全程不需要碰服务器、不需要懂 Linux、不需要手动拷文件。

---

## 三、安装工具（一次性，15-20 分钟）

你需要在自己的 Windows 电脑上装这几样东西：

### 3.1 Git for Windows

> Git 是一个版本管理工具，帮你保存每次代码改动的"快照"。可以随时回到之前任何一次改动。

1. 打开 https://git-scm.com/downloads/win
2. 下载后双击安装
3. 安装过程中**一路点 Next**，保持默认选项即可
4. 安装完成后，在任意文件夹右键 → 出现 **"Git Bash Here"** 即成功

### 3.2 VS Code

> VS Code 是微软出的免费代码编辑器，用来打开项目、编辑文件、运行命令。

1. 打开 https://code.visualstudio.com/ ，下载 Windows 版
2. 双击安装，一路 Next
3. 安装完成后打开 VS Code，点左侧 Extensions 图标，搜索安装 **Chinese (Simplified) Language Pack** 即可切换中文界面

### 3.3 uv（Python 运行环境 + 包管理器）

> 本项目用 **uv** 自动管理 Python。不需要单独装 Python——uv 会在 `uv sync` 时自动下载项目需要的 Python 版本。这样所有人的 Python 版本完全一致，不会出现"我本地跑得好好的，你那边报错"的情况。

1. 打开 https://docs.astral.sh/uv/getting-started/installation/
2. Windows 用户选择 **"Install uv on Windows"** → 用 PowerShell 运行那一行命令（复制粘贴回车即可）
3. **重启 VS Code 让环境变量生效**（菜单栏 File → Exit → 重新打开项目）
4. 验证：终端输入 `uv --version`，看到版本号即成功

> `uv sync` 会在下一步自动下载并管理 Python 3.13。你不需要手动装 Python，也不用手动 `pip install` 任何东西。

### 3.4 Node.js

> Node.js 是前端用的运行环境，让网页能跑起来。

1. 打开 https://nodejs.org/ → 下载 **LTS 版本**（左边的按钮）
2. 双击安装，一路 Next
3. 验证：在 VS Code 终端输入 `node --version`，看到版本号即成功

### 3.5 PostgreSQL

> PostgreSQL 是数据库，存储用户、病例、聊天记录、评分等所有数据。

1. 打开 https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
2. 下载 **Windows x86-64** 版本（15.x）
3. 双击安装：
   - 一路 Next，到 **Password** 页面时**设置一个密码并记住它**（建议用 `postgres`）
   - 端口保持 **5432** 不变
   - 其他页面一路 Next
4. 安装完成后会自动打开 Stack Builder，**关掉它不需要**
5. **安装完后的关键步骤 — 创建项目数据库**：
   - 打开开始菜单 → 搜索 **pgAdmin 4** → 打开
   - 左侧浏览器展开 Servers → PostgreSQL 15 → 右键 Databases → Create → Database
   - 在 Database 字段填入 `vptest` → 点 Save
   - 左侧应出现 `vptest` 数据库

---

## 四、下载项目

**有 Git？** 在 VS Code 终端中：

```bash
git clone https://github.com/fire-disposal/nursing-vp-sim.git
cd nursing-vp-sim
```

**没有 Git？** 也可以直接下载：

1. 打开 https://github.com/fire-disposal/nursing-vp-sim
2. 点绿色的 **「Code」** 按钮 → **「Download ZIP」**
3. 下载后解压到某个文件夹
4. 打开 VS Code → File → Open Folder → 选择解压后的文件夹
5. 在 VS Code 菜单栏 → Terminal → New Terminal 打开终端

---

## 五、三步跑起来

在项目文件夹的终端中依次执行：

```bash
# 第一步：安装项目依赖（首次约 3-5 分钟）
npm install
cd backend && uv sync && cd ..
cd frontend && npm install && cd ..

# 第二步：配置环境变量
# 把 .env.example 复制一份叫 .env
# 打开 .env 文件，填两样东西：
#   SECRET_KEY=随便输一串长字符（比如乱敲一行字母数字）
#   DEEPSEEK_API_KEY=你的API密钥（后台管理里也可以配，先空着也行）
#   DATABASE_URL=postgresql://postgres:你设的密码@localhost:5432/vptest

# 第三步：启动
npm run dev
```

看到终端输出 `Vite` 和 `Uvicorn` 的字样没报错，就说明成功了。

打开浏览器 → 访问 http://localhost:3000 → 用 `admin` / `admin123` 登录。

---

## 六、试着改一点东西

确认环境跑通后，来做一个最简单的改动，体验一下开发的感觉：

1. 在 VS Code 里打开文件：`frontend/src/pages/DashboardHome.tsx`
2. 搜索 "欢迎" 这个词
3. 把它改成 "Hello, 世界！"
4. 按 Ctrl+S 保存
5. 回到浏览器 → 刷新页面 → 你会看到文字变成了你改的内容

**你刚刚完成了一次代码修改。** 不需要编译、不需要重启、刷新页面就能看到效果——这叫"热更新"。

---

## 七、用 OpenCode（AI 帮你写代码）

### 安装 OpenCode

在终端中运行：

```bash
npm install -g @anthropic/opencode
```

验证：`opencode --version`

### 安装 Superpowers Skills

OpenCode 本身只有基本能力，**Superpowers Skills** 给它提供一整套开发流程能力（需求分析 → 设计 → 实现 → 测试 → 审查）。需要单独装：

在 OpenCode 对话中告诉它：

> Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.opencode/INSTALL.md

它会自动拉取并完成配置。

### 第一次使用

在项目目录的终端中：

```bash
opencode
```

然后试试说：

> 在登录页加一行提示文字："忘记密码请联系管理员"

OpenCode 会：
1. 找到登录页的代码文件
2. 理解你的意图
3. 写出修改
4. 让你确认

你看了没问题就同意，有问题就让它改。这就是 **Vibe Coding** —— 用自然语言驱动 AI 写代码。

---

## 八、下一步读什么？

环境跑通了，改代码也试过了，接下来按照顺序读：

| 顺序 | 文档 | 时间 | 你会知道 |
|------|------|------|----------|
| 1 | **[GIT-GUIDE.md](GIT-GUIDE.md)** | 10 分钟 | 怎么提交代码（Emoji 格式）、怎么打版本号、怎么部署上线 |
| 2 | **[docs/00-dev-onboarding.md](docs/00-dev-onboarding.md)** | 15 分钟 | 项目结构、提交规范详情、Git 分支管理、CI/CD Actions |

想深入了解代码结构：

| 顺序 | 文档 | 说明 |
|------|------|------|
| 3 | [docs/07-polish-handoff.md](docs/07-polish-handoff.md) | 当前项目状态：哪些功能做好了，哪些还在改 |
| 4 | [docs/01-architecture.md](docs/01-architecture.md) | 代码怎么组织的，每部分干什么 |
| 5 | [docs/04-frontend.md](docs/04-frontend.md) | 前端有哪些页面、组件、路由 |

全部文档索引：[docs/README.md](docs/README.md)

---

## 九、快速参考卡片

```
┌─────────────────────────────────────────────────────────┐
│  下载项目                                                │
│  git clone https://github.com/fire-disposal/nursing-     │
│             vp-sim.git                                   │
│  或 GitHub → Code → Download ZIP                        │
├─────────────────────────────────────────────────────────┤
│  启动开发环境                                            │
│  npm install                                             │
│  cd backend && uv sync && cd ..                          │
│  cd frontend && npm install && cd ..                     │
│  编辑 .env（填 SECRET_KEY + DEEPSEEK_API_KEY）           │
│  npm run dev               ← 一键启动，打开 :3000        │
├─────────────────────────────────────────────────────────┤
│  提交代码                                                │
│  git add .                                               │
│  git commit -m "✨ feat: 描述你做了什么"                  │
│  git push                                                │
│  → Husky 自动检查格式 → 通过才提交                        │
├─────────────────────────────────────────────────────────┤
│  发新版本                                                │
│  npm run tag               ← 自动打版本号 → 测试服部署   │
│  GitHub Actions → Deploy to Production（手动触发）       │
├─────────────────────────────────────────────────────────┤
│  用 AI 写代码                                            │
│  opencode                  ← 启动 AI 助手                │
│  说你要做什么 → AI 帮你写 → 你确认                        │
└─────────────────────────────────────────────────────────┘
```
