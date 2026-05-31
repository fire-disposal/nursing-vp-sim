# QA 多轮对话改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将护理问答从单问单答改为 ChatGPT 风格多轮对话，左侧常驻会话历史侧边栏。

**Architecture:** 后端新增 `qa_sessions` 表重构 `qa_records` 为通用消息格式；前端 QA.jsx 集成分页侧边栏 + 对话区；教师面板改造为 sessions 维度预览对话。

**Tech Stack:** Python FastAPI + SQLAlchemy + Alembic / React + Vite + CSS Modules

---

### Task 1: 数据库迁移

**Files:**
- Create: `backend/migrations/versions/<auto_hash>_qa_multiturn.py`
- Modify: `backend/models.py`

- [ ] **Step 1: 生成空迁移文件**

```bash
cd backend && alembic revision -m "qa_multiturn"
```

- [ ] **Step 2: 编写 migration upgrade — 新建 qa_sessions 表，改造 qa_records**

在 `upgrade()` 中：

```python
def upgrade():
    # 1. 创建 qa_sessions 表
    op.create_table("qa_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(80), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_qa_sessions_user_updated", "qa_sessions", ["user_id", "updated_at"])

    # 2. qa_records 加新字段
    op.add_column("qa_records", sa.Column("session_id", sa.Integer(), sa.ForeignKey("qa_sessions.id"), nullable=True))
    op.add_column("qa_records", sa.Column("role", sa.String(20), nullable=True))
    op.add_column("qa_records", sa.Column("content", sa.Text(), nullable=True))
    op.create_index("ix_qa_session_created", "qa_records", ["session_id", "created_at"])

    # 3. 数据迁移: 每行原 qa_records → 1 session + 2 条新 record
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, user_id, question, answer, created_at FROM qa_records ORDER BY id")).fetchall()
    for r in rows:
        title = (r.question or "")[:40]
        conn.execute(sa.text("INSERT INTO qa_sessions (user_id, title, created_at, updated_at) VALUES (:uid, :title, :ts, :ts)"),
                     {"uid": r.user_id, "title": title, "ts": r.created_at})
        sid = conn.execute(sa.text("SELECT last_insert_rowid()" if "sqlite" in str(conn.engine.url) else "SELECT lastval()")).scalar()
        conn.execute(sa.text("UPDATE qa_records SET session_id = :sid, role = 'user', content = question WHERE id = :rid"),
                     {"sid": sid, "rid": r.id})
        conn.execute(sa.text("INSERT INTO qa_records (session_id, user_id, role, content, created_at) VALUES (:sid, :uid, 'assistant', :ans, :ts)"),
                     {"sid": sid, "uid": r.user_id, "ans": r.answer or "", "ts": r.created_at})
    conn.commit()

    # 4. 设置 not null
    op.alter_column("qa_records", "session_id", nullable=False)
    op.alter_column("qa_records", "role", nullable=False)
    op.alter_column("qa_records", "content", nullable=False)

    # 5. 删除旧字段
    op.drop_column("qa_records", "question")
    op.drop_column("qa_records", "answer")
```

在 `downgrade()` 中：

```python
def downgrade():
    # 反向数据迁移: 按 session 归并回 question/answer
    op.add_column("qa_records", sa.Column("question", sa.Text(), nullable=True))
    op.add_column("qa_records", sa.Column("answer", sa.Text(), nullable=True))

    conn = op.get_bind()
    sessions = conn.execute(sa.text("SELECT id FROM qa_sessions")).fetchall()
    for s in sessions:
        user_msg = conn.execute(sa.text("SELECT id, content FROM qa_records WHERE session_id = :sid AND role = 'user' ORDER BY created_at LIMIT 1"), {"sid": s.id}).fetchone()
        assistant_msg = conn.execute(sa.text("SELECT id, content FROM qa_records WHERE session_id = :sid AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"), {"sid": s.id}).fetchone()
        if user_msg:
            conn.execute(sa.text("UPDATE qa_records SET question = :q, answer = :a WHERE id = :rid"),
                         {"q": user_msg.content, "a": assistant_msg.content if assistant_msg else "", "rid": user_msg.id})
        # 删除 assistant 角色的多余行
        if assistant_msg and user_msg and assistant_msg.id != user_msg.id:
            conn.execute(sa.text("DELETE FROM qa_records WHERE id = :rid"), {"rid": assistant_msg.id})
    conn.commit()

    op.drop_index("ix_qa_session_created", table_name="qa_records")
    op.drop_column("qa_records", "content")
    op.drop_column("qa_records", "role")
    op.drop_column("qa_records", "session_id")
    op.drop_index("ix_qa_sessions_user_updated", table_name="qa_sessions")
    op.drop_table("qa_sessions")
```

