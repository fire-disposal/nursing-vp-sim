import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import QA_RAG_ENABLED, get_llm_config
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

from .logic import build_qa_history, get_qa_cache

log = logging.getLogger(__name__)


async def _inject_rag(llm_messages: list[dict], question: str) -> None:
    """If RAG enabled, retrieve relevant knowledge and inject as system context."""
    if not QA_RAG_ENABLED:
        return
    context = format_context(await retrieve(question))
    if context:
        llm_messages.insert(1, {"role": "system", "content": context})


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
            {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))},
            {"role": "user", "content": req.question},
        ]
        await _inject_rag(llm_messages, req.question)
    except Exception as e:
        log.exception("qa prompt 初始化失败", extra={"error": str(e), "user_id": current_user.id})
        raise HTTPException(status_code=502, detail=f"Prompt 加载失败: {e!s}")

    rid = getattr(request.state, "request_id", None)
    llm_client = request.app.state.llm_client
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

    llm_messages = build_qa_history(session_id, db)

    pm = request.app.state.prompt_manager
    tmpl = await pm.get("qa")
    llm_messages.insert(0, {"role": "system", "content": tmpl.render(**_qa_user_context(current_user))})
    llm_messages.append({"role": "user", "content": req.question.strip()})
    await _inject_rag(llm_messages, req.question.strip())

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
        await _inject_rag(llm_messages, req.question)

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

                assistant_record = QARecord(
                    session_id=session_id, user_id=current_user.id, role="assistant", content=full_reply
                )
                db.add(assistant_record)
                db.commit()
                db.refresh(assistant_record)

                yield f"data: {_json.dumps({'done': True, 'id': assistant_record.id}, ensure_ascii=False)}\n\n"
            except Exception as e:
                log.exception("QA stream error: session_id=%d", session_id)
                yield f"data: {_json.dumps({'error': str(e)[:200]}, ensure_ascii=False)}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/ask", response_model=QAAskResponse)
async def ask_question_legacy(
    req: QASessionCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    return await create_session(req, request=request, current_user=current_user, db=db)
