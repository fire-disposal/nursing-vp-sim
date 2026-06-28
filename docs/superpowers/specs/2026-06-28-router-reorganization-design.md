# 后端路由重组设计方案

## 准则

1. **一域一文** — 每个资源域对应一个路由文件（>500 行才拆）
2. **文件名 ≈ 域名** — 见名知内容
3. **路径层级 = 资源层级** — `/api/xxx` 与文件名一一映射
4. **胖路由改造** — 凡涉及重建的文件若含内联 DB 逻辑，同步提取 service

---

## 变更清单

### P0 — 纯重命名（无逻辑改动，无路径变化）

| 当前 | 目标 | 原因 |
|------|------|------|
| `routers/export.py` | `routers/records.py` | 实际导出训练记录 |
| `admin/export.py` | `admin/llm_monitor.py` | 内容为 LLM stats + logs |
| `admin/api.py` | `admin/secrets.py` | 内容为 ApiSecret + LLMConfig |

影响：更新 `routers/__init__.py`、`admin/__init__.py` 中的 import 路径。
前端路径不变（路由 prefix 保持不变）。

### P1 — 拆分

| 源文件 | 拆出 | 理由 |
|--------|------|------|
| `admin/voice.py` (700 行) | `admin/costs.py` | usage + dashboard + cost export 独立 |
| `routers/assignments.py` (285 行) | `routers/students.py` | 学生端 APIRouter 独立文件 |

### P2 — 扁平化

| 源 | 目标 | 方式 |
|----|------|------|
| `routers/questionnaires/*.py` (4 文件) | `routers/questionnaires.py` | 合并 4 个 APIRouter 为 1 个文件 |
| 删除 `routers/questionnaires/` 目录 | — | — |

### P3 — 胖路由重构

| 路由 | 行数 | 改造内容 |
|------|------|---------|
| `admin/llm_monitor.py` | ~366 | 提取 `LLMMonitorService`（stats 查询 + logs CRUD） |
| `admin/costs.py` | ~450 | 提取 `CostService`（usage 聚合 + dashboard 查询） |
| `routers/stats.py` | ~269 | 提取 `StatsService`（duration/trends/ranking 查询） |
| `routers/records.py` | ~123 | 已有 `QuestionnaireResponseService` + `TrainingRecord` 相关 service |

### P4 — 统一 admin 注册

`admin/__init__.py` 接管全部 admin 子路由，`routers/__init__.py` 中移除直接注册的 admin 路由。

---

## 执行顺序

```
Phase 1: P0 重命名 → P2 扁平化 → P1 拆分 → P4 统一注册
Phase 2: P3 胖路由重构（llm_monitor → costs → stats → records）
Phase 3: 前端适配路径变更 + 验证
```

## 路径变化（需前端同步）

| 旧 | 新 |
|----|----|
| `/api/admin/api/secrets` | `/api/admin/secrets` |
| `/api/admin/api/configs` | `/api/admin/secrets/configs` |
| `/api/admin/voice/usage` | `/api/admin/costs/usage` |
| `/api/admin/voice/costs/dashboard` | `/api/admin/costs/dashboard` |
| `/api/admin/voice/costs/export` | `/api/admin/costs/export` |
