# 前端 UI 约定（失败态 · 院校身份 · 键盘可达）

面向推广期：这几条是**判据**，不是风格偏好。新页面照抄，评审按此驳回。

## 失败 ≠ 空态

- 查询 `isError` → 渲染 `components/ui/error-state.tsx`（自带人话错误 + 重试按钮）。
- 只有「请求成功且结果为空」才用 `EmptyState`；文案写"暂无"。
- 拿不到数据时，计数/金额/KPI 显示 **「—」**，不要显示 `0` —— `0` 会被读成"业务上确实是零"。
- 有错误分支却没有重试入口的页面，等于让用户整页刷新并丢掉筛选。
- 写操作失败**不要关闭弹窗**（关掉等于把用户刚输入的内容也丢了）；错误由 toast 呈现，表单保留。

## 错误文案只有一个来源

`utils/error.ts`：用户面 `getApiErrorMessage`，管理表单面 `getApiErrorDetail`。
**禁止**把 `(error as Error).message` 或 `e.response?.data?.detail` 直接放进 JSX：
FastAPI 的 `detail` 是数组时会被 React 当成子节点渲染并整页白屏。

## 院校身份常驻

- 壳顶栏显示当前院校（平台角色显示「平台」），来源 `/auth/me` 的 `school_id/school_name`。
  登录与 `refreshUser` 两条路径都必须合并这两个字段，否则院校管理员会被显示成「平台」。
- 院校管理员看不到「院校管理」入口（`school_manage` 权限门），后端越权一律 404。

## 键盘与可访问名

- 壳内有 skip link（`a.skip-link` → `#main`），且必须是 DOM 里第一个可聚焦元素。
- 路由切换后焦点交给主内容（`AppShell.Main tabIndex={-1}`），同时写 `document.title`。
- 图标按钮必须有 `aria-label`（`title` 只作 tooltip）；整行可点的容器必须是真按钮，不能是 `Paper onClick`。
- `SearchInput` 的 `aria-label` 默认「搜索」；页面可覆盖，但不要靠 placeholder 当名字。

## 时间与数字

- 时间一律走 `utils/date`（上海时区固化），禁止 `created_at.slice(0,16)` 这类手拼。
- 数字列右对齐 + `font-variant-numeric: tabular-nums`；金额/次数同列等宽。
