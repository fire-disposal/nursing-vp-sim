import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from middleware.rate_limits import check_qa_limit
from models import QARecord, QASession, User
from schemas import (
    MessageResponse,
    PaginatedResponse,
    QAAskRequest,
    QAAskResponse,
    QAMessageItem,
    QASessionAdminItem,
    QASessionCreate,
    QASessionItem,
)
# TODO(v2): use Depends(get_llm_client) — see core/dependencies.py
from services.pagination import paginate
from services.qa import get_qa_cache, build_qa_history

log = logging.getLogger(__name__)

from core.config import get_llm_config

router = APIRouter(prefix="/api/qa", tags=["通用问答"])


@router.post("/sessions", response_model=QAAskResponse)
async def create_session(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    await check_qa_limit(current_user.id, request)

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

    qa_cache = get_qa_cache()
    cached = await qa_cache.get(req.question)
    if cached is not None:
        assistant_msg = QARecord(
            session_id=session.id,
            user_id=current_user.id,
            role="assistant",
            content=cached,
        )
        db.add(assistant_msg)
        session.updated_at = func.now()
        db.commit()
        log.info(
            f"QA缓存命中: session_id={session.id}",
            extra={"user_id": current_user.id},
        )
        return QAAskResponse(session_id=session.id, answer=cached)

    try:
        pm = request.app.state.prompt_manager
        tmpl = await pm.get("qa")
        llm_messages = [
            {"role": "system", "content": tmpl.render()},
            {"role": "user", "content": req.question},
        ]
    except Exception as e:
        log.exception("qa prompt 初始化失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"Prompt 加载失败: {e!s}")

    rid = getattr(request.state, "request_id", None)
    try:
        answer = await call_llm(
            llm_messages,
            purpose="qa",
            user_id=current_user.id,
            log_meta={"request_id": rid} if rid else None,
            client=request.app.state.httpx_client,
            router=request.app.state.llm_router,
            log_worker=request.app.state.log_worker,
            **get_llm_config("qa"),
        )
    except Exception as e:
        log.exception("qa LLM调用失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e!s}")

    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=answer,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    await qa_cache.set(req.question, answer)

    log.info(
        f"新会话创建: session_id={session.id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(session_id=session.id, answer=answer)


@router.post("/sessions/{session_id}/ask", response_model=QAAskResponse)
async def ask_in_session(
    session_id: int,
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    session = (
        db.query(QASession)
        .filter(
            QASession.id == session_id,
            QASession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    await check_qa_limit(current_user.id, request)

    user_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=req.question.strip(),
    )
    db.add(user_msg)
    db.commit()

    llm_messages = build_qa_history(session_id, db)

    pm = request.app.state.prompt_manager
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render()})

    rid = getattr(request.state, "request_id", None)
    try:
        answer = await call_llm(
            llm_messages,
            purpose="qa",
            user_id=current_user.id,
            log_meta={"request_id": rid, "session_id": session_id} if rid else {"session_id": session_id},
            client=request.app.state.httpx_client,
            router=request.app.state.llm_router,
            log_worker=request.app.state.log_worker,
            **get_llm_config("qa"),
        )
    except Exception as e:
        log.exception(
            "qa 追问LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "session_id": session_id}
        )
        raise HTTPException(status_code=500, detail=f"AI调用失败: {e!s}")

    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=answer,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    log.info(
        f"会话追问: session_id={session_id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(session_id=session.id, answer=answer)


@router.post("/sessions/{session_id}/ask/stream")
async def ask_stream(
    session_id: int,
    req: QAAskRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        session = db.query(QASession).filter(QASession.id == session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        if session.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="只能操作自己的对话")

        user_record = QARecord(session_id=session_id, role="user", content=req.question)
        db.add(user_record)
        db.commit()
        db.refresh(user_record)

        pm = request.app.state.prompt_manager
        tmpl = await pm.get("qa")
        llm_messages = build_qa_history(session_id, db)
        llm_messages.insert(0, {"role": "system", "content": tmpl.render()})
        llm_messages.append({"role": "user", "content": req.question})

        async def generate():
            import json as _json
            full_reply = ""
            try:
                async for chunk in call_llm_stream(
                    llm_messages,
                    purpose="qa",
                    user_id=current_user.id,
                    client=request.app.state.httpx_client,
                    router=request.app.state.llm_router,
                    log_worker=request.app.state.log_worker,
                    **get_llm_config("qa"),
                ):
                    full_reply += chunk
                    yield f"data: {_json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

                assistant_record = QARecord(session_id=session_id, role="assistant", content=full_reply)
                db.add(assistant_record)
                db.commit()
                db.refresh(assistant_record)

                yield f"data: {_json.dumps({'done': True, 'id': assistant_record.id}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception("QA stream error: session_id=%d", session_id)
                yield f"data: {_json.dumps({'error': str(e)[:200]}, ensure_ascii=False)}\n\n"
            finally:
                db.close()

        return StreamingResponse(generate(), media_type="text/event-stream")
    except HTTPException:
        db.close()
        raise
    except BaseException:
        db.close()
        raise


@router.get("/sessions", response_model=list[QASessionItem])
def list_sessions(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(QASession).filter(QASession.user_id == current_user.id).order_by(QASession.updated_at.desc()).all()


@router.delete("/sessions/{session_id}", response_model=MessageResponse)
def delete_session(
    session_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    session = (
        db.query(QASession)
        .filter(
            QASession.id == session_id,
            QASession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    db.query(QARecord).filter(QARecord.session_id == session_id).delete()
    db.delete(session)
    db.commit()

    log.info(f"会话删除: session_id={session_id}", extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""})
    return {"message": "删除成功"}


@router.get("/sessions/{session_id}/messages", response_model=list[QAMessageItem])
def get_session_messages(
    session_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    session = (
        db.query(QASession)
        .filter(
            QASession.id == session_id,
            QASession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    return db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.asc()).all()


# ── 兼容旧端点 ──


@router.post("/ask", response_model=QAAskResponse)
async def ask_question_legacy(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return await create_session(req, request=request, current_user=current_user, db=db)


@router.get("/history/all", response_model=PaginatedResponse[QASessionAdminItem])
def get_all_qa_history(
    current_user: Annotated[User, Depends(require_permission("stats_view"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    base = (
        db.query(
            QASession.id,
            QASession.user_id,
            QASession.title,
            QASession.created_at,
            QASession.updated_at,
            User.display_name.label("student_name"),
            User.student_id.label("student_code"),
            func.count(QARecord.id).label("message_count"),
        )
        .outerjoin(User, QASession.user_id == User.id)
        .outerjoin(QARecord, QARecord.session_id == QASession.id)
    )
    if effective_school is not None:
        base = base.filter(User.school_id == effective_school)
    base = base.group_by(QASession.id, User.display_name, User.student_id).order_by(QASession.updated_at.desc())

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
    current_user: Annotated[User, Depends(require_permission("stats_view"))],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.asc()).all()
