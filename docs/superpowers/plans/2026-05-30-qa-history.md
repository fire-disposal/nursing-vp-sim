# Q&A 历史记录功能 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为护理问答模块增加历史记录持久化、查看及删除功能，同时在老师管理后台增加查看所有学生问答记录的 Tab。

**Architecture:** 新建 `qa_records` 数据库表持久化每次问答，后端新增 3 个 REST 端点（查询个人历史、删除个人记录、老师查询所有记录），前端新增独立历史页面和老师管理 Tab，修改现有 QA 页面和问答端点。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL + Alembic（后端），React 19 + React Router v7 + Axios（前端）

---

### Task 1: 新建 QARecord 数据模型

**Files:**
- Modify: `backend/models.py` (在 LLMCallLog 之后添加)
- Create: `backend/migrations/versions/` (通过 alembic 命令自动生成)

- [ ] **Step 1: 在 models.py 中添加 QARecord 模型**

在 `backend/models.py` 的 LLMCallLog 类定义之后（第 138 行之后），添加以下代码：

```python
class QARecord(Base):
    """通用护理问答记录"""
    __tablename__ = "qa_records"
    __table_args__ = (
        Index("ix_qa_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    user = relationship("User")
```

- [ ] **Step 2: 生成 Alembic 迁移文件**

```bash
cd backend; if ($?) { alembic revision --autogenerate -m "add qa_records" }
```
Expected: 输出生成的文件路径，类似 `migrations/versions/xxxx_add_qa_records.py`

- [ ] **Step 3: 运行迁移**

```bash
cd backend; if ($?) { alembic upgrade head }
```
Expected: 最后一行输出类似 `INFO  [alembic.runtime.migration] Running upgrade ... -> xxxx, add qa_records`

- [ ] **Step 4: 提交**

```bash
git add backend/models.py backend/migrations/versions/xxxx_add_qa_records.py
git commit -m "feat: add QARecord model and migration"
```

---

