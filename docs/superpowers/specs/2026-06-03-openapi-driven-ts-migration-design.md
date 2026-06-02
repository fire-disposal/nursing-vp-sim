# 前后端类型安全整合 — 设计文档

> 日期: 2026-06-03 | 状态: 已确认

## 1. 背景与动机

当前前端 TypeScript 迁移尝试暴露出根本问题：**手动编写的 API 类型与后端返回值不匹配**，导致大量 `as unknown as` 强转和局部类型重复定义。

核心思路：**以 OpenAPI 为单一真相源**，后端 Pydantic 模型 → OpenAPI spec → 前端自动生成类型和客户端。前端不再手动同步 API 类型。

配合 Radix UI 替换有行为复杂度的自定义组件，减少维护负担。

## 2. 整体架构流水线

```
Phase 1: Backend OpenAPI 补全
  FastAPI routers ──► 补 response_model= ──► /openapi.json (93%+ 覆盖)
                              │
Phase 2: 前端生成工具链        ▼
  /openapi.json ──► openapi-typescript ──► api-types.gen.ts
                                        ──► api-client.ts (axios 薄封装)
                              │
Phase 3: 前端客户端集成         ▼
  删除 api.js (360行) · 替换全部导入 · 组件 .jsx→.tsx · path aliases
                              │
Phase 4: Radix UI 组件库       ▼
  Dialog 替代 Modal · AlertDialog 替代 ConfirmDialog · Tabs 替代内建
```

## 3. Phase 1: Backend OpenAPI 补全

### 3.1 现状

| 指标 | 数值 |
|------|------|
| 有 `response_model=` 的端点 | 48 |
| 无 `response_model=` 的端点 | 32 (不含 2 个二进制/CSV 下载) |
| 最大盲区 | `admin_api.py` (17 个端点), Rubric (零 Pydantic schema) |
| stats 端点类型弱化 | 3 个使用 `PaginatedResponse[dict]` |

### 3.2 策略

**仅添加 `response_model=`，不修改路由返回值逻辑。** 保持现有 API 契约不变。

### 3.3 新增 Pydantic Schema（schemas.py 追加 ~10 个）

```python
class MessageResponse(BaseModel):
    message: str

class OkResponse(BaseModel):
    ok: bool = True

class ToggleStatusResponse(BaseModel):
    ok: bool = True
    status: str

class SecretCreateResponse(BaseModel):
    id: int
    key_suffix: str

class ConfigCreateResponse(BaseModel):
    id: int

class FeedbackSubmitResponse(BaseModel):
    id: int
    created_at: datetime

class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0

class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str

class RubricResponse(BaseModel):
    id: int; name: str; version: str = ""
    description: Optional[str] = None
    total_max: int = 100; raw_max: int = 57; raw_scale: int = 3
    dimensions: list = []
    is_active: bool = False
    created_at: datetime; updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class RubricBrief(BaseModel):
    id: int; name: str; is_active: bool = False

class SampleVarsResponse(BaseModel):
    purpose: str
    vars: dict

class HealthCheckItem(BaseModel):
    base_url: str; status: str
    latency_ms: Optional[int] = None
    error: Optional[str] = None

class TestResultItem(BaseModel):
    base_url: str; ok: bool; status_code: Optional[int] = None
    latency_ms: Optional[int] = None; error: Optional[str] = None

class TestAllResultsResponse(BaseModel):
    results: list[TestResultItem]

class TeacherSummaryItem(BaseModel):
    user_id: int; display_name: str
    grade: Optional[str] = None; class_name: Optional[str] = None
    session_count: int = 0; average_score: Optional[float] = None

class RankingItem(BaseModel):
    user_id: int; display_name: str
    grade: Optional[str] = None; class_name: Optional[str] = None
    session_count: int = 0; average_score: Optional[float] = None

class ClassSummaryItem(BaseModel):
    grade_id: int; grade_name: str; class_id: int; class_name: str
    student_count: int = 0; session_count: int = 0
    average_score: Optional[float] = None
```

### 3.4 路由器改动（6 个文件，每处仅加 response_model=）

| Router | 改动数 | 需新增的 schema |
|--------|--------|----------------|
| `auth.py` | 1 (`GET /me`) | 内联或复用 UserBrief |
| `cases.py` | 1 (`DELETE`) | MessageResponse |
| `training.py` | 3 (`end`, `retry`, `delete`) | ScoringTriggerResponse, MessageResponse |
| `admin.py` | 1 (`DELETE /users`) | MessageResponse |
| `admin_api.py` | 17 (所有 CRUD+rubric) | OkResponse, SecretCreateResponse, ConfigCreateResponse, ToggleStatusResponse, TestAllResultsResponse, RubricResponse, RubricBrief, HealthCheckItem |
| `admin_prompts.py` | 3 (`delete`, `activate`, `sample-vars`) | OkResponse, SampleVarsResponse |
| `admin_grades.py` | 1 (`DELETE`) | MessageResponse |
| `admin_classes.py` | 1 (`DELETE`) | MessageResponse |
| `qa.py` | 1 (`DELETE`) | MessageResponse |
| `feedback.py` | 2 (`submit`, `stats`) | FeedbackSubmitResponse, list[FeedbackDailyItem] |
| `notes.py` | 1 (`DELETE`) | MessageResponse |
| `stats.py` | 3 (`teacher-summary`, `ranking`, `class-summary`) | 现有 `PaginatedResponse[dict]` 改为 `PaginatedResponse[具名Schema]` |

