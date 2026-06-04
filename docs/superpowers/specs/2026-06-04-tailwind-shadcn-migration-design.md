# Tailwind CSS + shadcn/ui 全面迁移设计

> 日期: 2026-06-04 | 状态: 已批准

## 目标

将前端从"2686 行全局 CSS + 大量内联 style + 手写组件"迁移到 Tailwind CSS + shadcn/ui，减少代码量 30-50%，统一视觉效果。

## 新增依赖

| 包 | 用途 |
|---|---|
| `tailwindcss` + `@tailwindcss/vite` | 原子化 CSS 框架 |
| shadcn/ui 组件 | 基于 Radix 的预构建组件 |
| `react-hook-form` + `@hookform/resolvers` + `zod` | 表单状态管理 + 校验 |
| `sonner` | Toast 通知 (替代手写 Toast 系统) |
| `clsx` + `tailwind-merge` | 类名合并 |

## 组件迁移映射

| 旧组件 | 新方案 |
|---|---|
| `Button.tsx` | shadcn/ui Button |
| `FormField/Input/Select/Textarea` | shadcn/ui Form + react-hook-form |
| `Modal.tsx` | shadcn/ui Dialog |
| `ConfirmDialog.tsx` | shadcn/ui AlertDialog |
| `Tabs.tsx` | shadcn/ui Tabs |
| `Toast.tsx` | sonner |
| `Badge.tsx` | shadcn/ui Badge |
| `Pagination.tsx` | shadcn/ui Pagination |
| `.data-table` 全局 CSS | shadcn/ui Table |
| `.card`/`.stat-card` CSS | shadcn/ui Card |
| `PageHeader.tsx` | 保留并精简，用 Tailwind 重写 |
| `LoadingState.tsx` | 保留 |
| `StatCard.tsx` | 保留并用 Tailwind 重写 |

## 设计 Tokens 保留

现有 `tokens.css` 的色板、间距、阴影、圆角映射到 Tailwind theme，保持视觉一致性。

## 渐进迁移顺序

1. **基础设施**: Tailwind + shadcn init + cn() 工具 + 设计 tokens 迁移
2. **核心组件**: 替换 `components/ui/` 下所有组件
3. **布局**: `Layout.tsx` 侧边栏 + 导航
4. **简单页面**: Login → DashboardHome → Stats → History
5. **复杂页面**: ChatTraining → RecordDetail → QA
6. **Teacher 组件**: 11 个 teacher 组件批量迁移
7. **清理**: 删除旧 CSS，最终验证

## 兼容性

- 保持所有组件对外 API 不变
- React Router、React Query、Zustand 不受影响
- 现有测试用 `data-testid` 定位，不受样式变更影响
