from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from models import User, QARecord
from schemas import QARequest, QAResponse, QARecordOut, QARecordAdminOut, PaginatedResponse
from auth import get_current_user, require_teacher
from services.llm_service import call_llm
from rate_limiter import check_qa_limit
from services.prompt_manager import get_prompt_manager
from pagination import paginate
from logger import log_info

router = APIRouter(prefix="/api/qa", tags=["通用问答"])


@router.post("/ask", response_model=QAResponse)
async def ask_question(req: QARequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    check_qa_limit(current_user.id)

    pm = await get_prompt_manager()
    tmpl = await pm.get("qa")
    messages = [
        {"role": "system", "content": tmpl.render()},
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

    log_info(f"问答已记录: qa_record_id={record.id} q_len={len(req.question)}",
             user_id=current_user.id, user_role=current_user.role)
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
