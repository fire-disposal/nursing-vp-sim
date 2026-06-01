from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, QASession, QARecord
from schemas import (
    QASessionCreate, QASessionItem, QAMessageItem,
    QAAskResponse, QASessionAdminItem,
    PaginatedResponse,
)
from auth import get_current_user, require_teacher
from services.llm_service import call_llm
from rate_limiter import check_qa_limit
from services.prompt_manager import get_prompt_manager
from pagination import paginate
from logger import log_info, log_error

router = APIRouter(prefix="/api/qa", tags=["通用问答"])


def _build_llm_context(session_id: int, db: Session) -> list:
    history = db.query(QARecord).filter(
        QARecord.session_id == session_id
    ).order_by(QARecord.created_at.desc()).limit(16).all()
    history.reverse()
    llm_messages = []
    for r in history:
        role = "user" if r.role == "user" else "assistant"
        llm_messages.append({"role": role, "content": r.content})
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

    try:
        pm = await get_prompt_manager()
        tmpl = await pm.get("qa")
        llm_messages = [
            {"role": "system", "content": tmpl.render()},
            {"role": "user", "content": req.question},
        ]
    except Exception as e:
        log_error("qa prompt 初始化失败", error=str(e), user_id=current_user.id)
        raise HTTPException(status_code=500, detail=f"Prompt加载失败: {str(e)}")

    try:
        answer = await call_llm(llm_messages, temperature=0.7, max_tokens=1024,
                                purpose="qa", user_id=current_user.id)
    except Exception as e:
        log_error("qa LLM调用失败", error=str(e), user_id=current_user.id)
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
    req: QASessionCreate,
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

    llm_messages = _build_llm_context(session_id, db)

    pm = await get_prompt_manager()
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render()})

    try:
        answer = await call_llm(llm_messages, temperature=0.7, max_tokens=1024,
                                purpose="qa", user_id=current_user.id)
    except Exception as e:
        log_error("qa 追问LLM调用失败", error=str(e), user_id=current_user.id, session_id=session_id)
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
async def ask_question_legacy(req: QASessionCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await create_session(req, current_user=current_user, db=db)


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
    ).outerjoin(User, QASession.user_id == User.id).outerjoin(
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
