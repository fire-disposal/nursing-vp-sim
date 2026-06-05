import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import Case, Message, Score, TrainingRecord, User

router = APIRouter(prefix="/api/export", tags=["导出"])


@router.get("/records")
def export_records(
    current_user: Annotated[User, Depends(require_permission("export_data"))],
    db: Annotated[Session, Depends(get_db)],
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    """导出所有训练记录为CSV（流式写入，避免全量加载内存）"""
    effective_school = resolve_school_filter(current_user, school_id)

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        # BOM + 表头
        buf.write("﻿")
        writer.writerow(
            [
                "记录ID",
                "学生姓名",
                "学号",
                "病例名称",
                "状态",
                "开始时间",
                "结束时间",
                "总分",
                "优点",
                "不足",
                "漏问内容",
                "改进建议",
                "对话轮数",
            ]
        )
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        query = (
            db.query(TrainingRecord)
            .options(
                selectinload(TrainingRecord.user),
                selectinload(TrainingRecord.case),
                selectinload(TrainingRecord.score),
                selectinload(TrainingRecord.messages),
            )
        )
        if effective_school is not None:
            query = query.join(User, TrainingRecord.user_id == User.id).filter(User.school_id == effective_school)
        records = query.order_by(TrainingRecord.start_time.desc()).yield_per(100)

        for r in records:
            writer.writerow(
                [
                    r.id,
                    r.user.display_name if r.user else "",
                    r.user.student_id if r.user else "",
                    r.case.name if r.case else "",
                    r.status,
                    r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else "",
                    r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else "",
                    r.score.total_score if r.score else "",
                    "；".join(r.score.strengths) if r.score and r.score.strengths else "",
                    "；".join(r.score.weaknesses) if r.score and r.score.weaknesses else "",
                    "；".join(r.score.missed_content) if r.score and r.score.missed_content else "",
                    r.score.suggestions if r.score else "",
                    len(r.messages) if r.messages else 0,
                ]
            )
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": "attachment; filename=training_records.csv"},
    )


@router.get("/record/{record_id}")
def export_record_detail(
    record_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]
):
    """导出单条训练记录详情（含完整对话）为文本"""
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if not current_user.has_permission("export_data") and record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权导出此记录")

    lines = []
    user = db.query(User).filter(User.id == record.user_id).first()
    case = db.query(Case).filter(Case.id == record.case_id).first()
    score = db.query(Score).filter(Score.record_id == record_id).first()
    messages = db.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

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
