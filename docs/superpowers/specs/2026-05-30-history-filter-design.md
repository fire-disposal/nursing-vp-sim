# History 页面筛选功能设计

## 目标

为 `/history` 训练历史页面添加极简筛选功能：状态下拉 + 日期区间。

## 背景

- `History.jsx` 是学生和教师共用的训练记录列表页，目前仅有分页无筛选
- 教师管理面板 `RecordsTab.jsx` 已有完整的 filter-bar（学生姓名、病例、状态、日期）
- 后端 `GET /api/training/records` 接受 filter 参数但仅对教师角色生效
- 用户不希望学生看到无用的输入框（如"学生姓名"对学生无意义）

## 设计

### 前端 — `frontend/src/pages/History.jsx`

新增筛选栏，置于表格上方（`.card` 内部、表格之前）：

```
┌─────────────────────────────────────────────────┐
│ 筛选栏                                           │
│ ┌──────────┐ ┌──────────────┐ ┌──────────────┐  │
│ │ 状态 ▼   │ │ 开始日期(起) │ │ 开始日期(止) │  │
│ └──────────┘ └──────────────┘ └──────────────┘  │
│                              [清除过滤]         │
└─────────────────────────────────────────────────┘
```

**筛选字段：**

| 字段 | 类型 | 选项 |
|------|------|------|
| `status` | `<select>` | 全部 / 进行中 / 已完成 |
| `date_from` | `<input type="date">` | - |
| `date_to` | `<input type="date">` | - |

**状态管理：**
- 新增 `filters` state: `{ status: "", date_from: "", date_to: "" }`
- 筛选变化 → `useEffect` 重置 `offset` 为 0
- `fetchRecords` 构建 `params` 时携带非空筛选值

**复用：** 使用项目中已有的 `.filter-bar` / `.filter-row` / `.filter-item` CSS 类，与 `RecordsTab` 视觉一致。

**不变：** 表格列结构、分页组件、删除逻辑、加载/错误/空态展示。无需引入新 import（除 icons 外无需新增依赖）。不需要加载病例列表（无病例筛选）。

### 后端 — `backend/routers/training.py`

将 `status`、`date_from`、`date_to` 三条筛选逻辑从 `else`（仅教师分支）提取到 `if current_user.role != "teacher"` 判断之后，使所有角色共用。

```python
# 改造前（仅教师可用）：
if current_user.role != "teacher":
    base = base.filter(TrainingRecord.user_id == current_user.id)
else:
    # 筛选逻辑全在 else 里
    if status:
        ...
    if date_from:
        ...

# 改造后（所有角色共用）：
if current_user.role != "teacher":
    base = base.filter(TrainingRecord.user_id == current_user.id)

# 筛选逻辑提取到角色判断之后
if status:
    base = base.filter(TrainingRecord.status == status)
if date_from:
    ...
if date_to:
    ...
```

`student_name` 和 `case_id` 保持仅教师可用（History 前端不传这两个参数）。

### 不变更

- `api.js` — `getRecords(params)` 已支持传参
- `styles/index.css` — `.filter-bar` 样式已存在
- `Pagination` 组件
- 删除记录功能
- 空态/加载/错误展示

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `frontend/src/pages/History.jsx` | 修改 | 添加 filter state + filter-bar UI + params 传参 |
| `backend/routers/training.py` | 修改 | 提取 status/date 筛选到角色判断之外 |

## 测试要点

- 学生角色：选择状态/日期后，分页数据正确筛选（仅自己记录）
- 教师角色：选择状态/日期后，分页数据正确筛选（全部记录）
- 清除过滤：点击后筛选值重置，数据恢复无筛选状态
- 筛选切换时 offset 归零
- 空筛选参数不传入请求，保持向后兼容
