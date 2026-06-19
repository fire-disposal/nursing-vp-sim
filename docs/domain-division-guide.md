# Domain Division Guide — AI Parallel Audit & Fix 工作流

> 目标：将 nursing-vp-sim 按路由域划分为独立单元，支持 AI 子代理并行纵向审计和修复。
> 适用场景：代码质量审计、安全审查、域级重构、跨层一致性检查。

---

## 一、域划分总览

```
backend/routers/                  backend/contexts/        frontend/src/
                                                          
auth/ ─────── auth.py ────────   ────                     pages/Login.tsx
            security.py                                    stores/authStore.ts
                                                          api/auth.ts
                                                          api/axios-instance.ts

training/ ── contexts/training/router/chat.py ── training/                 engine/
            contexts/patient/exam.py  pipeline/                 components/training/
                                                           api/training.ts
                                                           api/chat.ts

scoring/ ─── session.py (25%)    training/                 engine/ScoreManager.ts
            stats.py              score_engine.py          pages/RecordDetail.tsx
                                  scoring_progress.py      api/stats.ts
                                                           panels/scoring-display/

qa/ ─────── qa.py ────────────   qa/                      pages/QA.tsx
                                                          api/qa.ts

admin/ ──── admin/base.py ───    ────                     pages/admin/*.tsx
            admin_api.py                                   components/teacher/*.tsx
            admin/practices.py                             api/* (assignments, etc.)
            admin/cases.py

cases/ ──── cases.py ─────────   ────                     pages/CaseSelect.tsx
            admin/cases.py                                 api/cases.ts
            admin/practices.py                             api/practices.ts
                                                          api/assignments.ts
```

### 共享文件规则

| 文件 | 所属域 | 共享规则 |
|------|--------|----------|
| `session.py` | training + scoring | 训练流程→training 域，评分/复核→scoring 域。其他域只读 |
| `models.py` | 全局 | 所有域可读，修改时通知各域持有者 |
| `schemas.py` | 全局 | 所有域可读，修改时通知各域持有者 |
| `feature_flags.py` | training | 对 scoring/admin 只读 |

---

## 二、域级并行工作流

### 2.1 准备阶段

```bash
# 1. 确定本次覆盖的域
DOMAINS="auth training scoring qa admin cases"

# 2. 验证域边界无重叠
#    检查共享文件清单，确保没有两个域同时写同一文件
```

### 2.2 派发子代理

```markdown
# 对每个域，按此模板构造 prompt：

## 你的域: [域名]
## 覆盖文件清单:
- backend/routers/[domain].py
- backend/contexts/[domain]/**/*.py
- frontend/src/pages/[domain]*.tsx
- frontend/src/api/[domain]*.ts
- frontend/src/components/[domain]/**/*.tsx

## 共享文件（只读不可写）:
- backend/models.py (查看引用，不改)
- backend/core/config.py (查看引用，不改)

## 检查项:
1. 前后端类型一致性（OpenAPI schema ↔ frontend types）
2. 错误处理完整性（loading/empty/error three states）
3. 资源清理（event listener、timer、AbortController）
4. 安全边界（权限检查、输入验证、SQL 注入）
5. 竞态条件（race condition、double-submit、stale closure）

## 输出格式:
按 🔴Critical / 🟠High / 🟡Medium 分级，每项标注 文件:行号
```

### 2.3 修复阶段

```markdown
# 对每个域的 Critical + High 问题派发修复代理

## 你的域: [域名]
## 修复任务:
- [issue 文件:行号] [修复描述]
- [issue 文件:行号] [修复描述]

## 约束:
- 不修改共享文件（只读列表）
- 不修改其他域的文件
- 修改后运行域级验证:
  - `pnpm run check:full`（ruff + ty + biome + tsc + pytest）
  - 或分步: `pnpm run check:backend` + `pnpm run check:frontend`
```

### 2.4 集成验证

所有域修复完成后，派发一个集成检查代理：

```markdown
## 全域集成检查

## 检查项:
1. 全量检查通过: `pnpm run check:full`
2. 无未提交文件: `git status --short`
3. 提交信息符合 emoji 格式
```

---

## 三、域映射表（程序化引用）

```yaml
# domain-map.yml — 自动生成用
domains:
  auth:
    backend:
      - routers/auth.py
      - core/security.py
      - core/envelope.py
      - middleware/rate_limits.py
    frontend:
      - pages/Login.tsx
      - stores/authStore.ts
      - api/auth.ts
      - api/axios-instance.ts

  training:
    backend:
      - contexts/training/router/chat.py
      - contexts/patient/exam.py
      - contexts/training/pipeline/**/*.py
      - contexts/training/router/session.py (training 部分)
    frontend:
      - engine/TrainingEngine.tsx
      - engine/StreamManager.ts
      - engine/PatientProvider.tsx
      - engine/PluginContext.tsx
      - components/training/ChatArea.tsx
      - components/training/ChatDisplay.tsx
      - components/training/ChatInput.tsx
      - components/training/WelcomeScreen.tsx
      - components/training/TrainingHeader.tsx
      - components/training/PanelHost.tsx
      - api/training.ts
      - api/chat.ts

  scoring:
    backend:
      - contexts/training/score_engine.py
      - contexts/training/_scoring_validation.py
      - contexts/training/scoring_progress.py
      - contexts/training/router/scoring.py
      - contexts/training/router/session.py (scoring 部分)
      - routers/stats.py
    frontend:
      - engine/ScoreManager.ts
      - pages/RecordDetail.tsx
      - pages/History.tsx
      - pages/DashboardHome.tsx (stats 部分)
      - api/stats.ts
      - components/training/panels/scoring-display/

  qa:
    backend:
      - contexts/qa/**/*.py
    frontend:
      - pages/QA.tsx
      - api/qa.ts

  admin:
    backend:
      - routers/admin/**/*.py
      - routers/admin_api.py
      - routers/admin_prompts.py
      - routers/assignments.py
    frontend:
      - pages/admin/*.tsx
      - components/teacher/*.tsx
      - api/assignments.ts

  cases:
    backend:
      - routers/cases.py
      - routers/admin/cases.py
      - routers/admin/practices.py
      - core/case_schema.py
    frontend:
      - pages/CaseSelect.tsx
      - pages/admin/CasesPage.tsx
      - pages/admin/PracticesPage.tsx
      - components/teacher/cases/CaseForm.tsx
      - api/cases.ts
      - api/practices.ts
```

---

## 四、常见陷阱

| 陷阱 | 表现 | 预防 |
|------|------|------|
| **共享文件冲突** | 两个域同时改 `session.py` | 共享文件只读，修改由持有者域代理统一处理 |
| **跨域副作用** | Auth 域改权限逻辑 → Scoring 域查权限失败 | 集成检查必须全域跑测试 |
| **子代理质量不均** | 缩进不一致、import 风格不同 | 每个子代理收到统一标准提示词 |
| **提交信息错位** | 大量改动被打包进一个提交 | 每个域独立 commit，commit-msg hook 失败时重试 |
| **遗漏域** | 某域未审计 | 在 `DOMAINS` 变量中显式列出所有域 |

---

## 五、推广建议

1. **CI 集成**：将 `domain-map.yml` 提交到仓库，CI 可以只运行变更域的测试
2. **增量审计**：`git diff --name-only HEAD~5` → 筛选变更文件 → 计算所属域 → 只审计受影响域
3. **质量门禁**：每个域设定阈值（Critical: 0, High: <3），超阈值阻止合并
