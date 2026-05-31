# 意见反馈系统 — 实现计划

> 日期: 2026-05-31 | 基于 spec: 2026-05-31-feedback-system-design.md

## 任务分解（4 个子代理并行）

### Task A: 后端 — 数据模型 + API

**文件:**
1. `backend/models.py` — 新增 `Feedback` ORM 模型
2. `backend/schemas.py` — 新增 `FeedbackSubmit`, `FeedbackItem`, `FeedbackListResponse`
3. `backend/routers/feedback.py` — 新建路由:
   - `POST /api/feedback` — 提交反馈
   - `GET /api/admin/feedback` — 管理员查询（tag 筛选 + 分页）
4. `backend/main.py` — 注册 feedback router

**验证:** `pytest backend/tests/test_feedback.py -v`

### Task B: 前端 — FeedbackModal + FeedbackProvider

**文件:**
1. `frontend/src/components/FeedbackModal.jsx` — 新建:
   - 复用 `ui/Modal` 组件
   - 5 个表情按钮行 (😞😐🙂😊😍)，点击选中
   - 6 个标签 Chip 单选
   - textarea 可选文本
   - 提交/取消按钮
2. `frontend/src/components/FeedbackProvider.jsx` — 新建 Context:
   - 提供 `openFeedback()` / `closeFeedback()` / `submitFeedback()`
   - 管理 `isOpen` / `showPrompt` 状态
   - localStorage `feedback_v1_prompted` 逻辑
3. `frontend/src/api.js` — 新增 `submitFeedback()` / `getFeedbacks()` API 函数
4. `frontend/src/main.jsx` — 包裹 FeedbackProvider（仿 ToastProvider 模式）

**验证:** Vitest 测试渲染和交互

### Task C: 前端 — 触发逻辑 + 入口按钮

**文件:**
1. `frontend/src/components/AppShell.jsx` — 侧边栏 footer 新增"意见反馈"按钮
2. `frontend/src/pages/DashboardHome.jsx` — StudentDashboard 检测 `location.state.feedbackPrompt`
3. `frontend/src/pages/ChatTraining.jsx` — navigate("/home") 携带 feedbackPrompt state
4. `frontend/src/pages/Login.jsx` — 登录时清除 feedback_v1_prompted（可选，让每次登录后可重新触达）

**验证:** 手动端到端流程测试

### Task D: 前端 Admin — FeedbackTab

**文件:**
1. `frontend/src/components/teacher/FeedbackTab.jsx` — 新建:
   - 标签筛选栏 (全部/功能建议/BUG/体验/内容/界面/其他)
   - 反馈卡片列表（用户名、表情、标签 Badge、内容、时间）
   - 使用 Pagination 分页
2. `frontend/src/pages/Admin.jsx` — tabs 数组新增 feedback tab

**验证:** 渲染测试

### Task E: 测试补充

**文件:**
1. `backend/tests/test_feedback.py` — 新建后端测试:
   - 学生提交反馈成功
   - 未登录提交返回 401
   - 管理员查询全部反馈
   - 管理员按标签筛选
   - 分页参数
2. `frontend/src/__tests__/FeedbackModal.test.jsx` — 新建前端测试:
   - 表情点击交互
   - 标签选择
   - 提交按钮 disabled 逻辑（未选评分时）

## 执行顺序

```
Phase 1 (并行): Task A | Task B | Task D
Phase 2 (依赖 B): Task C (需要 FeedbackProvider 就绪后集成)
Phase 3 (依赖 A): Task E (需要 API 和组件就绪后写测试)
```

Phase 1 中 A/B/D 完全独立，可同时执行。
