"""QA 问答系统 —— 缓存 + 历史构建

QA Cache: 查询 qa_records 表去重，避免重复 LLM 调用
build_qa_history: 从 DB 构建对话历史 messages
"""

import logging

from sqlalchemy.orm import Session

from models import QARecord

log = logging.getLogger(__name__)


def get_cached_answer(question: str, db: Session) -> str | None:
    """检查同一问题是否已有回答（不限会话，跨会话缓存）。"""
    normalized = question.strip()
    user_record = (
        db.query(QARecord)
        .filter(QARecord.role == "user", QARecord.content == normalized)
        .order_by(QARecord.created_at.desc())
        .first()
    )
    if not user_record:
        return None
    row = (
        db.query(QARecord)
        .filter(
            QARecord.session_id == user_record.session_id,
            QARecord.role == "assistant",
            QARecord.id > user_record.id,
        )
        .order_by(QARecord.id.asc())
        .first()
    )
    if row:
        return row.content
    return None


MAX_HISTORY_TOKENS = 2000

from infrastructure.llm.token_counter import estimate_tokens


def build_qa_history(session_id: int, db: Session) -> list[dict]:
    """从 DB 查询 QA 会话历史，构建 role-mapped messages 列表（token 感知截断）"""
    records = db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.desc()).all()
    total_tokens = 0
    kept = []
    for r in records:
        tokens = estimate_tokens(r.content)
        if total_tokens + tokens > MAX_HISTORY_TOKENS:
            break
        total_tokens += tokens
        kept.append(r)
    kept.reverse()
    return [{"role": "user" if r.role == "user" else "assistant", "content": r.content} for r in kept]