- [ ] **Step 3: 更新 models.py — 新增 QASession，改造 QARecord**

```python
# 在 models.py 中，替换原有的 QARecord 类，并新增 QASession

class QASession(Base):
    __tablename__ = "qa_sessions"
    __table_args__ = (
        Index("ix_qa_sessions_user_updated", "user_id", "updated_at"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User")
    records = relationship("QARecord", back_populates="session", order_by="QARecord.created_at")


class QARecord(Base):
    __tablename__ = "qa_records"
    __table_args__ = (
        Index("ix_qa_session_created", "session_id", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("qa_sessions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

    user = relationship("User")
    session = relationship("QASession", back_populates="records")
```

- [ ] **Step 4: 从 models.py 删除旧 QARecord 类**（位于约第 147-160 行）

- [ ] **Step 5: 运行迁移并测试**

Run: `cd backend && alembic upgrade head`
Expected: 迁移成功，无报错。验证 `qa_sessions` 和 `qa_records` 表结构正确。

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/migrations/
git commit -m "♻️ refactor: qa 多轮对话数据模型 — 新 qa_sessions 表 + qa_records 通用消息格式"
```

---

### Task 2: 后端 Schemas

**Files:**
- Modify: `backend/schemas.py`

- [ ] **Step 1: 在 schemas.py 末尾新增 session 相关 schema**

```python
# ── QA 多轮对话 ──

class QASessionCreate(BaseModel):
    question: str

class QASessionItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class QAMessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class QAAskRequest(BaseModel):
    question: str

class QAAskResponse(BaseModel):
    session_id: int
    answer: str

class QASessionAdminItem(BaseModel):
    id: int
    user_id: int
    student_name: str = ""
    student_code: str = ""
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: Commit**

```bash
git add backend/schemas.py
git commit -m "✨ feat: qa 多轮对话 schemas"
```

---

### Task 3: 后端 qa.py 路由重写

**Files:**
- Modify: `backend/routers/qa.py`

- [ ] **Step 1: 替换 qa.py 全部内容**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from database import get_db
from models import User, QASession, QARecord
from schemas import (
    QASessionCreate, QASessionItem, QAMessageItem,
    QAAskRequest, QAAskResponse, QASessionAdminItem,
    PaginatedResponse,
)
from auth import get_current_user, require_teacher
from services.llm_service import call_llm
from rate_limiter import check_qa_limit
from services.prompt_manager import get_prompt_manager
from pagination import paginate
from logger import log_info

router = APIRouter(prefix="/api/qa", tags=["通用问答"])


def _build_llm_context(session_id: int, question: str, db: Session) -> list:
    """构建 LLM 上下文消息列表（最近 16 条历史 + 新问题）"""
    history = db.query(QARecord).filter(
        QARecord.session_id == session_id
    ).order_by(QARecord.created_at.desc()).limit(16).all()
    history.reverse()
    llm_messages = []
    for r in history:
        role = "user" if r.role == "user" else "assistant"
        llm_messages.append({"role": role, "content": r.content})
    llm_messages.append({"role": "user", "content": question})
    return llm_messages


