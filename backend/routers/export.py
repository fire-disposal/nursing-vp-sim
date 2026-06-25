import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from core.database import get_db
from core.security import get_current_user, require_permission, tenant_scope
from infrastructure.export import Column, stream_response
from models import Message, TrainingRecord, User

router = APIRouter(prefix="/api/export", tags=["导出"])


@router.get("/records")
def export_records(
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    """导出所有训练记录为CSV（流式写入，避免全量加载内存）"""
    effective_school = tenant_scope(current_user, school_id)

    query = db.query(TrainingRecord).options(
        selectinload(TrainingRecord.user),
        selectinload(TrainingRecord.case),
        selectinload(TrainingRecord.score),
    )
    if effective_school is not None:
        query = query.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)
    records = query.order_by(TrainingRecord.start_time.desc()).yield_per(100).all()

    record_ids = [r.id for r in records]
    msg_counts = {}
    if record_ids:
        msg_counts = {
            rid: count
            for rid, count in db.query(Message.record_id, func.count(Message.id))
            .filter(Message.record_id.in_(record_ids))
            .group_by(Message.record_id)
            .all()
        }

    columns = [
        Column("记录ID", lambda r: str(r.id)),
        Column("学生姓名", lambda r: r.user.display_name if r.user else ""),
        Column("学号", lambda r: r.user.student_id if r.user else ""),
        Column("病例名称", lambda r: r.case.name if r.case else ""),
        Column("状态", lambda r: r.status),
        Column("开始时间", lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        Column("结束时间", lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        Column("总分", lambda r: str(r.score.total_score) if r.score and r.score.total_score is not None else ""),
        Column("优点", lambda r: "；".join(r.score.strengths) if r.score and r.score.strengths else ""),
        Column("不足", lambda r: "；".join(r.score.weaknesses) if r.score and r.score.weaknesses else ""),
        Column("漏问内容", lambda r: "；".join(r.score.missed_content) if r.score and r.score.missed_content else ""),
        Column("改进建议", lambda r: r.score.suggestions if r.score else ""),
        Column("对话轮数", lambda r: str(msg_counts.get(r.id, 0))),
    ]
    return stream_response(records, columns, "training_records.csv")


@router.get("/record/{record_id}")
def export_record_detail(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    """导出单条训练记录详情（含完整对话）为文本"""
    record = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.user),
            joinedload(TrainingRecord.case),
            joinedload(TrainingRecord.score),
            joinedload(TrainingRecord.messages),
        )
        .filter(TrainingRecord.id == record_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if not current_user.has_permission("export_data") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权导出此记录")

    lines = []
    user = record.user
    case = record.case
    score = record.score
    messages = record.messages

    lines.append("=" * 60)
    lines.append(f"训练记录 #{record.id}")
    lines.append(f"学生：{user.display_name if user else ''} (学号：{user.student_id if user else ''})")
    lines.append(f"病例：{case.name if case else ''}")
    lines.append(f"时间：{record.start_time} ~ {record.end_time}")
    lines.append("=" * 60)
    lines.append("")
    lines.append("【对话记录】")
    lines.append("-" * 40)
    for msg in messages:
        role_label = "学生" if msg.role == "student" else "患者"
        lines.append(f"[{msg.created_at.strftime('%H:%M:%S')}] {role_label}：{msg.content}")
        lines.append("")

    if score:
        lines.append("【评分结果】")
        lines.append("-" * 40)
        lines.append(f"总分：{score.total_score}")
        lines.append(f"分项得分：{score.detail_scores}")
        lines.append(f"优点：{score.strengths}")
        lines.append(f"不足：{score.weaknesses}")
        lines.append(f"漏问内容：{score.missed_content}")
        lines.append(f"改进建议：{score.suggestions}")

    output = io.StringIO()
    output.write("\n".join(lines))
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=record_{record_id}.txt"},
    )
