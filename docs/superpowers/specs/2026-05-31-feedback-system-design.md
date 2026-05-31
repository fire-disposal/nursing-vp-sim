# 意见反馈系统 — 设计规格

> 版本: v1 | 日期: 2026-05-31 | 分支: feature/feedback-system

## 概述

为虚拟患者系统添加内置意见反馈功能：用户可在完成首次训练后收到自动弹出的反馈模态框（仅一次），也可通过侧边栏按钮随时触发。管理员可在 Admin 后台查看和筛选所有反馈。

## 评分形式

5 级表情满意度：`😞` (1) `😐` (2) `🙂` (3) `😊` (4) `😍` (5)，点击选中高亮。

## 预设标签（单选）

| 标签 | 值 |
|------|-----|
| 功能建议 | `feature` |
| BUG反馈 | `bug` |
| 体验评价 | `experience` |
| 内容质量 | `content` |
| 界面设计 | `ui` |
| 其他 | `other` |

## 数据模型

### Feedback 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Integer PK | 自增主键 |
| user_id | Integer FK → users.id | 提交用户 |
| rating | Integer (1-5) | 满意度评分 |
| tag | String(20) | 预设标签值 |
| content | Text (nullable) | 文本意见 |
| created_at | DateTime | 提交时间 |

索引: `ix_feedback_user_id`, `ix_feedback_tag`, `ix_feedback_created_at`

## 后端 API

| 方法 | 路径 | 权限 | 请求体 / 参数 | 响应 |
|------|------|------|--------------|------|
| POST | `/api/feedback` | 登录 | `{ rating: int, tag: str, content?: str }` | `{ id, created_at }` |
| GET | `/api/admin/feedback` | 教师 | `?tag=&page=&limit=` | `{ items: FeedbackItem[], total, offset, limit }` |

路由文件: `backend/routers/feedback.py`

## 前端组件

### FeedbackModal.jsx

- 复用现有 `ui/Modal` 组件
- Props: `open`, `onClose`, `submitted` 回调
- 内容布局:
  1. **表情行**: 5 个表情按钮，点击选中，当前选中项放大+彩色边框
  2. **标签行**: 6 个 Chip 按钮，单选，选中高亮
  3. **文本区**: textarea, 可选, placeholder "请详细描述你的想法..."
  4. **Footer**: [提交] [取消]

### FeedbackProvider.jsx (Context)

- 提供 `openFeedback()` 方法供全局调用
- 管理 `showFeedbackPrompt` 状态供 DashboardHome 使用
- localStorage 键 `feedback_v1_prompted` 控制首次自动弹出仅一次
- 挂载在 App.jsx 根级别

### AppShell.jsx 改动

- 侧边栏 footer 区域新增"意见反馈"按钮（MessageSquare 图标）
- 点击调用 FeedbackContext 的 openFeedback()

### DashboardHome.jsx (StudentDashboard) 改动

- 检测 `location.state?.feedbackPrompt` → 自动弹出 FeedbackModal
- 关闭后写入 localStorage 标记

### ChatTraining.jsx 改动

- navigate("/home") 时携带 state: `{ feedbackPrompt: Date.now() }`

## Admin 管理

### FeedbackTab.jsx

- Admin 第 7 个 Tab，标签名 "用户反馈"
- 顶部标签筛选栏: 全部 / 功能建议 / BUG反馈 / 体验评价 / 内容质量 / 界面设计 / 其他
- 反馈列表: 每个反馈一张卡片，显示用户名、表情评分、标签 Badge、内容、时间
- 使用 Pagination 统一分页组件

### Admin.jsx 改动

- Tabs 列表添加 `{ key: "feedback", icon: MessageSquare, label: "用户反馈" }`

## 触发流程

```
首次完成训练流程:
  ChatTraining: ScoreCard展示 → 用户点"返回首页"
    → navigate("/home", { state: { feedbackPrompt: Date.now() } })
  DashboardHome (StudentDashboard): 
    useEffect → 检测 location.state.feedbackPrompt
    → localStorage.getItem("feedback_v1_prompted") === null
    → 弹出 FeedbackModal
  FeedbackModal: 提交 or 关闭
    → localStorage.setItem("feedback_v1_prompted", "1")

主动触发:
  AppShell 侧边栏 "意见反馈" 按钮
    → FeedbackContext.openFeedback()
    → FeedbackModal 弹出（不受 localStorage 限制）
```

## 测试计划

- 后端: `test_feedback.py` — 提交反馈、管理员查询、标签筛选、权限校验
- 前端: FeedbackModal 渲染测试、标签选择交互、表情点击交互
