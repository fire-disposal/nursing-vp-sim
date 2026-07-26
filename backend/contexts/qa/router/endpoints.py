"""QA HTTP endpoints — session creation, Q&A, streaming, section text."""

import json as _json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from prompts.qa import QA_SYSTEM
from core.database import db_session, get_db
from core.rate_limits import check_qa_limit
from core.security import require_permission
from infrastructure.llm.client import CallContext
from infrastructure.llm.profile import get_llm_config
from prompts import render_template
from models import QARecord, QASession, User
from schemas import Citation, QAAskResponse, QASessionCreate, SectionTextResponse

from ..citations import embed_citations
from ..logic import build_qa_history, get_cached_answer
from .tools import QA_TOOLS, build_tool_handlers, inject_search_context, pre_search

log = logging.getLogger(__name__)

router = APIRouter()


def _qa_user_context(user: User) -> dict[str, str]:
    return {
        "user_name": user.display_name or "学生",
        "user_role": user.role.name if user.role else "学生",
    }


async def _call_qa_llm(llm_client, llm_messages: list, rag_enabled: bool, current_user: User, log_meta: dict) -> str:
    rid = log_meta.get("request_id")
    ctx = CallContext(purpose="qa", user_id=current_user.id, log_meta=log_meta if rid else None)
    try:
        if rag_enabled:
            return await llm_client.call_with_tools(
                llm_messages,
                tools=QA_TOOLS,
                tool_handlers=build_tool_handlers(),
                purpose="qa",
                ctx=ctx,
                **{
                    k: v
                    for k, v in get_llm_config("qa").items()
                    if k in ("timeout", "max_tokens", "temperature", "max_retries")
                },
            )
        return await llm_client.call(llm_messages, purpose="qa", ctx=ctx, **get_llm_config("qa"))
    except Exception as e:
        log.exception("qa LLM调用失败", extra={"error": str(e), "user_id": current_user.id, **log_meta})
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e!s}")


def _save_qa_assistant(session, user_id: int, answer: str, citations: list, db: Session) -> str:
    stored = embed_citations(answer, citations)
    db.add(QARecord(session_id=session.id, user_id=user_id, role="assistant", content=stored))
    session.updated_at = func.now()
    return stored