### 3.5 不处理

- `backup_database` (POST /backup) — FileResponse，二进制下载
- `export_llm_logs_csv` (GET /llm-logs/export) — CSV StreamingResponse

## 4. Phase 2: 前端生成工具链

### 4.1 工具

| 工具 | 版本 | 作用 |
|------|------|------|
| `openapi-typescript` | ^7 | 从 OpenAPI JSON 生成 TypeScript 类型 |
| axios（现有） | ^1.16 | HTTP 客户端，保留 interceptors |

### 4.2 产出物

```
frontend/src/api/
├── api-types.gen.ts     # 生成文件（不手动编辑）
└── api-client.ts        # 手写薄封装（用生成类型 + axios 实例）
```

### 4.3 工作流

```bash
# 开发时：启动后端 → 生成类型
npm run generate:api

# 目标：http://localhost:8000/openapi.json → src/api/api-types.gen.ts
```

### 4.4 api-client.ts 模式

```typescript
import { api as axiosInstance } from "./axios-instance";
import type { paths, components } from "./api-types.gen";

type Schemas = components["schemas"];

// 每个端点一行，类型由生成文件保证
export const getUsers = (params: Record<string, unknown>) =>
  axiosInstance.get<PaginatedResponse<Schemas["UserBrief"]>>("/api/admin/users", { params });

export const login = (username: string, password: string) =>
  axiosInstance.post<Schemas["TokenResponse"]>("/api/auth/login", { username, password });
```

### 4.5 axios-instance.ts

从现有 `api.js` 提取 interceptors（auth token、401 重定向、自动重试），保持行为不变。

## 5. Phase 3: 前端客户端集成

### 5.1 步骤

| 顺序 | 操作 | 影响文件 |
|------|------|---------|
| 1 | 创建 `api-client.ts` + `axios-instance.ts` | 2 新文件 |
| 2 | 所有 `from "../../api"` → `from "@/api/api-client"` | ~30 组件 |
| 3 | 调整调用处适配生成类型 | ~30 组件 |
| 4 | Stores 类型从生成 DTO 派生 | 3 stores |
| 5 | 逐文件 .jsx → .tsx（用生成类型替代 any） | ~50 文件 |
| 6 | 删除 `src/api.js`、`src/api/apiManagement.js` | 2 文件 |
| 7 | 删除 `Layout.jsx`（直接 import AppShell） | 1 文件 + 引用处 |
| 8 | 全局 `../../` → `@/` path alias | ~30 文件 |

### 5.2 风险控制

- 每步单独 commit
- 生成文件不手动编辑（`.gen.ts` 后缀标记）
- Build 不通过 = 回退该步

## 6. Phase 4: Radix UI 组件库

### 6.1 替换范围

| 替换 | Radix 组件 | 原因 |
|------|-----------|------|
| `Modal.jsx` (116行) | `@radix-ui/react-dialog` | 有行为复杂度（focus trap、ESC 关闭、overlay） |
| `ConfirmDialog.jsx` (254行) | `@radix-ui/react-alert-dialog` | 同上 + 取消/确认语义 |
| `Tabs.jsx` | `@radix-ui/react-tabs` | 键盘导航、ARIA 属性 |

### 6.2 保留组件（布局型，无行为复杂度）

`Badge`、`Button`、`FormField`、`LoadingState`、`PageHeader`、`StatCard`

### 6.3 样式策略

Radix 组件通过 `className` 透传，绑定现有 `tokens.css` 变量。用户无感知差异。

### 6.4 代码影响

- 删除：~400 行自定义 UI
- 新增：~100 行 Radix 配置 + `npm install @radix-ui/react-dialog @radix-ui/react-alert-dialog @radix-ui/react-tabs`

## 7. 并行执行策略

### 7.1 分支与 Worktree

```
feat/frontend-typescript-migration (基线: 5b80f78)
│
├── feat/backend-openapi        (worktree: ../backend-openapi)
│   └── Phase 1: OpenAPI 补全
│
└── feat/frontend-rebuild       (worktree: ../frontend-rebuild)
    ├── Phase 2: 生成工具链
    ├── Phase 3: 客户端集成
    └── Phase 4: Radix UI
```

### 7.2 时序

```
Backend  ──Phase 1──► 完成 /openapi.json
Frontend ──准备──► 等待 ◄── 生成类型 ──Phase 2/3/4──►
```

Phase 2 的前置准备（npm install、axios-instance.ts）可与 Phase 1 并行。类型生成步骤需等待 Phase 1 完成后执行。

### 7.3 合并

1. Backend 分支 → rebase 到基线 → 合入
2. Frontend 分支 → rebase 到含 Backend 的基线 → 重跑 `generate:api` → 合入

## 8. 可行性评估

| Phase | 预估时间 | 风险 | 价值 |
|-------|---------|------|------|
| Phase 1 | 3-4 小时 | 低 — 仅加注解，不改变行为 | 解除前端类型生成阻塞 |
| Phase 2 | 1-2 小时 | 低 — 标准化工具链 | 一次配置，永久受益 |
| Phase 3 | 4-6 小时 | 中 — 30+ 文件导入变更 | 消除手写 API 同步 |
| Phase 4 | 2-3 小时 | 低 — 3 个组件替换 | 减少 ~300 行自定义代码 |

**总工作量：** 10-15 小时（前后端并行后实际日历时间更短）

**结论：值得做。** 这是从根本上解决类型安全问题的正确架构。
