# Git + Husky + CI/CD 快速入门

> 写给第一次接触这个项目的人。读完你能理解为什么提交代码有格式要求、为什么推送 tag 会自动部署、以及日常怎么操作。

---

## 一、你需要知道的三个工具

### Git —— 代码的"时光机"

你写代码 → `git commit`（存档）→ `git push`（上传云端）。

```
你的电脑                     GitHub（云端）
  │                             │
  │  git commit                  │
  ├──── 📸 存快照 ──────────→   │
  │                             │
  │  git push                   │
  ├──── 📤 上传 ───────────→   │
  │                             │
```

### Husky —— 提交时的"门卫"

在 `git commit` 和 `git push` 之间自动检查你的代码是否符合规范。不合格就拦下来。

```
你: git commit -m "..."
        │
        ▼
   ┌─────────┐
   │ Husky   │  检查: 格式对吗？变量泄露了吗？
   └────┬────┘
        │
   ✅ 通过 → 提交成功
   ❌ 失败 → 拒绝，告诉你怎么改
```

### CI/CD —— 代码的"自动传送带"

代码推到 GitHub 后，自动帮你测试、构建、部署。不需要手动操作服务器。

```
git push → GitHub Actions 自动触发
              │
              ├─ CI:  跑测试（158个，全部通过才放行）
              ├─ 构建: 打包成 Docker 镜像
              └─ CD:  部署到服务器
```

---

## 二、本项目的三条规则

### 规则 1：提交消息格式

每次 `git commit` 必须用 emoji + 类型 + 描述：

```
✅ 正确：
✨ feat: 添加患者对话评分功能
🐛 fix: 修复评分结果JSON解析错误
📝 docs: 更新部署文档
♻️ refactor: 重构LLM服务调用链

❌ 错误：
添加了评分功能           （缺少 emoji 和类型）
fix scoring bug         （缺少 emoji）
🐛 fix                   （缺少描述）
```

| Emoji | 类型 | 什么时候用 |
|-------|------|-----------|
| ✨ | feat | 加了新功能 |
| 🐛 | fix | 修了 bug |
| 📝 | docs | 改了文档 |
| ♻️ | refactor | 重构代码（功能不变） |
| 🔧 | chore | 改了配置、依赖 |
| ✅ | test | 加了测试 |
| 💄 | style | 改了 UI 样式 |
| 🚀 | ci | 改了部署流程 |
| 📦 | build | 改了构建配置 |
| ⚡ | perf | 性能优化 |

> 提交前会自动运行 Biome 格式化前端代码，不用手动 format。

### 规则 2：版本标签格式

发布新版本时，打一个日期标签：

```
v2026.06.02    ← 年月日（当天第一个版本）
v2026.06.02-2  ← 当天第二个版本
v2026.06.02-3  ← 当天第三个版本
```

快捷方式（自动计算下一个版本号）：

```bash
npm run tag          # 自动生成 v2026.06.02-N 并推送
npm run tag:local    # 只创建本地 tag，不推送
```

> 不合规的 tag 推不上去，pre-push hook 会拦住。

### 规则 3：Staging → Production 中转

版本**必须先在测试服验证**，通过后才能上正式服。

```
你: npm run tag → v2026.06.02-3
         │
         ▼ (自动)
   test.205716.xyz 🧪    测试服部署（60秒自动完成）
         │
         ▼ 你验证通过
   GitHub → Actions → "Deploy to Production"
         输入: 2026.06.02-3
         │
         ▼ (自动)
   iomt.205716.xyz 🚀    正式服部署

   ⚠ 版本号必须和测试服当前运行的一致，否则拒绝上线
```

---

## 三、日常开发流程

### 场景 1：修一个 bug

```bash
# 1. 切新分支
git checkout -b fix/score-nan

# 2. 改代码...

# 3. 提交
git add .
git commit -m "🐛 fix: 修复评分为NaN的问题"

# 4. 推送（Husky自动检查格式）
git push origin fix/score-nan

# 5. 去 GitHub 创建 PR → review → merge
```

### 场景 2：发一个新版本

```bash
# 1. 确保代码已经 merge 好

# 2. 打 tag（自动生成日期版本号）
npm run tag
# → 输出: v2026.06.02-3

# 3. 等 60 秒，check Staging
# 打开 https://test.205716.xyz 验证功能

# 4. 验证通过，上正式服
# GitHub → Actions → Deploy to Production → 输入 2026.06.02-3 → Run

# 5. 如果线上有问题，自动回滚到上一个版本
```

### 场景 3：紧急回滚

```bash
# GitHub → Actions → Rollback Server Deploy → 输入要回滚到的版本
```

---

## 四、两个环境的对比

| | 测试服 (Staging) | 正式服 (Production) |
|---|---|---|
| 域名 | `test.205716.xyz` | `iomt.205716.xyz` |
| 部署方式 | 推送 v* tag → 自动 | GitHub Actions 手动触发 |
| 数据库 | 独立（端口 5434） | 独立（端口 5433） |
| 谁用 | 开发人员验证 | 真实用户 |
| 挂了影响 | 没事 | 用户会看到 |
| 镜像 | 和正式服同一份 | 和测试服同一份 |

> 测试服和正式服用**完全相同的 Docker 镜像**。测试服验证过的，正式服一定是同一份代码。

---

## 五、常见问题

**Q: commit 被 Husky 拦住了怎么办？**
看错误提示，按格式改 commit message。最常见的错误是忘了 emoji 或类型不匹配。

**Q: push tag 被拦住了？**
tag 必须是 `vYYYY.MM.DD` 或 `vYYYY.MM.DD-N` 格式。用 `npm run tag` 自动生成就不会出错。

**Q: 测试服部署后怎么检查？**
打开 `https://test.205716.xyz`，或者 GitHub Actions 页面看 staging workflow 的日志（绿色 ✓ = 部署成功）。

**Q: 正式服部署失败了？**
自动回滚到上一个版本。去 Actions 页面看失败的日志，修好问题后重新部署。

**Q: `npm run tag` 提示 tag 已存在？**
正常——同一天多次发版时，自动递增 -N。例如已有 `v2026.06.02-1`，运行后生成 `v2026.06.02-2`。

**Q: 为什么要 emoji 提交？**
一眼看出每个 commit 的类型。你翻 git log 时立刻知道哪个是新功能、哪个是修 bug。

**Q: 本地怎么跑项目？**
```bash
npm run dev           # 同时启动前后端
npm run dev:backend   # 只启动后端 (localhost:8000)
npm run dev:frontend  # 只启动前端 (localhost:3000)
```

---

## 六、一图总结

```
写代码 → git commit -m "✨ feat: ..." → Husky检查 → 通过
                                                    │
                                               git push origin feature/xxx
                                                    │
                                              PR review → merge
                                                    │
                                          npm run tag 打版本
                                                    │
                                                    ▼
                                            Staging 自动部署
                                          test.205716.xyz 🧪
                                                    │
                                              你验证通过
                                                    │
                                    手动触发 Deploy to Production
                                                    │
                                                    ▼
                                            Production 部署
                                          iomt.205716.xyz 🚀
                                                    │
                                         自动健康检查 → 失败? → 自动回滚
```

---

## 七、记住三个命令就够了

```bash
git commit -m "✨ feat: 描述你做了什么"    # 提交（自动格式化前端代码）
npm run tag                                  # 打版本号并推送（自动触发测试服部署）
# GitHub Actions → Deploy to Production       # 手动触发正式服部署
```
