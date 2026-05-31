# QA 多轮对话改造

## 概述

将护理问答从单问单答改为 ChatGPT 风格多轮对话。左侧常驻可折叠历史会话列表，可随时切换/删除会话。移除独立历史记录页面。教师面板支持查看学生完整对话。

---

## 一、数据模型

### 1.1 新表 `qa_sessions`

```python
class QASession(Base):
    __tablename__ = "qa_sessions"
    __table_args__ = (
        Index("ix_qa_sessions_user_updated", "user_id", "updated_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(80), nullable=False)  # 首条用户问题截断前40字
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    records = relationship("QARecord", back_populates="session", order_by="QARecord.created_at")
```

### 1.2 改造 `qa_records`

```python
class QARecord(Base):
    __tablename__ = "qa_records"
    __table_args__ = (
        Index("ix_qa_session_created", "session_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("qa_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)   # "user" | "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    user = relationship("User")
    session = relationship("QASession", back_populates="records")
```

变化：移除 `question`/`answer` → `role` + `content`。

### 1.3 数据迁移策略

已有 `qa_records` 行 `(question, answer)`：
1. 每行生成 1 个 `qa_sessions`（title = question[:40]）
2. 同一行拆为 2 条新 `qa_records`：role=user(content=question) + role=assistant(content=answer)
3. 关联到同一个 `session_id`

---

## 二、API 设计

### 2.1 新接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/qa/sessions` | 新建会话，`{"question": "..."}` → `{session_id, answer}` |
| `GET` | `/api/qa/sessions` | 当前用户会话列表，按 `updated_at DESC` → `[{id, title, created_at, updated_at}]` |
| `DELETE` | `/api/qa/sessions/{id}` | 删除会话及所有消息（校验所属权） |
| `GET` | `/api/qa/sessions/{id}/messages` | 返回该会话全部消息 `[{id, role, content, created_at}]` |
| `POST` | `/api/qa/sessions/{id}/ask` | 在某会话中继续提问 `{"question": "..."}` → `{answer}` |

### 2.2 旧接口处理

| 路径 | 处理 |
|---|---|
| `POST /api/qa/ask` | `@deprecated` 标记，自动创建新 session 后委托到 `/sessions/ask`，保留一个版本 |
| `GET /api/qa/history` | 废弃，返回 301 到 `/api/qa/sessions` |
| `DELETE /api/qa/history/{id}` | 废弃，返回 301 到 `/api/qa/sessions/{id}` |
| `GET /api/qa/history/all` | 改造：返回 sessions 列表含用户信息 + 消息条数 |

### 2.3 ask 接口上下文逻辑

```python
# 取最近 16 条消息（8 轮）作为 LLM 上下文
messages = db.query(QARecord).filter(
    QARecord.session_id == session_id
).order_by(QARecord.created_at.desc()).limit(16).all()
messages.reverse()
```

---

## 三、前端组件

### 3.1 组件树

```
QA.jsx (页面容器)
├── QASidebar (260px, 常驻左侧)
│   ├── "新对话" 按钮
│   ├── QASessionList
│   │   └── QASessionItem × N  (title截断 + 时间 + 删除Hover按钮)
│   └── 空状态
│
└── QAChat (右侧弹性区)
    ├── 空状态 (标题 + 示例问题)
    ├── QAMessageList (气泡, scrollable)
    │   └── QAMessageBubble × N
    └── QAInput (底部固定输入框)
```

### 3.2 状态管理 (QA.jsx)

```
sessions[]        — 侧边栏会话列表
activeSessionId   — 当前选中会话 (null = 空状态)
messages[]        — 当前会话全部消息
loading           — 发送中 / 切换中
```

### 3.3 用户交互流程

1. **进入页面** → 加载 sessions 列表 → 无 activeSession → 显示空状态 + 示例问题
2. **点击"新对话"** → POST sessions → 刷新列表 → 自动聚焦输入框
3. **点击示例问题 / 输入提问** → POST sessions/:id/ask → 追加 user+assistant 气泡
4. **切换会话** → GET sessions/:id/messages → 替换 messages, 滚动到底部
5. **删除会话** → confirm → DELETE sessions/:id → 刷新列表, 若删除的是当前会话则回到空状态
6. **继续提问** → POST sessions/:id/ask → 追加气泡

### 3.4 路由

- `/qa` — QA 页面，支持 `?s={session_id}` 直接跳转
- `/qa/history` — 移除，改为 `/qa` 重定向
- `QAHistory.jsx` — 删除
- `App.jsx` — 移除 `/qa/history` 路由，移除 `QAHistory` lazy import

### 3.5 教师面板 QARecordsTab

改造为 sessions 维度：
- 每行：学生名 | 会话标题 | 消息数 | 最后活跃时间 | 操作(查看对话)
- 点击"查看对话" → Modal 展示完整气泡对话（只读）
- API: `GET /api/qa/history/all`

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/models.py` | 修改 | 新增 QASession，改造 QARecord |
| `backend/schemas.py` | 修改 | 新增 Session 相关 schema，移除旧 QA schema |
| `backend/routers/qa.py` | 重写 | 新 API，保留兼容旧端点 |
| `backend/migrations/versions/*.py` | 新增 | Alembic 迁移 + 数据迁移 |
| `frontend/src/pages/QA.jsx` | 重写 | 多轮对话 + 侧边栏集成 |
| `frontend/src/pages/QAHistory.jsx` | 删除 | 无需 |
| `frontend/src/App.jsx` | 修改 | 移除 QAHistory 路由 |
| `frontend/src/api.js` | 修改 | 新 API 函数 |
| `frontend/src/components/teacher/QARecordsTab.jsx` | 修改 | sessions 维度 + 对话预览 Modal |
| `frontend/src/styles/index.css` | 修改 | 新增 sidebar / 改造 bubble 样式 |

---

## 五、不纳入范围

- QA 回答的 SSE 流式输出（保持同步返回）
- 会话重命名功能
- 会话搜索/过滤
- 多用户共享会话
