import asyncio
import json
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

# ── Tool definitions exposed to the QA LLM ──

QA_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_textbooks",
            "description": "列出所有可用的护理学教材（仅书名和章节数）",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_chapters",
            "description": "列出指定教材的所有章节标题（不含正文内容）",
            "parameters": {
                "type": "object",
                "properties": {
                    "textbook": {
                        "type": "string",
                        "description": "教材名称，如'内科护理学'、'外科护理学'、'新编护理学基础'",
                    }
                },
                "required": ["textbook"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": "在护理学教材中全文关键词搜索，返回匹配的章节片段（≤500字）及其位置信息。可用于快速定位相关知识点。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词或短语，如'肺炎护理措施'、'术后并发症'"},
                    "textbook": {
                        "type": "string",
                        "description": "限定在指定教材中搜索（可选，不填则搜索全部教材）",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_section",
            "description": "读取指定教材某章节下某小节的完整正文内容。先用 search() 定位到具体小节后，再用此工具读取完整内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "textbook": {"type": "string", "description": "教材名称"},
                    "chapter": {"type": "string", "description": "章节标题"},
                    "heading": {"type": "string", "description": "小节标题（## 标题）"},
                },
                "required": ["textbook", "chapter", "heading"],
            },
        },
    },
]


def _build_tool_handlers() -> dict:
    """Build synchronous tool handlers backed by chapter_index."""
    from infrastructure.rag.chapter_index import list_chapters, list_textbooks, read_section, search

    handlers = {
        "list_textbooks": lambda _: json.dumps(list_textbooks(), ensure_ascii=False),
        "list_chapters": lambda args: json.dumps(list_chapters(args.get("textbook", "")), ensure_ascii=False),
        "search": lambda args: json.dumps(
            search(
                query=args.get("query", ""),
                textbook=args.get("textbook") or None,
            ),
            ensure_ascii=False,
        ),
        "read_section": lambda args: read_section(
            textbook=args.get("textbook", ""),
            chapter=args.get("chapter", ""),
            heading=args.get("heading", ""),
        ),
    }
    # Wrap sync handlers as async for the client
    async_handlers = {}
    for name, fn in handlers.items():
        async_handlers[name] = lambda args, _fn=fn: asyncio.to_thread(_fn, args)
    return async_handlers


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
    except Exception as e:
        log.exception("qa prompt 初始化失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"Prompt 加载失败: {e!s}")

    rid = getattr(request.state, "request_id", None)
    try:
        if req.rag_enabled:
            answer = await llm_client.call_with_tools(
                llm_messages,
                tools=QA_TOOLS,
                tool_handlers=_build_tool_handlers(),
                purpose="qa",
                ctx=CallContext(
                    purpose="qa",
                    user_id=current_user.id,
                    log_meta={"request_id": rid} if rid else None,
                ),
                **{
                    k: v
                    for k, v in get_llm_config("qa").items()
                    if k in ("timeout", "max_tokens", "temperature", "max_retries")
                },
            )
        else:
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

    llm_messages = build_qa_history(session_id, db)

    pm = request.app.state.prompt_manager
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))})
    llm_messages.append({"role": "user", "content": req.question.strip()})

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
        if req.rag_enabled:
            answer = await llm_client.call_with_tools(
                llm_messages,
                tools=QA_TOOLS,
                tool_handlers=_build_tool_handlers(),
                purpose="qa",
                ctx=CallContext(
                    purpose="qa",
                    user_id=current_user.id,
                    log_meta={"request_id": rid, "session_id": session_id} if rid else {"session_id": session_id},
                ),
                **{
                    k: v
                    for k, v in get_llm_config("qa").items()
                    if k in ("timeout", "max_tokens", "temperature", "max_retries")
                },
            )
        else:
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

    stored_content = embed_citations(answer, [])
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
    return QAAskResponse(session_id=session.id, answer=answer)


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

                stored_content = embed_citations(full_reply, [])
                assistant_record = QARecord(
                    session_id=session_id, user_id=current_user.id, role="assistant", content=stored_content
                )
                db.add(assistant_record)
                db.commit()
                db.refresh(assistant_record)

                yield f"data: {_json.dumps({'done': True, 'id': assistant_record.id, 'citations': None}, ensure_ascii=False)}\n\n"
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
