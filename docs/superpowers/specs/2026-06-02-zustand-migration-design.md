# Zustand 状态管理迁移 — 设计规格

## 背景

当前前端使用纯 React `useState`/`useEffect` 管理状态，存在以下问题：
- `user`/`onLogout` 通过 props 穿透所有页面组件
- `getGrades()`、`getCases()`、`getRecords()` 在多处独立调用，无缓存
- `ProtectedRoute` 直接读 localStorage 绕过 React 状态，与 App 的 useState 不同步
- 页面切换时重复请求，无数据去重

## 目标

引入 Zustand 作为轻量全局状态管理，消除 prop drilling，提供数据缓存层。

## 架构

### Store 设计

#### 1. `authStore` (`src/stores/authStore.js`)
```
state:  user (object|null), token (string|null)
actions: login(username, password) → 调 API → 写 state + localStorage
         logout() → 清 state + localStorage
         getMe() → 刷新 user
         initialize() → 从 localStorage 恢复
初始化: App.jsx 启动时调用 initialize()
```

**影响文件：**
- `App.jsx`: 移除 `useState(user)`，改用 `authStore`；ProtectedRoute 改用 store
- `Login.jsx`: 移除 `onLogin` prop，直接调 `authStore.login()`
- 所有页面: 移除 `{ user, onLogout }` props，从 store 读取
- `Layout.jsx` / `AppShell`: 移除 user/onLogout props

#### 2. `gradesClassesStore` (`src/stores/gradesClassesStore.js`)
```
state:  grades (GradeResponse[]), classes (ClassResponse[]), loading (boolean)
actions: fetchGrades() → API → set state（去重：已加载则跳过）
         fetchClasses(gradeId?) → API → set state
         createGrade(name) → API → refresh
         updateGrade(id, name) → API → refresh
         deleteGrade(id) → API → refresh + refreshClasses
         createClass(gradeId, name) → API → refresh
         updateClass(id, data) → API → refresh
         deleteClass(id) → API → refresh
```

**影响文件：**
- `GradesClassesPage.jsx`: 改用 store，移除本地 fetch
- `ClassFilter.jsx`: 改用 store，解决竞态条件
- `UsersTab.jsx`: register/edit 表单的班级下拉用 store

#### 3. `casesStore` (`src/stores/casesStore.js`) — 可选，本次范围外

## 不变部分

以下保持现状：
- 各页面的训练记录 fetch（records 与页面上下文强相关，缓存价值低）
- 各页面的表单 state（useState 管理的局部 UI 状态）
- Toast、Confirm、Feedback 三个 Context（功能独立，无需迁移）
- API 层 (`api.js`) 不变，store 调用 api 函数

## 实施步骤

1. `npm install zustand`
2. 创建 `src/stores/authStore.js` — auth 状态 + login/logout/initialize
3. 创建 `src/stores/gradesClassesStore.js` — grades/classes CRUD
4. 重构 `App.jsx` — 用 authStore 替代 useState(user)
5. 重构 `Login.jsx` — 直接用 authStore
6. 重构 `Layout.jsx` — 移除 user/onLogout props
7. 重构所有页面组件 — 移除 user/onLogout props，从 store 读取
8. 重构 `GradesClassesPage.jsx` — 用 gradesClassesStore
9. 重构 `ClassFilter.jsx` — 用 gradesClassesStore（解决竞态）
10. 更新 `UsersTab.jsx` — 班级下拉用 store
11. 前端构建验证 `npm run build`
12. 删除旧代码（无用 props 声明）

## 风险

- Zustand 是极小依赖（~1KB），零运行时开销
- persist 中间件读写 localStorage，与现有 axios interceptor 的 401 处理兼容
- 无需修改后端任何代码