### Task 2: 新增后端 Schema 和 API 端点

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/routers/qa.py`

- [ ] **Step 1: 在 schemas.py 中添加 Q&A 历史相关 Schema**

在 `backend/schemas.py` 的 QAResponse 之后（第 179 行之后），添加：

```python
class QARecordOut(BaseModel):
    id: int
    question: str
    answer: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QARecordAdminOut(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: Optional[str]
    question: str
    answer: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: 修改 `POST /api/qa/ask` — 保存问答记录**

修改 `backend/routers/qa.py`，在 `answer = await call_llm(...)` 之后、`return` 之前添加持久化逻辑。完整文件变为：

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from models import User, QARecord
from schemas import QARequest, QAResponse, QARecordOut, QARecordAdminOut, PaginatedResponse
from auth import get_current_user, require_teacher
from services.llm_service import call_llm
from rate_limiter import check_qa_limit
from prompts import NURSING_SYSTEM_PROMPT
from pagination import paginate

router = APIRouter(prefix="/api/qa", tags=["通用问答"])


@router.post("/ask", response_model=QAResponse)
async def ask_question(req: QARequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    check_qa_limit(current_user.id)

    messages = [
        {"role": "system", "content": NURSING_SYSTEM_PROMPT},
        {"role": "user", "content": req.question},
    ]

    try:
        answer = await call_llm(messages, temperature=0.7, max_tokens=1024,
                                    purpose="qa", user_id=current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")

    record = QARecord(user_id=current_user.id, question=req.question.strip(), answer=answer)
    db.add(record)
    db.commit()

    return QAResponse(answer=answer)


@router.get("/history", response_model=PaginatedResponse[QARecordOut])
def get_qa_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = db.query(QARecord).filter(
        QARecord.user_id == current_user.id
    ).order_by(QARecord.created_at.desc())

    items, total = paginate(query, offset, limit)
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.delete("/history/{record_id}")
def delete_qa_record(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(QARecord).filter(
        QARecord.id == record_id,
        QARecord.user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(record)
    db.commit()
    return {"detail": "删除成功"}


@router.get("/history/all", response_model=PaginatedResponse[QARecordAdminOut])
def get_all_qa_history(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = db.query(
        QARecord.id,
        QARecord.user_id,
        QARecord.question,
        QARecord.answer,
        QARecord.created_at,
        User.username,
        User.display_name,
    ).join(User, QARecord.user_id == User.id).order_by(QARecord.created_at.desc())

    rows, total = paginate(query, offset, limit)
    items = [
        QARecordAdminOut(
            id=r.id,
            user_id=r.user_id,
            username=r.username,
            display_name=r.display_name,
            question=r.question,
            answer=r.answer,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)
```

- [ ] **Step 3: 测试后端 API**

启动后端：

```bash
cd backend; if ($?) { uvicorn main:app --reload }
```

用 curl 或 pytest 测试：
```bash
# 测试 POST /api/qa/ask（保存记录）
curl -X POST http://localhost:8000/api/qa/ask -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"question":"如何评估心衰患者的水肿程度？"}'

# 测试 GET /api/qa/history
curl -X GET "http://localhost:8000/api/qa/history?offset=0&limit=20" -H "Authorization: Bearer <token>"

# 测试 DELETE /api/qa/history/{id}
curl -X DELETE "http://localhost:8000/api/qa/history/1" -H "Authorization: Bearer <token>"

# 测试 GET /api/qa/history/all（需要老师 token）
curl -X GET "http://localhost:8000/api/qa/history/all?offset=0&limit=20" -H "Authorization: Bearer <token>"
```

Expected:
- POST 返回含 `answer` 字段的 JSON，数据库中出现新记录
- GET `/history` 返回含 `items` 和 `total` 的分页 JSON，仅当前用户的记录
- DELETE 返回 `{"detail":"删除成功"}`，数据库记录删除
- GET `/history/all` 返回所有用户的记录（仅老师可访问）

- [ ] **Step 4: 提交**

```bash
git add backend/schemas.py backend/routers/qa.py
git commit -m "feat: add QA history API endpoints (GET/DELETE history, GET all for teacher)"
```

---

### Task 3: 新增前端 API 函数

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 添加 Q&A 历史 API 函数**

在 `frontend/src/api.js` 的 Q&A 区块（第 164-166 行之后），添加：

```javascript
// Q&A history
export function getQAHistory(params = {}) {
  return api.get("/qa/history", { params });
}

export function deleteQARecord(id) {
  return api.delete(`/qa/history/${id}`);
}

export function getQAHistoryAll(params = {}) {
  return api.get("/qa/history/all", { params });
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api.js
git commit -m "feat: add QA history API client functions"
```

---

### Task 4: 新建 QAHistory 页面（用户端历史记录）

**Files:**
- Create: `frontend/src/pages/QAHistory.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 创建 QAHistory.jsx**

在 `frontend/src/pages/QAHistory.jsx` 中写入：

```javascript
import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { MessageCircle, Trash2 } from "lucide-react";
import { getQAHistory, deleteQARecord } from "../api";
import Layout from "../components/Layout";
import PageHeader from "../components/ui/PageHeader";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import Pagination from "../components/Pagination";

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export default function QAHistory({ user, onLogout }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const LIMIT = 20;
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();

  const fetchRecords = () => {
    setLoading(true);
    getQAHistory({ offset, limit: LIMIT })
      .then(({ data }) => {
        setRecords(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载问答记录失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRecords(); }, [offset]);

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: "删除记录",
      message: "确定删除这条问答记录吗？此操作不可撤销。",
      confirmLabel: "确定删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteQARecord(r.id);
      toast.success("已删除");
      if (expanded === r.id) setExpanded(null);
      fetchRecords();
    } catch (err) {
      toast.error(err.response?.data?.detail || "删除失败");
    }
  };

  const toggleExpand = (id) => setExpanded(expanded === id ? null : id);

  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader
        title="问答历史"
        subtitle="查看你以往的护理知识问答记录"
        icon={MessageCircle}
        backTo="/qa"
      />

      <div className="card">
        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner" />
            <div>加载中...</div>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-soft"><MessageCircle size={42} /></div>
            <div style={{ marginBottom: 16 }}>暂无问答记录</div>
            <Link to="/qa" className="btn btn-primary">去提问</Link>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              共 {total} 条记录
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {records.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <div
                    key={r.id}
                    style={{
                      border: "1px solid var(--gray-200)",
                      borderRadius: "var(--radius-lg)",
                      padding: "16px",
                      cursor: "pointer",
                      background: isOpen ? "var(--gray-50)" : "#fff",
                    }}
                    onClick={() => toggleExpand(r.id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 6, color: "var(--primary)" }}>
                          Q: {isOpen ? r.question : truncate(r.question, 60)}
                        </div>
                        <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          A: {isOpen ? r.answer : truncate(r.answer, 80)}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={(e) => { e.stopPropagation(); handleDelete(r); }}
                        title="删除"
                        style={{ flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: 10 }}>
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: 在 App.jsx 中添加路由和 lazy import**

修改 `frontend/src/App.jsx`：

在第 13 行 `const QA = lazy(...)` 之后添加：
```javascript
const QAHistory = lazy(() => import("./pages/QAHistory"));
```

在第 92-94 行 `QA` 路由之后添加：
```javascript
        <Route path="/qa/history" element={
          <ProtectedRoute><QAHistory user={user} onLogout={handleLogout} /></ProtectedRoute>
        } />
```

- [ ] **Step 3: 启动前端验证页面**

```bash
cd frontend; if ($?) { npm run dev }
```
访问 `http://localhost:5173/qa/history`，验证：
- 无记录时显示空状态
- 有记录时显示卡片列表
- 点击卡片可展开/收起
- 删除按钮正常工作
- 分页正常

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/QAHistory.jsx frontend/src/App.jsx
git commit -m "feat: add QA history page with expand/collapse and delete"
```

---

### Task 5: 修改现有 QA 页面增加历史入口

**Files:**
- Modify: `frontend/src/pages/QA.jsx`

- [ ] **Step 1: 在 QA.jsx 顶部增加历史记录链接**

修改 `frontend/src/pages/QA.jsx`：

将 import 中的 `useSearchParams` 替换为加入 `Link`：
```javascript
import { useSearchParams, Link } from "react-router-dom";
```

将 PageHeader 组件增加 actions 属性，添加历史记录链接：
```javascript
      <PageHeader
        title="护理问答"
        subtitle="向AI护理导师提问护理专业知识，获取即时解答"
        icon={MessageCircle}
        actions={
          <Link to="/qa/history" className="btn btn-sm" style={{ textDecoration: "none" }}>
            查看历史记录
          </Link>
        }
      />
```

- [ ] **Step 2: 验证点击链接可跳转到历史页面**

访问 `http://localhost:5173/qa`，点击"查看历史记录"，确认跳转到 `/qa/history`，且"返回"按钮可回到 `/qa`。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/QA.jsx
git commit -m "feat: add history link to QA page header"
```

---

### Task 6: 新建老师管理后台 Q&A 记录 Tab

**Files:**
- Create: `frontend/src/components/teacher/QARecordsTab.jsx`
- Modify: `frontend/src/pages/Admin.jsx`

- [ ] **Step 1: 创建 QARecordsTab.jsx**

在 `frontend/src/components/teacher/QARecordsTab.jsx` 中写入：

```javascript
import { useState, useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { getQAHistoryAll } from "../../api";
import { useToast } from "../Toast";
import Pagination from "../../components/Pagination";

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export default function QARecordsTab() {
  const [records, setRecords] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const LIMIT = 20;
  const toast = useToast();

  useEffect(() => {
    getQAHistoryAll({ offset, limit: LIMIT })
      .then(({ data }) => {
        setRecords(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error("加载问答记录失败"));
  }, [offset, toast]);

  const toggleExpand = (id) => setExpanded(expanded === id ? null : id);

  return (
    <div className="card">
      <div style={{ marginBottom: 16, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        共 {total} 条问答记录
      </div>
      {records.length === 0 ? (
        <div className="empty-state">
          <div className="icon"><MessageCircle size={42} /></div>
          <div>暂无问答记录</div>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>学生</th>
              <th>学号</th>
              <th>问题</th>
              <th>回答</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <tr
                  key={r.id}
                  onClick={() => toggleExpand(r.id)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ fontWeight: 500 }}>{r.display_name || r.username}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{r.display_name ? r.username : "-"}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "normal" : "nowrap" }}>
                    {isOpen ? r.question : truncate(r.question, 40)}
                  </td>
                  <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "normal" : "nowrap" }}>
                    {isOpen ? r.answer : truncate(r.answer, 50)}
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {new Date(r.created_at).toLocaleString("zh-CN")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
    </div>
  );
}
```

- [ ] **Step 2: 在 Admin.jsx 中注册 Tab**

修改 `frontend/src/pages/Admin.jsx`：

在 top import 区域添加：
```javascript
import QARecordsTab from "../components/teacher/QARecordsTab";
```

在 `ADMIN_TABS` 数组中（第 16 行）最后一个元素后添加逗号，再添加：
```javascript
  { key: "qa-records", label: "问答记录" },
```

完整 `ADMIN_TABS` 应为：
```javascript
const ADMIN_TABS = [
  { key: "records", label: "训练记录" },
  { key: "users", label: "用户管理" },
  { key: "cases", label: "病例管理" },
  { key: "monitor", label: "调用监控" },
  { key: "qa-records", label: "问答记录" },
];
```

在 Tab 渲染区域（第 34 行之后）添加：
```javascript
      {activeTab === "qa-records" && <QARecordsTab />}
```

- [ ] **Step 3: 用老师账号测试**

访问 `http://localhost:5173/admin`，点击"问答记录" Tab，验证：
- 表格显示所有学生的问答记录
- 点击行可展开完整问答内容
- 分页正常工作
- 学生身份无法访问 `/admin` 路由

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/teacher/QARecordsTab.jsx frontend/src/pages/Admin.jsx
git commit -m "feat: add QA records tab to teacher admin panel"
```

---

### Task 7: 最终验证与集成测试

- [ ] **Step 1: 运行后端测试**

```bash
cd backend; if ($?) { python -m pytest -v }
```

- [ ] **Step 2: 运行前端构建检查**

```bash
cd frontend; if ($?) { npm run build }
```
Expected: 无编译错误

- [ ] **Step 3: 端到端手动验证清单**

| 场景 | 预期结果 |
|------|---------|
| 学生在 `/qa` 提问 | 问题发送、回答返回、记录保存到数据库 |
| 学生访问 `/qa/history` | 显示自己的历史记录卡片，按时间倒序 |
| 学生点击卡片 | 展开完整问答内容 |
| 学生删除记录 | 确认弹窗 → 删除成功，列表刷新 |
| 学生尝试删除他人记录 | API 返回 404（校验 user_id） |
| 学生在历史页点击"返回" | 跳转回 `/qa` |
| 老师在 `/admin` 点击"问答记录" Tab | 表格显示所有学生记录，含学生姓名 |
| 老师点击行展开 | 完整问答内容可见 |
| 分页 | offset/limit 翻页正常 |
| 非登录用户访问 | 重定向到 `/login` |
| 学生访问 `/admin` | 拒绝访问 |

- [ ] **Step 4: 提交**

```bash
git commit -m "feat: finalize QA history feature with end-to-end verification"
```

---

## 涉及文件总览

| 文件 | 操作 |
|------|------|
| `backend/models.py` | 新增 QARecord 模型 |
| `backend/migrations/versions/xxx.py` | 新迁移文件（自动生成） |
| `backend/schemas.py` | 新增 QARecordOut、QARecordAdminOut |
| `backend/routers/qa.py` | 重写：增加历史/删除/全部端点 |
| `frontend/src/api.js` | 新增 3 个 API 函数 |
| `frontend/src/pages/QAHistory.jsx` | 新建页面 |
| `frontend/src/App.jsx` | 新增路由和 lazy import |
| `frontend/src/pages/QA.jsx` | 增加历史入口链接 |
| `frontend/src/components/teacher/QARecordsTab.jsx` | 新建老师 Tab |
| `frontend/src/pages/Admin.jsx` | 注册新 Tab |
