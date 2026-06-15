# 团队协作指南

## 分支模型：Trunk-Based Development

基于主干开发，分支生命周期短（< 2天），合入频繁，冲突少。

```
master ──────────────────────────────────────────────────
  │         │                │
  ├─ feat/xxx ──→ PR ──→ squash merge
  ├─ fix/xxx  ──→ PR ──→ squash merge
  └─ hotfix/xxx ──→ PR ──→ squash merge（从 master 切出）
```

**为什么不是 Git Flow？** Git Flow（develop/release/hotfix 多分支）适合有固定发布周期的项目。本项目有 feature flag、tag 触发的 CI/CD、持续部署，Trunk-Based 更适合——分支短、常合入、部署频繁、无 release 分支维护负担。

## 分支命名

```
feat/<slug>           # 新功能     feat/patient-interaction-v2
fix/<slug>            # 修 bug     fix/score-nan
refactor/<slug>       # 重构       refactor/llm-router
docs/<slug>           # 文档       docs/setup-guide
hotfix/<slug>         # 紧急修复   hotfix/api-key-leak
```

## 日常流程

```
1. git checkout master && git pull
2. git checkout -b feat/<slug>
3. 写代码 → git commit（遵循 Emoji 格式）
4. git push origin feat/<slug>
5. GitHub 创建 PR（可先 Draft）
6. CI 通过 → 标记 Ready for Review
7. 至少 1 人 Approve → squash merge 到 master
8. 删除远程分支
```

## PR 规范

### 标题

遵循与 commit 相同的 Emoji 格式：`<emoji> <type>: <描述>`

### 描述模板

```markdown
## 变更说明
<!-- 改了什么，为什么 -->

## 测试
- [ ] 本地测试通过
- [ ] 新增测试已覆盖

## 截图（涉及 UI 时）
<!-- 拖入截图 -->

## 关联 Issue
Closes #
```

### 门禁

| 条件 | 要求 |
|------|------|
| Review | 至少 1 人 Approve |
| CI | 全部测试通过、Biome 无报错 |
| 合并方式 | Squash Merge（保持 master 线性历史） |
| 分支删除 | 合入后删除远程分支 |

### 体量控制

单个 PR 控制在 300 行以内。超过的拆成多个小 PR，通过 Feature Flag 控制未完成功能的暴露。

## 验证门禁（本地 → CI）

```
git commit                  git push              GitHub PR
    │                           │                     │
    ▼                           ▼                     ▼
Husky pre-commit           Husky pre-push         GitHub Actions
├─ Biome lint (staged)     ├─ tag 格式校验         ├─ ruff check
├─ commit-msg 格式校验      └─ alembic 双向回滚     ├─ biome lint
└─ 迁移规则检查                                      ├─ tsc --noEmit
(check-migration-autogen.js)                        └─ pytest + vitest
```

本地通不过的不要 push；CI 通不过的不要合入。

## Feature Flag 使用原则

项目已有 Feature Flag 系统。团队协作下：

- **大特性**（跨多日/多人开发）：用 flag 包裹后分段合入 master，功能稳定后再开 flag
- **小特性**（单日完成）：直接合，不用 flag
- **Flag 命名**：尽量与分支对应，如 `feat/patient-interaction-v2` → `patient_interaction_v2`
- **Flag 清理**：功能稳定 1-2 周后，提交移除 flag 代码的 PR，避免 flag 堆积

## 冲突处理

1. **先 rebase 后 push**：合入前 `git fetch origin master && git rebase origin/master`
2. **涉及同一模块先沟通**：冲突不解就找对方当面/语音对齐，不要单方面覆盖
3. **自觉 Review**：看到同事的 PR 主动 Review，Review 时重点关注逻辑正确性而非风格（Biome 已统一风格）

## 部署流

| 操作 | 命令 / 方式 |
|------|-------------|
| 部署测试服 | `pnpm run tag`（自动 tag + push → staging.yml） |
| 部署正式服 | GitHub Actions → Deploy to Production |
| 回滚 | Actions → Emergency Rollback / `ssh <host> bash rollback.sh` |
| 维护模式 | Actions → Maintenance Mode（Nginx 层，不依赖后端） |

> 版本门禁：上生产的版本必须先经过测试服验证。完整运维细节见 [09-运维安全指南](docs/09-operations.md)。

---

## 最佳实践

1. **提交先行于 PR 创建**：本地 commit 后 push → 创建 Draft PR → 继续 commit 完善 → 标记 Ready
2. **一个 PR 一个关注点**：别把 bug 修复和新功能塞进同一个 PR
3. **PR 存活不超过 2 天**：合入越频繁，冲突越少
4. **Review 不过夜**：当天收到的 Review 请求当天处理
5. **写清楚 commit message**：合入 squash 后，PR 标题就是最终的 commit message，请认真写
