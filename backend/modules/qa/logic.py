"""QA 问答系统 —— 缓存 + 历史构建

QA Cache: 同一用户、完全相同的问句命中历史答复时复用，避免重复 LLM 调用。
**复用时必须连同引用一起返回**——引用可追溯是产品承诺，丢掉引用会让界面
失去来源卡片（早期实现只回传剥离引用后的纯文本，是缺陷）。
build_qa_history: 从 DB 构建对话历史 messages（剔除 citations 标记）
"""

import logging

from sqlalchemy.orm import Session

from models import QARecord

from .citations import clean_content, extract_citations

log = logging.getLogger(__name__)


def get_cached_answer(question: str, user_id: int, db: Session) -> tuple[str, list[dict[str, str]] | None] | None:
    """同一用户问过的完全相同的问句 → 返回 (clean_content, citations)。

    按用户隔离、跨会话共享：命中即省一次 LLM 调用。引用必须一并返回，调用方
    在落库时用 ``embed_citations`` 重新写回，保证复用的答复同样可追溯。
    """
    normalized = question.strip()
    user_record = (
        db.query(QARecord)
        .filter(QARecord.role == "user", QARecord.content == normalized, QARecord.user_id == user_id)
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
        return extract_citations(row.content)
    return None


MAX_HISTORY_TOKENS = 2000

from infra.llm.token_counter import estimate_tokens


def build_qa_history(session_id: int, db: Session) -> list[dict]:
    """从 DB 查询 QA 会话历史，构建 role-mapped messages 列表（token 感知截断）"""
    records = db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.desc()).all()
    total_tokens = 0
    kept = []
    for r in records:
        tokens = estimate_tokens(clean_content(r.content))
        if total_tokens + tokens > MAX_HISTORY_TOKENS:
            break
        total_tokens += tokens
        kept.append(r)
    kept.reverse()
    return [{"role": "user" if r.role == "user" else "assistant", "content": clean_content(r.content)} for r in kept]
