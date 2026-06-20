import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import get_llm_config
from core.database import db_session, get_db
from core.security import get_current_user
from infrastructure.llm.client import CallContext
from infrastructure.rag.retriever import format_context, retrieve
from middleware.rate_limits import check_qa_limit
from models import QARecord, QASession, User
from schemas import (
    QAAskRequest,
    QAAskResponse,
    QASessionCreate,
)

from ._citations import embed_citations
from .logic import build_qa_history, get_cached_answer

log = logging.getLogger(__name__)


async def _inject_rag(
    llm_messages: list[dict], question: str, rag_enabled: bool = False, *, llm_client=None
) -> list[dict[str, str]]:
    """If RAG enabled, retrieve relevant knowledge and inject as system context.

    When llm_client is provided, uses it to extract targeted search keywords
    before retrieval for higher precision. Never raises — RAG failure silently degrades.
    """
    if not rag_enabled:
        return []
    try:
        search_query = question
        if llm_client is not None:
            try:
                search_query = await _extract_search_terms(llm_client, question)
            except Exception:
                pass  # fall back to raw question
        results = await retrieve(search_query)
        context, citations = format_context(results)
        if context and citations:
            llm_messages.insert(1, {"role": "system", "content": context})
        return citations
    except Exception:
        log.warning("RAG retrieval failed, continuing without knowledge context", exc_info=True)
        return []


async def _extract_search_terms(llm_client, question: str) -> str:
    """Use a lightweight LLM call to extract precise search keywords from the question."""
    prompt = [
        {
            "role": "system",
            "content": "你是一个护理学教材检索助手。从用户问题中提取3-5个最关键的医学术语，用逗号分隔。只返回关键词，不要其他内容。",
        },
        {"role": "user", "content": f"问题：{question}\n关键词："},
    ]
    try:
        keywords = await llm_client.call(
            prompt,
            purpose="rag-kw",
            ctx=CallContext(purpose="rag-kw", log_meta={"step": "keyword_extraction"}),
            max_tokens=80,
            temperature=0.0,
        )
        terms = keywords.strip().rstrip("。，,.")
        if len(terms) > 2:
            return terms
    except Exception:
        pass
    return question


router = APIRouter()


def _qa_user_context(user: User) -> dict[str, str]:
    return {
        "user_name": user.display_name or "学生",
        "user_role": user.role.name if user.role else "学生",
    }


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

    cached = None if req.rag_enabled else get_cached_answer(req.question, db)
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

    citations = []
    llm_client = request.app.state.llm_client
    try:
        pm = request.app.state.prompt_manager
        tmpl = await pm.get("qa")
        llm_messages = [
            {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))},
            {"role": "user", "content": req.question},
        ]
        citations = await _inject_rag(llm_messages, req.question, req.rag_enabled, llm_client=llm_client)
    except Exception as e:
        log.exception("qa prompt 初始化失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"Prompt 加载失败: {e!s}")

    rid = getattr(request.state, "request_id", None)
    try:
        answer = await llm_client.call(
            llm_messages,
            purpose="qa",
            ctx=CallContext(
                purpose="qa",
                user_id=current_user.id,
                log_meta={"request_id": rid} if rid else None,
            ),
            **get_llm_config("qa"),
        )
    except Exception as e:
        log.exception("qa LLM调用失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e!s}")

    stored_content = embed_citations(answer, citations)
    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=stored_content,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    log.info(
        f"新会话创建: session_id={session.id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(session_id=session.id, answer=answer, citations=citations or None)


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

    llm_messages = build_qa_history(session_id, db)

    pm = request.app.state.prompt_manager
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))})
    llm_messages.append({"role": "user", "content": req.question.strip()})
    citations = await _inject_rag(
        llm_messages, req.question.strip(), req.rag_enabled, llm_client=request.app.state.llm_client
    )

    user_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="user",
        content=req.question.strip(),
    )
    db.add(user_msg)
    db.commit()

    rid = getattr(request.state, "request_id", None)
    llm_client = request.app.state.llm_client
    try:
        answer = await llm_client.call(
            llm_messages,
            purpose="qa",
            ctx=CallContext(
                purpose="qa",
                user_id=current_user.id,
                log_meta={"request_id": rid, "session_id": session_id} if rid else {"session_id": session_id},
            ),
            **get_llm_config("qa"),
        )
    except Exception as e:
        log.exception(
            "qa 追问LLM调用失败", extra={"error": str(e), "user_id": current_user.id, "session_id": session_id}
        )
        raise HTTPException(status_code=500, detail=f"AI调用失败: {e!s}")

    stored_content = embed_citations(answer, citations)
    assistant_msg = QARecord(
        session_id=session.id,
        user_id=current_user.id,
        role="assistant",
        content=stored_content,
    )
    db.add(assistant_msg)
    session.updated_at = func.now()
    db.commit()

    log.info(
        f"会话追问: session_id={session_id} q_len={len(req.question)}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return QAAskResponse(session_id=session.id, answer=answer, citations=citations or None)


@router.post("/sessions/{session_id}/ask/stream")
async def ask_stream(
    session_id: int,
    req: QAAskRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
):
    async with db_session() as db:
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

        pm = request.app.state.prompt_manager
        tmpl = await pm.get("qa")
        llm_messages = build_qa_history(session_id, db)
        llm_messages.insert(0, {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))})
        llm_messages.append({"role": "user", "content": req.question})
        citations = await _inject_rag(
            llm_messages, req.question, req.rag_enabled, llm_client=request.app.state.llm_client
        )

        user_record = QARecord(session_id=session_id, user_id=current_user.id, role="user", content=req.question)
        db.add(user_record)
        db.commit()
        db.refresh(user_record)

        async def generate():
            import json as _json

            full_reply = ""
            llm_client = request.app.state.llm_client
            try:
                async for chunk in llm_client.stream(
                    llm_messages,
                    purpose="qa",
                    ctx=CallContext(
                        purpose="qa",
                        user_id=current_user.id,
                    ),
                    **get_llm_config("qa"),
                ):
                    full_reply += chunk
                    yield f"data: {_json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

                stored_content = embed_citations(full_reply, citations)
                assistant_record = QARecord(
                    session_id=session_id, user_id=current_user.id, role="assistant", content=stored_content
                )
                db.add(assistant_record)
                db.commit()
                db.refresh(assistant_record)

                yield f"data: {_json.dumps({'done': True, 'id': assistant_record.id, 'citations': citations or None}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception("QA stream error: session_id=%d", session_id)
                yield f"data: {_json.dumps({'error': str(e)[:200]}, ensure_ascii=False)}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/section-text")
def get_section_text(source: str, section: str):
    """Return the full textbook section text for a citation (no LLM)."""
    from core.database import SessionLocal
    from models import KnowledgeChunk

    db = SessionLocal()
    try:
        source_key = f"textbook:{source}" if not source.startswith("textbook:") else source
        chunks = (
            db.query(KnowledgeChunk)
            .filter(
                KnowledgeChunk.source == source_key,
                KnowledgeChunk.section.like(f"{section}%"),
            )
            .order_by(KnowledgeChunk.section)
            .all()
        )
        if not chunks:
            raise HTTPException(status_code=404, detail="教材章节不存在")
        parts = []
        for c in chunks:
            parts.append(c.chunk_text)
        return {"source": source, "section": section, "text": "\n\n".join(parts)}
    finally:
        db.close()


@router.post("/ask", response_model=QAAskResponse)
async def ask_question_legacy(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return await create_session(req, request=request, current_user=current_user, db=db)