@router.post("/sessions", response_model=QAAskResponse)
async def create_session(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    await check_qa_limit(current_user.id, request)
    session = QASession(user_id=current_user.id, title=req.question.strip()[:40])
    db.add(session)
    db.commit()
    db.refresh(session)
    user_msg = QARecord(session_id=session.id, user_id=current_user.id, role="user", content=req.question.strip())
    db.add(user_msg)
    db.commit()
    cached = None if req.rag_enabled else get_cached_answer(req.question, current_user.id, db)
    if cached is not None:
        assistant_msg = QARecord(session_id=session.id, user_id=current_user.id, role="assistant", content=cached)
        db.add(assistant_msg)
        session.updated_at = func.now()
        db.commit()
        log.info(f"QA缓存命中: session_id={session.id}", extra={"user_id": current_user.id})
        return QAAskResponse(session_id=session.id, answer=cached)
    citations: list[dict[str, str]] = []
    try:
        qa_system = render_template(QA_SYSTEM, **_qa_user_context(current_user))
        llm_messages = [
            {"role": "system", "content": qa_system},
            {"role": "user", "content": req.question},
        ]
        if req.rag_enabled:
            citations = pre_search(req.question)
            inject_search_context(llm_messages, citations)
    except Exception as e:
        log.exception("qa prompt 初始化失败", extra={"error": str(e), "user_id": current_user.id})
        db.delete(user_msg)
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Prompt 加载失败: {e!s}")
    rid = getattr(request.state, "request_id", None)
    try:
        answer = await _call_qa_llm(
            request.app.state.llm_client,
            llm_messages,
            req.rag_enabled,
            current_user,
            {"request_id": rid} if rid else {},
        )
    except HTTPException:
        db.delete(user_msg)
        db.delete(session)
        db.commit()
        raise
    _save_qa_assistant(session, current_user.id, answer, citations, db)
    db.commit()
    log.info(
        f"新会话创建: session_id={session.id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(
        session_id=session.id,
        answer=answer,
        citations=[Citation(source=c["source"], section=c["section"]) for c in citations] or None,
    )


@router.post("/sessions/{session_id}/ask", response_model=QAAskResponse)
async def ask_in_session(
    session_id: int,
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")
    session = db.query(QASession).filter(QASession.id == session_id, QASession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    await check_qa_limit(current_user.id, request)
    llm_messages = build_qa_history(session_id, db)
    qa_system = render_template(QA_SYSTEM, **_qa_user_context(current_user))
    llm_messages.insert(0, {"role": "system", "content": qa_system})
    llm_messages.append({"role": "user", "content": req.question.strip()})
    citations: list[dict[str, str]] = []
    if req.rag_enabled:
        citations = pre_search(req.question.strip())
        inject_search_context(llm_messages, citations)
    user_msg = QARecord(session_id=session.id, user_id=current_user.id, role="user", content=req.question.strip())
    db.add(user_msg)
    db.commit()
    rid = getattr(request.state, "request_id", None)
    try:
        answer = await _call_qa_llm(
            request.app.state.llm_client,
            llm_messages,
            req.rag_enabled,
            current_user,
            {"request_id": rid, "session_id": session_id} if rid else {"session_id": session_id},
        )
    except HTTPException:
        db.delete(user_msg)
        db.commit()
        raise
    _save_qa_assistant(session, current_user.id, answer, citations, db)
    db.commit()
    log.info(
        f"会话追问: session_id={session_id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(
        session_id=session.id,
        answer=answer,
        citations=[Citation(source=c["source"], section=c["section"]) for c in citations] or None,
    )


@router.post("/sessions/{session_id}/ask/stream")
async def ask_stream(
    session_id: int,
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
):
    async with db_session() as db:
        session = db.query(QASession).filter(QASession.id == session_id, QASession.user_id == current_user.id).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        await check_qa_limit(current_user.id, request)
        qa_system = render_template(QA_SYSTEM, **_qa_user_context(current_user))
        llm_messages = build_qa_history(session_id, db)
        llm_messages.insert(0, {"role": "system", "content": qa_system})
        llm_messages.append({"role": "user", "content": req.question})
        citations: list[dict[str, str]] = []
        if req.rag_enabled:
            citations = pre_search(req.question)
            inject_search_context(llm_messages, citations, snippets_only=True)
        user_record = QARecord(session_id=session_id, user_id=current_user.id, role="user", content=req.question)
        db.add(user_record)
        db.commit()
        db.refresh(user_record)

        async def generate():
            full_reply = ""
            llm_client = request.app.state.llm_client
            try:
                async for chunk in llm_client.stream(
                    llm_messages,
                    purpose="qa",
                    ctx=CallContext(purpose="qa", user_id=current_user.id),
                    **get_llm_config("qa"),
                ):
                    full_reply += chunk
                    yield f"data: {_json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
                stored_content = embed_citations(full_reply, citations)
                assistant_record = QARecord(
                    session_id=session_id, user_id=current_user.id, role="assistant", content=stored_content
                )
                from core.database import SessionLocal

                _db = SessionLocal()
                try:
                    _db.add(assistant_record)
                    _db_session = _db.query(QASession).filter(QASession.id == session_id).first()
                    if _db_session:
                        _db_session.updated_at = func.now()
                    _db.commit()
                    _db.refresh(assistant_record)
                    record_id = assistant_record.id
                finally:
                    _db.close()
                yield f"data: {_json.dumps({'done': True, 'id': record_id, 'citations': citations or None}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception("QA stream error: session_id=%d", session_id)
                yield f"data: {_json.dumps({'error': str(e)[:200]}, ensure_ascii=False)}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/section-text", response_model=SectionTextResponse)
def get_section_text(source: str, section: str):
    """Return the full textbook section text for a citation (no LLM)."""
    from core.database import SessionLocal
    from models import KnowledgeChunk

    db = SessionLocal()
    try:
        source_key = f"textbook:{source}" if not source.startswith("textbook:") else source
        chunks = (
            db.query(KnowledgeChunk)
            .filter(KnowledgeChunk.source == source_key, KnowledgeChunk.section.like(f"{section}%"))
            .order_by(KnowledgeChunk.section)
            .all()
        )
        if not chunks:
            raise HTTPException(status_code=404, detail="教材章节不存在")
        parts = [c.chunk_text for c in chunks]
        return {"source": source, "section": section, "text": "\n\n".join(parts)}
    finally:
        db.close()


@router.post("/ask", response_model=QAAskResponse)
async def ask_question_legacy(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    return await create_session(req, request=request, current_user=current_user, db=db)
