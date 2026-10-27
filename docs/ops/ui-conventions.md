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

- 壳顶栏常驻当前院校：**平台角色**是「当前院校」切换器（含「全部院校」），切换即收窄
  列表/统计并换主题色；**院校角色**是灰色徽标（带院徽），名称来自 `/auth/me` 的
  `school_id/school_name`。登录与 `refreshUser` 两条路径都必须合并院校字段（含
  `school_theme_color / school_has_logo / school_logo_updated_at`），否则院校管理员会被显示成「平台」。
- 「全部院校」视角下，训练记录 / 作业 / 评分板逐行标出院校列；收窄到某校后这些列隐藏
  （整页同校，标出来只是噪音）。逐列表的院校筛选在收窄时也隐藏 —— 同一件事一处表达。
- 院校管理员看不到「院校管理」入口（`school_manage` 权限门），后端越权一律 404。
- 切换「当前院校」= 换语境：URL 里与院校/班级相关的筛选（`class_id` / `cohort_label` /
  `school_id`）会一并清掉 —— 作用域外的旧筛选在后端按越权 404，留着就表现为"切换后列表打不开"。

## 表单范式（所有表单同一套）

1. **字段**：每个输入都有 `label`（必填加 `withAsterisk`）；校验规则的唯一来源是
   `src/schemas/*.ts`，组件里不手写第二套规则。字段值出现在表单里就必须有对应输入
   （`useForm` 的 `initialValues` 里只放真的会被提交且能编辑的键）。
2. **提交**：主按钮 `type="submit"`（Enter 可提交），提交中禁用并改文案（保存中…）；
   成功统一 toast。修改密码等自服务表单要**二次确认新密码**（`schemas/auth.ts`）。
3. **失败**：就地横幅（`FormMessageBanner`）或 toast，文案必须经 `getApiErrorMessage` /
   `getApiErrorDetail`——**不得**把 `detail` 直接塞进 JSX（数组会被 React 当子节点渲染白屏）。
   失败时保留输入，不清空。
4. **关闭**：有未保存改动时先确认（脏检查）；已成功保存后的关闭不再询问。
5. **打开**：重灌表单值与错误状态（避免上一条记录残留）；编辑态先灌当前值再标记 clean。
6. **危险操作**：删除/覆盖类动作走 `useConfirm` 二次确认。
7. **院校字段**：平台角色建号/建班时可择院校；已收窄到某校时锁定为当前院校；
   同名班级的选项文案必须带院校前缀（`useClassLabel` / `useClassGroupLabel`）。

## 键盘与可访问名

- 壳内有 skip link（`a.skip-link` → `#main`），且必须是 DOM 里第一个可聚焦元素。
- 路由切换后焦点交给主内容（`AppShell.Main tabIndex={-1}`），同时写 `document.title`。
- 图标按钮必须有 `aria-label`（`title` 只作 tooltip）；整行可点的容器必须是真按钮，不能是 `Paper onClick`。
- `SearchInput` 的 `aria-label` 默认「搜索」；页面可覆盖，但不要靠 placeholder 当名字。

## 时间与数字

- 时间一律走 `utils/date`（上海时区固化），禁止 `created_at.slice(0,16)` 这类手拼。
- 数字列右对齐 + `font-variant-numeric: tabular-nums`；金额/次数同列等宽。
