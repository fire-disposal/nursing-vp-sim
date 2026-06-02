"""QA 问答服务"""

from sqlalchemy.orm import Session


def build_qa_history(session_id: int, db: Session) -> list[dict]:
    """从 DB 查询 QA 会话历史，构建 role-mapped messages 列表（最多 8 轮）"""
    from models import QARecord
    history = db.query(QARecord).filter(
        QARecord.session_id == session_id
    ).order_by(QARecord.created_at.desc()).limit(16).all()
    history.reverse()
    return [
        {"role": "user" if r.role == "user" else "assistant", "content": r.content}
        for r in history
    ]
