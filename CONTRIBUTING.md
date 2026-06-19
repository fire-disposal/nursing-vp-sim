# 团队协作指南

## 分支模型

Trunk-Based Development — 短生命周期（<2天），频繁合入，无 release 分支。

```
master ──────────────────────────────────────────
  ├─ feat/xxx ──→ squash merge
  ├─ fix/xxx  ──→ squash merge
  └─ hotfix/xxx ──→ squash merge
```

## 分支命名

```
feat/<slug>           # 新功能
fix/<slug>            # 修 bug
refactor/<slug>       # 重构
docs/<slug>           # 文档
hotfix/<slug>         # 紧急修复
```

## 日常流程

```
git checkout master && git pull
git checkout -b feat/<slug>
# 写代码 → git commit（Emoji 格式）
git push origin feat/<slug>
# GitHub 创建 PR（可先 Draft）→ CI 通过 → Approve → squash merge
# 合入后删除远程分支
```

## PR 规范

**标题:** `<emoji> <type>: <描述>`（同 commit 格式，见 [AGENTS.md](AGENTS.md#commit-format)）

**门禁:**

| 条件 | 要求 |
|------|------|
| Review | 至少 1 人 Approve |
| CI | ruff + biome + tsc + pytest 全通过 |
| 合并 | Squash Merge（保持线性历史） |
| 体量 | ≤300 行，超量拆多个 PR |

**描述模板**: 使用 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)

## 验证门禁

```
git commit                  git push              GitHub PR
    │                           │                     │
    ▼                           ▼                     ▼
pre-commit                 pre-push              Actions CI
└─ 详见 AGENTS.md Hook Chain └─ hook 全链 + alembic roundtrip
```

完整钩子链路和推前验证命令见 [AGENTS.md#hook-chain](AGENTS.md#hook-chain)。

## Feature Flag

- **大特性**（跨多日）：用 flag 包裹分段合入，稳定后开 flag
- **小特性**（单日完成）：直接合
- **命名**: 与分支对应，如 `feat/xxx` → `xxx` flag
- **清理**: 功能稳定 1-2 周后提交移除 flag 的 PR

## 冲突处理

1. 合入前 `git fetch origin master && git rebase origin/master`
2. 涉及同一模块先沟通对齐，不单方面覆盖
3. Review 聚焦逻辑正确性，风格由 Biome 统一

## 部署流

| 操作 | 方式 |
|------|------|
| 测试服 | `pnpm run tag`（自动打 tag + push → staging 部署） |
| 正式服 | GitHub Actions → Deploy to Production |
| 回滚 | Actions → Emergency Rollback |
| 维护模式 | Actions → Maintenance Mode |

> 上生产前必须先经测试服验证。详见 [09-运维安全指南](docs/09-operations.md)。

## 最佳实践

1. commit 后 push → 创建 Draft PR → 继续完善 → 标记 Ready
2. 一个 PR 一个关注点，不混入无关变更
3. PR 存活不超过 2 天
4. Review 不过夜
5. Squash 合入后 PR 标题即为最终 commit message，请认真写
