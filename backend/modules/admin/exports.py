import io

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from core.deps import CurrentUser, DbSession
from infra.exporter import ColumnDef, export_response
from services.record import RecordService

router = APIRouter(prefix="/api/export", tags=["导出"])


@router.post("/records")
def export_records(
    current_user: CurrentUser,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    records, msg_counts = RecordService(db).get_records_for_export(current_user)

    columns = [
        ColumnDef("记录ID", key="id", fmt=str),
        ColumnDef("学生姓名", value=lambda r: r.user.display_name if r.user else ""),
        ColumnDef("学号", value=lambda r: r.user.student_id if r.user else ""),
        ColumnDef("病例名称", value=lambda r: r.case.name if r.case else ""),
        ColumnDef("状态", key="status"),
        ColumnDef("开始时间", value=lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        ColumnDef("结束时间", value=lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        ColumnDef(
            "总分", value=lambda r: str(r.score.total_score) if r.score and r.score.total_score is not None else ""
        ),
        ColumnDef("优点", value=lambda r: "；".join(r.score.strengths) if r.score and r.score.strengths else ""),
        ColumnDef("不足", value=lambda r: "；".join(r.score.weaknesses) if r.score and r.score.weaknesses else ""),
        ColumnDef(
            "漏问内容", value=lambda r: "；".join(r.score.missed_content) if r.score and r.score.missed_content else ""
        ),
        ColumnDef("改进建议", value=lambda r: r.score.suggestions if r.score else ""),
        ColumnDef("对话轮数", value=lambda r: str(msg_counts.get(r.id, 0))),
    ]
    return export_response(records, columns, "training_records", "训练记录", format)


@router.post("/record/{record_id}")
def export_record_detail(
    record_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    record = RecordService(db).get_record_detail(record_id, current_user)
    user = record.user
    case = record.case
    score = record.score
    messages = record.messages

    lines = [
        "=" * 60,
        f"训练记录 #{record.id}",
        f"学生：{user.display_name if user else ''} (学号：{user.student_id if user else ''})",
        f"病例：{case.name if case else ''}",
        f"时间：{record.start_time} ~ {record.end_time}",
        "=" * 60,
        "",
        "【对话记录】",
        "-" * 40,
    ]
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
