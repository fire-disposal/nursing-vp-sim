# Frontend TypeScript 迁移与规范化 — 设计文档

> 日期: 2026-06-02 | 状态: 已确认

## 1. 背景与动机

护理虚拟患者模拟 (Nursing VP Sim) 前端处于**极早期原型阶段**，单人开发，代码量约 10,800 行（53 `.jsx` + 10 `.js`）。当前**零类型安全** — 无 PropTypes、无 JSDoc、无 TypeScript。

核心诉求（按优先级）：

1. **减少运行时 Bug** — JS 无类型导致的 undefined/null/类型错误
2. **提升开发体验 (DX)** — IDE 自动补全、安全的 refactor、类型提示
3. **新人上手/团队协作** — 类型即文档，降低理解成本
4. **为前端补全单测** — TS 环境下的测试更容易编写和维护

## 2. 方案选择

选择**方案 A：全量 TS 迁移** — 一次性将所有 `.js`/`.jsx` 重命名为 `.ts`/`.tsx`，启用 `strict: true`，逐文件补全类型。

**核心判断：** 10,800 行在早期阶段做 TS 化的成本不到后期的 1/3。代码量小、单人无协调成本、可随时回滚。

## 3. TypeScript 配置

### 3.1 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 3.2 依赖变更

**新增：**
- `typescript` ^5.8

**已有、无需额外安装类型：**
- `@types/react` ^19, `@types/react-dom` ^19（已安装）
- `zustand`、`lucide-react`、`react-markdown`、`recharts`、`axios`（自带类型）

**移除：**
- `eslint` 及其全部插件（用 Biome 2.4 统一替代）
- 相关依赖：`eslint-plugin-react-hooks` 等

### 3.3 Linter 统一

- **Biome 2.4 成为唯一 linter + formatter**
- 配置 `include` 扩展为 `["**/*.{js,ts,tsx}"]`
- Biome 内置 React hooks 规则 (`useExhaustiveDependencies`) 覆盖原来 ESLint 的功能
- 移除 `.eslint.config.js`

### 3.4 Vite 配置

`vite.config.js` → `vite.config.ts`，添加 path alias 解析：

```ts
resolve: {
  alias: { "@": path.resolve(__dirname, "src") }
}
```

## 4. 类型体系设计

### 4.1 目录结构

```
frontend/src/
└── types/
    ├── index.ts         # 统一 re-export
    ├── models.ts        # 领域模型
    ├── api.ts           # API 请求/响应类型
    └── store.ts         # Zustand store 类型
```

### 4.2 核心模型

```typescript
// models.ts — 领域模型
interface User {
  id: number;
  username: string;
  role: "student" | "teacher";
  displayName: string;
  avatar?: string;
}

interface PatientCase {
  id: number;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category?: string;
  tags?: string[];
}

interface TrainingRecord {
  id: number;
  userId: number;
  caseId: number;
  patientName: string;
  score?: number;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

interface RubricItem {
  id: number;
  name: string;
  weight: number;
  criteria: string;
}

interface ScoreResult {
  itemId: number;
  score: number;
  feedback: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

type Role = "student" | "teacher";
type Difficulty = "easy" | "medium" | "hard";
type RecordStatus = "active" | "completed" | "abandoned";
```

### 4.3 设计原则

- **集中管理** — 类型在 `src/types/` 统一维护，避免跨文件循环引用
- **API 响应类型** 同时被 store 和组件消费，集中管理更清晰
- **优先精确、必要时宽泛** — 后端稳定的 API 用精确接口，迭代中的用 `unknown` + 渐进 narrow

## 5. 迁移执行顺序

按依赖方向从叶子到根节点：

```
Phase 1 — 基础设施（新文件）
  src/types/*.ts                    ← 先定义所有模型类型

Phase 2 — 数据层（无内部依赖）
  src/api.js → api.ts
  src/api/apiManagement.js → apiManagement.ts
  src/utils/avatar.js → avatar.ts

Phase 3 — 状态层（依赖 types + api）
  src/stores/authStore.js → authStore.ts
  src/stores/gradesClassesStore.js → gradesClassesStore.ts
  src/stores/llmStore.js → llmStore.ts

Phase 4 — 底层组件（依赖 types + stores）
  src/hooks/useVoice.js → useVoice.ts
  src/components/ui/*.jsx → *.tsx

Phase 5 — 业务组件
  src/components/**/*.jsx → *.tsx

Phase 6 — 页面 + 入口
  src/pages/**/*.jsx → *.tsx
  src/App.jsx → App.tsx
  src/main.jsx → main.tsx

Phase 7 — 收尾
  biome.json include 扩展
  vite.config.js → vite.config.ts
  __tests__/*.jsx → *.tsx
  移除 ESLint 依赖
```

### 单文件转换步骤

1. `git mv file.jsx file.tsx`
2. AI 辅助生成类型标注
3. `npx tsc --noEmit` 检查
4. 人工修正 AI 遗漏或错误的类型

### 分支策略

开 `feat/typescript-migration` 分支，全部 Phase 通过后合入主分支。

## 6. 伴生规范化

### 迁移期完成（低成本）

| 改进 | 做法 |
|------|------|
| **Path alias `@/`** | `tsconfig.json` + `vite.config.ts` 配置，所有 `../../` 相对引用替换为 `@/` |
| **移除 `Layout.jsx`** | 删除这个一行 re-export，所有 import 直接指向 `AppShell` |

### 独立立项（不阻塞迁移）

| 改进 | 理由 |
|------|------|
| **样式重组**（内联 → CSS Modules） | 影响面大，和 TS 互不依赖 |
| **单测补全** | TS 化后用 TS 写测试更高效，分模块渐进 |
| **状态管理统一** | Zustand + Context 混合在当前场景合理 |

## 7. 风险评估与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| Web Speech API 无官方类型 | `useVoice.ts` (162行) 需处理 | 创建 `src/types/globals.d.ts` 声明 `SpeechRecognition`、`SpeechSynthesisUtterance` |
| 内联 CSS 变量 TS 警告 | `style={{ '--bg': '#fff' }}` 报错 | 使用 `React.CSSProperties` 类型断言 |
| 后端 API 快速迭代 | 前端类型与后端不同步 | 先用 `unknown`，验证后 narrow |
| 第三方库缺类型 | 个边库可能无 `@types/*` | 迁移时逐一验证，缺失则 `declare module` |

## 8. 可行性结论

| 维度 | 评估 |
|------|------|
| 技术可行性 | **高** — Vite + React 19 对 TS 支持成熟 |
| 工作量 | **中等** — ~63 文件，AI 可自动完成 60-70% 类型标注 |
| 预估耗时 | **2-3 周**（单人全职，含 AI 辅助） |
| ROI | **高** — 早期 10,800 行做 TS 化成本不到后期的 1/3 |
| 风险 | **低** — 无团队协调成本，在分支上做，可随时回滚 |

**结论：值得做，应该现在做。**
