# Q&A 历史记录功能设计文档

## 概述

为护理问答模块增加查看以前提问及回答记录的功能。当前 Q&A 完全无状态，每次问答不保存任何内容。本次改动将：
1. 持久化每次问答到数据库
2. 提供用户查看/删除自己历史记录的独立页面
3. 在老师管理后台增加查看所有学生问答记录的 Tab

## 数据模型

### 新建 `qa_records` 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | Integer | PK, AUTOINCREMENT | 主键 |
| user_id | Integer | FK → users.id, NOT NULL, INDEX | 提问用户 |
| question | Text | NOT NULL | 问题内容 |
| answer | Text | NOT NULL | AI 回答内容 |
| created_at | DateTime | NOT NULL, DEFAULT NOW, INDEX DESC | 创建时间 |

使用 Alembic 创建迁移文件。`user_id` 和 `created_at` 字段建立索引以加速分页查询。

## 后端 API

### 修改现有端点

**`POST /api/qa/ask`** — 修改 `backend/routers/qa.py`

在获取 AI 回答后、返回响应前，将问答保存到 `qa_records` 表：
```python
record = QARecord(user_id=current_user.id, question=req.question, answer=answer)
db.add(record)
db.commit()
```

Response schema 不变：`{ answer: str }`

### 新增端点

**`GET /api/qa/history`** — 查询当前用户的历史记录

- 权限：已登录用户（`get_current_user`）
- 参数：`offset: int = 0`, `limit: int = 20`
- 返回：`{ items: List[QARecordOut], total: int }`
- 排序：`created_at DESC`
- 筛选：`user_id == current_user.id`

**`DELETE /api/qa/history/{id}`** — 删除自己的某条记录

- 权限：已登录用户
- 校验：记录存在 且 `record.user_id == current_user.id`，否则 404
- 返回：`{ detail: "删除成功" }`

**`GET /api/qa/history/all`** — 老师查看所有学生记录

- 权限：仅老师（`require_teacher`）
- 参数：`offset: int = 0`, `limit: int = 20`
- 返回：`{ items: List[QARecordAdminOut], total: int }`
- 排序：`created_at DESC`
- 每条记录含用户信息：`username`, `display_name`

### Schemas 新增（`backend/schemas.py`）

```python
class QARecordOut(BaseModel):
    id: int
    question: str
    answer: str
    created_at: datetime

class QARecordAdminOut(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: str | None
    question: str
    answer: str
    created_at: datetime

class QAHistoryResponse(BaseModel):
    items: list[QARecordOut]
    total: int

class QAHistoryAdminResponse(BaseModel):
    items: list[QARecordAdminOut]
    total: int
```

## 前端

### 新增页面

**`QAHistory.jsx`** — 路由 `/qa/history`

- 卡片列表展示，每张卡片：
  - 问题内容（超过 2 行截断，展开可看全文）
  - 回答内容（超过 3 行截断，展开可看全文）
  - 提问时间（格式与项目中一致）
  - 删除按钮（点击后确认弹窗，确认后调用 DELETE API）
- 顶部：标题 "问答历史" + "返回提问" 链接按钮（指向 `/qa`）
- 底部：复用 `Pagination` 组件
- 空状态提示："暂无问答记录" + "去提问" 按钮
- CSS 新建 `QAHistory.css`，风格与 `History.css` 保持一致

### 新增组件

**`QARecordsTab.jsx`** — 老师管理后台 Tab

- 在 `Admin.jsx` 的 Tab 列表中新增 "问答记录" Tab
- 表格形式展示所有学生的问答记录
- 列：学生姓名、学号（如有）、问题（截断）、回答（截断）、时间
- 点击行可展开查看完整内容
- 复用 `Pagination` 组件分页

### 修改现有页面

**`QA.jsx`** — 增加历史入口

- 在页面顶部（标题旁）增加 "查看历史记录" 链接按钮，使用 `react-router-dom` 的 `Link` 组件指向 `/qa/history`

**`App.jsx`** — 添加路由

- 新增 `/qa/history` 路由，指向 `QAHistory` 组件

**`Admin.jsx`** — 添加 Tab

- 在 tabs 数组中新增 `{ key: "qa-records", label: "问答记录", component: QARecordsTab }`

### API 客户端函数（`api.js` 新增）

```javascript
export function getQAHistory(offset = 0, limit = 20) {
  return api.get("/qa/history", { params: { offset, limit } });
}

export function deleteQARecord(id) {
  return api.delete(`/qa/history/${id}`);
}

export function getQAHistoryAll(offset = 0, limit = 20) {
  return api.get("/qa/history/all", { params: { offset, limit } });
}
```

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `backend/models.py` | 新增 `QARecord` 模型 |
| `backend/schemas.py` | 新增 4 个 Schema |
| `backend/routers/qa.py` | 修改 `ask` + 新增 3 个端点 |
| `backend/migrations/versions/xxx.py` | 新 Alembic 迁移 |
| `frontend/src/api.js` | 新增 3 个 API 函数 |
| `frontend/src/pages/QAHistory.jsx` | 新建页面 |
| `frontend/src/pages/QAHistory.css` | 新建样式 |
| `frontend/src/components/QARecordsTab.jsx` | 新建老师 Tab 组件 |
| `frontend/src/components/QARecordsTab.css` | 新建样式 |
| `frontend/src/pages/QA.jsx` | 增加历史入口链接 |
| `frontend/src/App.jsx` | 新增路由 |
| `frontend/src/pages/Admin.jsx` | 新增 Tab |

## 不在范围内

- Q&A 多轮对话/上下文记忆
- 关键词搜索、日期筛选
- Q&A 记录的导出功能
- Dashboard 上展示最近 Q&A 记录