@router.post("/sessions", response_model=QAAskResponse)
async def create_session(
    req: QASessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    check_qa_limit(current_user.id)

    session = QASession(
        user_id=current_user.id,
        title=req.question.strip()[:40],
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    user_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=req.question.strip(),
    )
    db.add(user_msg)
    db.commit()

    pm = await get_prompt_manager()
    tmpl = await pm.get("qa")
    llm_messages = [
        {"role": "system", "content": tmpl.render()},
        {"role": "user", "content": req.question},
    ]

    try:
        answer = await call_llm(llm_messages, temperature=0.7, max_tokens=1024,
                                purpose="qa", user_id=current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")

    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=answer,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    log_info(f"新会话创建: session_id={session.id} q_len={len(req.question)}",
             user_id=current_user.id, user_role=current_user.role)
    return QAAskResponse(session_id=session.id, answer=answer)


@router.post("/sessions/{session_id}/ask", response_model=QAAskResponse)
async def ask_in_session(
    session_id: int,
    req: QAAskRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    session = db.query(QASession).filter(
        QASession.id == session_id,
        QASession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    check_qa_limit(current_user.id)

    user_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=req.question.strip(),
    )
    db.add(user_msg)
    db.commit()

    llm_messages = _build_llm_context(session_id, req.question.strip(), db)

    pm = await get_prompt_manager()
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render()})

    try:
        answer = await call_llm(llm_messages, temperature=0.7, max_tokens=1024,
                                purpose="qa", user_id=current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")

    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=answer,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    log_info(f"会话追问: session_id={session_id} q_len={len(req.question)}",
             user_id=current_user.id, user_role=current_user.role)
    return QAAskResponse(session_id=session.id, answer=answer)


@router.get("/sessions", response_model=list[QASessionItem])
def list_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sessions = db.query(QASession).filter(
        QASession.user_id == current_user.id
    ).order_by(QASession.updated_at.desc()).all()
    return sessions


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.query(QASession).filter(
        QASession.id == session_id,
        QASession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    db.query(QARecord).filter(QARecord.session_id == session_id).delete()
    db.delete(session)
    db.commit()

    log_info(f"会话删除: session_id={session_id}",
             user_id=current_user.id, user_role=current_user.role)
    return {"detail": "删除成功"}


@router.get("/sessions/{session_id}/messages", response_model=list[QAMessageItem])
def get_session_messages(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = db.query(QASession).filter(
        QASession.id == session_id,
        QASession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    messages = db.query(QARecord).filter(
        QARecord.session_id == session_id
    ).order_by(QARecord.created_at.asc()).all()
    return messages


# ── 兼容旧端点 ──

@router.post("/ask", response_model=QAAskResponse)
async def ask_question_legacy(req: QASessionCreate, **kwargs):
    """已废弃，自动转发到 /sessions"""
    return await create_session(req, **kwargs)


@router.get("/history/all", response_model=PaginatedResponse[QASessionAdminItem])
def get_all_qa_history(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    base = db.query(
        QASession.id,
        QASession.user_id,
        QASession.title,
        QASession.created_at,
        QASession.updated_at,
        User.display_name.label("student_name"),
        User.student_id.label("student_code"),
        func.count(QARecord.id).label("message_count"),
    ).join(User, QASession.user_id == User.id).join(
        QARecord, QARecord.session_id == QASession.id
    ).group_by(QASession.id, User.display_name, User.student_id).order_by(
        QASession.updated_at.desc()
    )

    rows, total = paginate(base, offset, limit)
    items = [
        QASessionAdminItem(
            id=r.id,
            user_id=r.user_id,
            student_name=r.student_name or "",
            student_code=r.student_code or "",
            title=r.title,
            message_count=r.message_count,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/history/all/{session_id}/messages", response_model=list[QAMessageItem])
def get_session_messages_admin(
    session_id: int,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    messages = db.query(QARecord).filter(
        QARecord.session_id == session_id
    ).order_by(QARecord.created_at.asc()).all()
    return messages
```

- [ ] **Step 2: Commit**

```bash
git add backend/routers/qa.py
git commit -m "✨ feat: qa 多轮对话 API — sessions CRUD + 多轮上下文"
```

---

### Task 4: 后端测试更新

**Files:**
- Modify: `backend/tests/test_qa.py`

- [ ] **Step 1: 重写 test_qa.py**

```python
from unittest.mock import patch, AsyncMock
from fastapi import status

class TestQAMultiTurn:
    def test_create_session_and_ask(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "护理评估应包括生命体征测量。"
            resp = client.post("/api/qa/sessions",
                json={"question": "如何进行护理评估？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["answer"] == "护理评估应包括生命体征测量。"
            assert data["session_id"] > 0

    def test_list_sessions(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "回答A。"
            client.post("/api/qa/sessions",
                json={"question": "问题1"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            mock_llm.return_value = "回答B。"
            client.post("/api/qa/sessions",
                json={"question": "问题2"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
        resp = client.get("/api/qa/sessions",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_get_session_messages(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "回答。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "测试问题"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]
        resp = client.get(f"/api/qa/sessions/{sid}/messages",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["role"] == "user"
        assert data[0]["content"] == "测试问题"
        assert data[1]["role"] == "assistant"

    def test_delete_session(self, client, student, db_session):
        from models import QASession, QARecord
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "回答。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "待删除"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]
        resp = client.delete(f"/api/qa/sessions/{sid}",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        assert db_session.query(QASession).filter(QASession.id == sid).count() == 0
        assert db_session.query(QARecord).filter(QARecord.session_id == sid).count() == 0

    def test_cannot_access_other_users_session(self, client, student, teacher, db_session):
        from models import QASession, QARecord
        # teacher creates a session
        session = QASession(user_id=teacher[0].id, title="教师会话")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        msg = QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题")
        db_session.add(msg)
        db_session.commit()

        # student tries to access
        resp = client.get(f"/api/qa/sessions/{session.id}/messages",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 404

    def test_student_cannot_view_all_history(self, client, student):
        resp = client.get("/api/qa/history/all",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_teacher_views_all_history(self, client, teacher, db_session):
        from models import QASession, QARecord
        session = QASession(user_id=teacher[0].id, title="测试")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        msg = QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题")
        db_session.add(msg)
        db_session.commit()

        resp = client.get("/api/qa/history/all",
            headers={"Authorization": f"Bearer {teacher[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    def test_multi_turn_context(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "回答1。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "怎么测血压？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]

            mock_llm.return_value = "回答2。"
            ask_resp = client.post(f"/api/qa/sessions/{sid}/ask",
                json={"question": "有哪些注意事项？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            assert ask_resp.status_code == 200

            # 验证第二次调用的 messages 包含了上下文字段（至少有 system + 4条消息）
            call_args = mock_llm.call_args_list[-1]
            messages = call_args[0][0]
            user_contents = [m["content"] for m in messages if m["role"] == "user"]
            assert "怎么测血压？" in user_contents
            assert "有哪些注意事项？" in user_contents
```

- [ ] **Step 2: 运行测试验证**

Run: `cd backend && python -m pytest tests/test_qa.py -v`
Expected: 8 tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_qa.py
git commit -m "✅ test: qa 多轮对话测试覆盖"
```

---

### Task 5: 前端 API 层

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: 替换 api.js 中 QA 相关函数（约第 161-176 行）**

```js
// Q&A (多轮会话)
export function createQASession(question) {
  return api.post("/qa/sessions", { question });
}

export function getQASessions() {
  return api.get("/qa/sessions");
}

export function deleteQASession(id) {
  return api.delete(`/qa/sessions/${id}`);
}

export function getQASessionMessages(sessionId) {
  return api.get(`/qa/sessions/${sessionId}/messages`);
}

export function askInQASession(sessionId, question) {
  return api.post(`/qa/sessions/${sessionId}/ask`, { question });
}

export function getQAHistoryAll(params = {}) {
  return api.get("/qa/history/all", { params });
}

export function getQASessionMessagesAdmin(sessionId) {
  return api.get(`/qa/history/all/${sessionId}/messages`);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "✨ feat: qa 多轮对话前端 API 函数"
```

---

### Task 6: 前端 QA.jsx 重写

**Files:**
- Modify: `frontend/src/pages/QA.jsx`

- [ ] **Step 1: 完整替换 QA.jsx**

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Plus, Trash2, Lightbulb, ChevronLeft, ChevronRight, Hash } from "lucide-react";
import Layout from "../components/Layout";
import PageHeader from "../components/PageHeader";
import {
  createQASession, getQASessions, deleteQASession,
  getQASessionMessages, askInQASession,
} from "../api";

const SUGGESTIONS = ["病史采集技巧", "护理评估方法", "护理诊断与医疗诊断区别", "无菌技术要点", "生命体征测量规范"];

export default function QA({ user, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await getQASessions();
      setSessions(res.data || []);
    } catch (e) {
      console.error("加载会话列表失败", e);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const switchSession = useCallback(async (sessionId) => {
    try {
      const res = await getQASessionMessages(sessionId);
      setActiveSessionId(sessionId);
      setMessages(res.data || []);
    } catch (e) {
      console.error("加载会话消息失败", e);
    }
  }, []);

  const createNewSession = useCallback(async (question) => {
    setLoading(true);
    try {
      const res = await createQASession(question);
      const { session_id, answer } = res.data;
      setActiveSessionId(session_id);
      setMessages([
        { id: 0, role: "user", content: question, created_at: new Date().toISOString() },
        { id: 1, role: "assistant", content: answer, created_at: new Date().toISOString() },
      ]);
      await loadSessions();
    } catch (e) {
      console.error("新建会话失败", e);
      setMessages((prev) => [...prev, { id: -1, role: "assistant", content: "抱歉，AI导师暂时无法回复，请稍后重试。" }]);
    } finally {
      setLoading(false);
    }
  }, [loadSessions]);

  const sendMessage = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    const optimisticId = -Date.now();

    if (!activeSessionId) {
      // 无活跃会话 → 新建
      createNewSession(q);
      return;
    }

    setMessages((prev) => [...prev, { id: optimisticId, role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await askInQASession(activeSessionId, q);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        { id: optimisticId, role: "user", content: q },
        { id: optimisticId + 1, role: "assistant", content: res.data.answer },
      ]);
      await loadSessions();
    } catch (e) {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticId),
        { id: optimisticId, role: "user", content: q },
        { id: -1, role: "assistant", content: "抱歉，AI导师暂时无法回复：" + (e.response?.data?.detail || e.message) },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeSessionId, createNewSession, loadSessions]);

  const handleDeleteSession = useCallback(async (e, sessionId) => {
    e.stopPropagation();
    if (!confirm("确定要删除此会话？")) return;
    try {
      await deleteQASession(sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
      await loadSessions();
    } catch (e) {
      console.error("删除会话失败", e);
    }
  }, [activeSessionId, loadSessions]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestionClick = (s) => {
    setInput(s);
    setTimeout(() => sendMessage(), 0);
  };

  return (
    <Layout user={user} onLogout={onLogout}>
      <div className="qa-layout">
        {/* 侧边栏 */}
        <aside className="qa-sidebar">
          <button className="qa-new-btn" onClick={() => { setActiveSessionId(null); setMessages([]); inputRef.current?.focus(); }}>
            <Plus size={16} />
            <span>新对话</span>
          </button>
          <div className="qa-session-list">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`qa-session-item ${activeSessionId === s.id ? "active" : ""}`}
                onClick={() => switchSession(s.id)}
              >
                <span className="qa-session-title">{s.title}</span>
                <span className="qa-session-time">{new Date(s.updated_at).toLocaleDateString()}</span>
                <button className="qa-session-delete" onClick={(e) => handleDeleteSession(e, s.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && <div className="qa-session-empty">暂无历史对话</div>}
          </div>
        </aside>

        {/* 对话区 */}
        <main className="qa-main">
          {!activeSessionId && messages.length === 0 ? (
            <div className="qa-empty-state">
              <Lightbulb size={48} className="qa-empty-icon" />
              <h2>护理问答</h2>
              <p>向AI护理导师提问，获取专业的护理学知识解答</p>
              <div className="qa-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="qa-suggestion-btn" onClick={() => handleSuggestionClick(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="qa-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`qa-bubble ${m.role}`}>
                    <div className="qa-bubble-content">{m.content}</div>
                  </div>
                ))}
                {loading && (
                  <div className="qa-bubble assistant">
                    <div className="qa-typing">
                      <span className="qa-typing-dot" />
                      <span className="qa-typing-dot" />
                      <span className="qa-typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="qa-input-row">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入您的问题..."
                  disabled={loading}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()}>
                  提问
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/QA.jsx
git commit -m "♻️ refactor: QA 多轮对话页面 — 侧边栏会话列表 + 多轮对话区"
```

---

### Task 7: 前端清理 — 移除 QAHistory 页面和路由

**Files:**
- Delete: `frontend/src/pages/QAHistory.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 从 App.jsx 移除 QAHistory 路由和 lazy import**

在 App.jsx 中：
- 删除 `const QAHistory = lazy(() => import("./pages/QAHistory"));` 行
- 删除整个 `/qa/history` Route 块（约 135-142 行）

- [ ] **Step 2: 删除 QAHistory.jsx 文件**

```bash
rm frontend/src/pages/QAHistory.jsx
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QAHistory.jsx frontend/src/App.jsx
git commit -m "🔥 chore: 移除独立 QAHistory 页面和路由"
```

---

### Task 8: 前端 CSS 新增样式

**Files:**
- Modify: `frontend/src/styles/index.css`

- [ ] **Step 1: 在 index.css 末尾追加 QA 多轮对话样式**

```css
/* ── QA 多轮对话布局 ── */
.qa-layout {
  display: flex;
  height: calc(100vh - 64px);
  overflow: hidden;
}

.qa-sidebar {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid var(--border, #e5e7eb);
  display: flex;
  flex-direction: column;
  background: #fafbfc;
}

.qa-new-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px;
  padding: 10px 16px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 0.88rem;
  color: #374151;
  transition: all 0.15s;
}

.qa-new-btn:hover {
  background: #f3f4f6;
  border-color: #2563eb;
  color: #2563eb;
}

.qa-session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.qa-session-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 8px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}

.qa-session-item:hover,
.qa-session-item.active {
  background: #e8edf5;
}

.qa-session-item .qa-session-delete {
  grid-row: 1 / 3;
  grid-column: 2;
  align-self: center;
  opacity: 0;
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.12s;
}

.qa-session-item:hover .qa-session-delete {
  opacity: 1;
}

.qa-session-item .qa-session-delete:hover {
  color: #ef4444;
  background: #fee2e2;
}

.qa-session-title {
  font-size: 0.85rem;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qa-session-time {
  font-size: 0.72rem;
  color: #9ca3af;
}

.qa-session-empty {
  padding: 24px 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 0.85rem;
}

/* ── 主对话区 ── */
.qa-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.qa-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}

.qa-empty-icon {
  color: #93c5fd;
  margin-bottom: 8px;
}

.qa-empty-state h2 {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.qa-empty-state p {
  color: #6b7280;
  font-size: 0.92rem;
  max-width: 360px;
}

.qa-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.qa-suggestion-btn {
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  border-radius: 20px;
  background: #fff;
  font-size: 0.85rem;
  color: #374151;
  cursor: pointer;
  transition: all 0.12s;
}

.qa-suggestion-btn:hover {
  border-color: #2563eb;
  color: #2563eb;
  background: #eff6ff;
}

/* ── 气泡样式增强 ── */
.qa-bubble-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.qa-typing {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.qa-typing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  animation: qa-bounce 1.4s infinite ease-in-out both;
}

.qa-typing-dot:nth-child(1) { animation-delay: -0.32s; }
.qa-typing-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes qa-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles/index.css
git commit -m "💄 style: QA 多轮对话布局样式 — 侧边栏 + 对话区 + 气泡增强"
```

---

### Task 9: 教师面板 QARecordsTab 改造

**Files:**
- Modify: `frontend/src/components/teacher/QARecordsTab.jsx`

- [ ] **Step 1: 替换 QARecordsTab.jsx**

```jsx
import { useEffect, useState } from "react";
import { MessageCircle, Eye } from "lucide-react";
import { getQAHistoryAll, getQASessionMessagesAdmin } from "../../api";
import Pagination from "../../components/Pagination";
import Modal from "../Modal";
import { useToast } from "../Toast";

function truncate(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export default function QARecordsTab() {
  const [records, setRecords] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [previewMessages, setPreviewMessages] = useState([]);
  const [previewTitle, setPreviewTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const LIMIT = 20;

  const { showToast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await getQAHistoryAll({ offset, limit: LIMIT });
        setRecords(res.data.items || []);
        setTotal(res.data.total || 0);
      } catch {
        showToast("加载问答记录失败", "error");
      }
    };
    fetchData();
  }, [offset, LIMIT]);

  const handlePreview = async (sessionId, title) => {
    setPreviewTitle(title);
    setLoadingPreview(true);
    setShowPreview(true);
    try {
      const res = await getQASessionMessagesAdmin(sessionId);
      setPreviewMessages(res.data || []);
    } catch {
      showToast("加载对话详情失败", "error");
    } finally {
      setLoadingPreview(false);
    }
  };

  if (records.length === 0 && offset === 0) {
    return (
      <div className="empty-state" style={{ padding: "48px 0" }}>
        <MessageCircle size={48} />
        <p style={{ marginTop: 12, color: "var(--gray-500)" }}>暂无问答记录</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ marginBottom: 12, color: "var(--gray-500)", fontSize: "0.88rem" }}>
        共 {total} 条问答会话
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>学生</th>
            <th>学号</th>
            <th>会话标题</th>
            <th>消息数</th>
            <th>最后活跃</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td style={{ fontWeight: 600 }}>{r.student_name || r.student_code}</td>
              <td>{r.student_code || "-"}</td>
              <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {truncate(r.title, 40)}
              </td>
              <td>{r.message_count}</td>
              <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#6b7280" }}>
                {new Date(r.updated_at).toLocaleString("zh-CN")}
              </td>
              <td>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => handlePreview(r.id, r.title)}
                >
                  <Eye size={14} /> 查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination offset={offset} limit={LIMIT} total={total} onPageChange={setOffset} />

      {showPreview && (
        <Modal onClose={() => setShowPreview(false)} title={`对话预览：${previewTitle}`}>
          <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 0" }}>
            {loadingPreview ? (
              <p style={{ textAlign: "center", color: "#9ca3af" }}>加载中...</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {previewMessages.map((m, i) => (
                  <div
                    key={m.id || i}
                    style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "70%",
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: m.role === "user" ? "#2563eb" : "#f4f5f7",
                      color: m.role === "user" ? "#fff" : "#1f2937",
                      fontSize: "0.88rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 检查 Modal 组件导入路径**

确认 `import Modal from "../Modal";` 与实际文件路径一致（`frontend/src/components/ui/Modal.jsx` 或 `frontend/src/components/Modal.jsx`）。根据项目实际调整。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/QARecordsTab.jsx
git commit -m "♻️ refactor: 教师 QARecordsTab — sessions 维度 + 对话预览 Modal"
```

---

### Task 10: 全部测试验证

- [ ] **Step 1: 运行后端测试**

```bash
cd backend && python -m pytest tests/test_qa.py tests/ -v --tb=short
```
Expected: 所有测试 PASS（含新的 QA 测试）

- [ ] **Step 2: 运行前端 lint**

```bash
cd frontend && npm run lint
```
Expected: 无新增错误

- [ ] **Step 3: 运行前端 build 验证**

```bash
cd frontend && npm run build
```
Expected: build 成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "✅ test: qa 多轮对话全量测试验证通过"
```

---

### Task 11: 推送

- [ ] **Step 1: 推送全部提交**

```bash
git push
```
