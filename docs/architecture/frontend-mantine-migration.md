# ADR: 前端迁移到 Mantine（性能优化 + 代码简化）

- 状态：已采纳，执行中
- 日期：2026-08-13
- 分支：`refactor/frontend-mantine`

## 背景与目标

前端当前为 React 19 + Vite 8 + TS 5.8，样式/组件体系由三套范式并存：

1. Tailwind v4 工具类（`@tailwindcss/vite` + `@theme` CSS 变量，散布在 ~163 个文件）
2. shadcn 风格自建原语（`components/ui` 44 个组件，底层 `@base-ui/react` headless）
3. 冗余依赖：`next-themes`（暗色）、`sonner`（toast）、`cmdk`（命令面板）、`cva`+`tailwind-merge`+`clsx`（shadcn 胶水）、`tw-animate-css`

目标：**性能优化**（去掉运行时冗余、依赖精简、按需分包）、**代码简化**（一套组件体系替代三套）、**充分利用 Mantine 的组件一致性与开发体验**（CSS 变量 + style props、内置暗色、`@mantine/hooks`/`@mantine/form`/`@mantine/notifications`/`@mantine/modals`/`@mantine/spotlight`）。

> 视觉标准：**不做逐像素还原**，只保证整体观感与一致性到位（用户确认）。

## 决策

### 1. 采用 Mantine v9

- 版本 `9.5.1`（`latest`），peer 要求 `react ^19.2.0`（本项目 `^19.2.6` 满足）。
- v9 无运行时 CSS-in-JS：CSS 变量 + 内联样式，运行时开销优于 Tailwind + shadcn。

### 2. 依赖增删

**新增**：`@mantine/core`、`@mantine/hooks`、`@mantine/form`、`@mantine/notifications`、`@mantine/modals`、`@mantine/spotlight`、`@tabler/icons-react`。

**删除**：`tailwindcss`、`@tailwindcss/vite`、`tailwind-merge`、`class-variance-authority`、`clsx`、`tw-animate-css`、`shadcn`、`@base-ui/react`、`next-themes`、`sonner`、`cmdk`、`lucide-react`、`components.json`。

**保留**（非 UI 体系职责或收益边际不足）：
- 数据层：`@tanstack/react-query`、`zustand`
- 路由：`react-router-dom`
- 内容：`react-markdown` + `remark-gfm`、`@monaco-editor/react`
- 3D：`three` / `@react-three/fiber` / `drei` / `postprocessing`
- 工具：`browser-image-compression`
- 动画：`motion`（framer-motion，覆盖 AnimatePresence/spring）
- 图表：`recharts`（`@mantine/charts` 同内核，收益边际，暂留）

**保留但备注**：`gsap`（仅 `showcase/gsap.ts` ScrollTrigger，展示页懒加载）、`lottie-web`（仅登录页插画）。均为单点使用，懒加载后不进入主包；后续可评估收敛到 `motion`。

### 3. 主题与配色

- 品牌色板 4 套（teal/blue/green/slate）映射到 Mantine 内置色（`teal`/`blue`/`green`/`gray`），获得完整 10 阶色阶。
- 暗色模式交给 Mantine color scheme（`useMantineColorScheme` + `ColorSchemeScript`），替代 `next-themes`。
- 品牌色由 `src/theme/brand-store.ts`（zustand + persist）管理，向后兼容旧 `localStorage["vp-theme"]` 裸字符串。
- 图表色（recharts）由品牌色板常量提供，暗色判断改用 `useMantineColorScheme`。

### 4. 目录结构（有序/清晰）

```
src/
  theme/            # Mantine 主题 + 品牌色板（替代 themes/ + hooks/useTheme）
    index.ts          # createAppTheme、BRAND_PALETTES
    brand-store.ts    # 品牌色 zustand store
  components/ui/    # 应用级共享原语（StatCard/PageHeader/EmptyState/…），Mantine 实现
  ...               # 其余结构不变
```

`components/ui` 不再自建 Button/Card/Select 等基础组件——直接 `import { Button } from "@mantine/core"`，消除 shim 层。

### 5. 迁移顺序（每阶段保证 `tsc --noEmit` 通过）

1. 地基：装依赖、`MantineProvider`+`createTheme`、删 `next-themes`、配色/暗色迁移（Tailwind 暂时共存）。
2. 原语层：`components/ui` 44 组件改用 Mantine，图标 `lucide-react`→`@tabler/icons-react`。
3. 子系统：`sonner`→`@mantine/notifications`、`cmdk`→`@mantine/spotlight`、`confirm`→`@mantine/modals`。
4. 页面：Tailwind 工具类 → Mantine `Stack/Group/Grid/Box/Text/Title` + style props（子代理按页群并行，不做像素级还原）。
5. 收尾：删 Tailwind 与死依赖、更新 `vite.config` 分包、清 `components.json`。
6. 验证：`tsc`、`biome`、`vitest`、`vite build`、浏览器冒烟。
