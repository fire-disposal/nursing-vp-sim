# Domain Division Guide — 并行工程指南

> 将项目按业务域拆分，支持 AI 子代理并行审计、修复、重构。每个域对应一组前后端文件，域间通过共享文件规则解耦。

## 域映射

```
auth/ ─────── routers/auth.py, core/security.py ──  pages/Login.tsx, stores/authStore.ts, api/auth.ts, api/axios-instance.ts
training/ ── contexts/training/**, contexts/patient/exam.py ── engine/**, components/training/**, api/training.ts, api/chat.ts
scoring/ ─── contexts/training/score_engine.py, scoring_progress.py, routers/stats.py ── engine/ScoreManager.ts, api/stats.ts, panels/scoring-display/**
qa/ ──────── contexts/qa/** ──  pages/QA.tsx, api/qa.ts
admin/ ───── routers/admin/**, admin_api.py ──  pages/admin/**, components/teacher/**, api/assignments.ts
cases/ ───── routers/cases.py, admin/cases.py, admin/practices.py ──  pages/CaseSelect.tsx, api/cases.ts, api/practices.ts
```

## 共享文件规则

| 文件 | 规则 |
|------|------|
| `models.py` / `schemas.py` | 全域可读，修改需通知各域 |
| `session.py` | training + scoring 共享，其余域只读 |
| `feature_flags.py` | training 可写，其余域只读 |
| `core/config.py` | 全域只读 |

## 并行工作约束

派发子代理时，设定三条硬约束：

1. **域边界**：只能修改所属域内的文件，不碰其他域的文件
2. **共享文件**：遇到共享文件只读不写，需要在共享文件中修改时由主代理统一处理
3. **检查标准**：每个域修复完成后跑全量 `pnpm run check`（ruff + ty + biome + tsc），防止跨域破坏

## 检查项模板

给子代理的检查维度（按域裁剪）：

- 前后端类型一致性（OpenAPI schema ↔ 前端 types）
- 三态覆盖（loading / empty / error）
- 资源清理（event listener、timer、AbortController）
- 安全边界（权限检查、输入验证）
- 竞态条件（double-submit、stale closure）

输出按 `🔴Critical / 🟠High / 🟡Medium` 分级，标注 `文件:行号`。

## 常见陷阱

| 陷阱 | 预防 |
|------|------|
| 两域同时改同一文件 | 共享文件只读，修改集中处理 |
| 跨域副作用（Auth 改权限 → Scoring 失败） | 全域跑测试 |
| 子代理风格不一致 | 统一检查项模板 |
| 改动打包进一个 commit | 每个域独立 commit，遵守 emoji 格式 |
| 遗漏域 | 派发前显式列出所有域 |
