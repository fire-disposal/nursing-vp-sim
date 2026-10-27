import io
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from core.config import MAX_EXPORT_ROWS
from core.deps import CurrentUser, DbSession
from core.exceptions import AuthError, NotFoundError
from core.security import require_permission
from core.tenant import Scope, TenantScope
from infra.exporter import ColumnDef, ExportAudit, export_response
from models import MEMBER_ROLE_STUDENT, Assignment, Class, ClassMembership, Message, TrainingRecord, User
from modules.training.manifest import experiment_label
from modules.training.scoring.grade_policy import SOURCE_LABELS, score_source

log = logging.getLogger(__name__)

# 全量导出（本仓最大的数据出口）用声明式权限，与其它端点同一写法：越权尝试会经
# ``require_permission`` 落 ``access_denied`` 审计，服务层不再重复判。
_Exporter = Annotated[User, Depends(require_permission("export_data"))]


class RecordService:
    """训练记录导出。院校隔离与列表同一口径，见 ``_tenant_conditions``。"""

    def __init__(self, db: Session, tenant: TenantScope):
        self.db = db
        self.tenant = tenant

    def _tenant_conditions(self) -> list:
        """训练记录的院校归属（与 ``/api/records`` 列表同口径）。

        两条路径并联：学生本人所属院校（``training_records.user_id → users.school_id``）
        与记录所挂作业的班级所属院校（``assignments.class_id → classes.school_id``）。
        只留前者会漏掉学生账号没有院校的历史记录（平台角色试跑），只留后者会漏掉
        自主训练（无作业），所以是 OR 而不是 AND。

        教师视角（``class_ids`` 非空）两条路径同时收窄到自己任教的班：导出不能比
        排名/统计多看一个班的数据。
        """
        if self.tenant.is_global:
            return []
        school_id = self.tenant.school_id
        students = self.db.query(User.id).filter(User.school_id == school_id)
        assignments = (
            self.db.query(Assignment.id)
            .join(Class, Class.id == Assignment.class_id)
            .filter(Class.school_id == school_id)
        )
        if self.tenant.class_ids is not None:
            class_ids = self.tenant.class_ids or {-1}
            students = students.filter(
                User.id.in_(
                    self.db.query(ClassMembership.user_id).filter(
                        ClassMembership.class_id.in_(class_ids),
                        ClassMembership.member_role == MEMBER_ROLE_STUDENT,
                    )
                )
            )
            assignments = assignments.filter(Assignment.class_id.in_(class_ids))
        return [
            or_(
                TrainingRecord.user_id.in_(students),
                TrainingRecord.assignment_id.in_(assignments),
            )
        ]

    def get_records_for_export(self) -> tuple[list[TrainingRecord], dict[int, int]]:
        query = self.db.query(TrainingRecord).options(
            selectinload(TrainingRecord.user),
            selectinload(TrainingRecord.case),
            selectinload(TrainingRecord.score),
        )
        query = query.filter(*self._tenant_conditions())
        # 多取一条以便 export_response 统一判超限（此前无上限：全量训练记录进内存）
        records = query.order_by(TrainingRecord.start_time.desc()).limit(MAX_EXPORT_ROWS + 1).all()

        record_ids = [r.id for r in records]
        msg_counts: dict[int, int] = {}
        if record_ids:
            msg_counts = {
                rid: count
                for rid, count in self.db.query(Message.record_id, func.count(Message.id))
                .filter(Message.record_id.in_(record_ids))
                .group_by(Message.record_id)
                .all()
            }
        return records, msg_counts

    def get_record_detail(self, record_id: int, current_user: User) -> TrainingRecord:
        record = (
            self.db.query(TrainingRecord)
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
            raise NotFoundError("记录不存在")
        # 先按院校作用域判可见性：本人的记录永远可见（owner 例外），别校记录一律 404，
        # 不暴露"存在但不在你的院校/班级里"。
        if record.user_id != current_user.id and not self._in_tenant(record.id):
            raise NotFoundError("记录不存在")
        # owner 例外（"导出自己的记录"）：``require_permission`` 只能表达"必须持有某权限"，
        # 表达不了"权限 **或** 本人"，故本端点保留服务层检查——与本仓其它 owner-or-permission
        # 端点（modules/feedback/router.py、modules/training/router/scoring.py）同一写法。
        if not current_user.has_permission("export_data") and record.user_id != current_user.id:
            raise AuthError("无权导出此记录", status_code=403)
        return record

    def _in_tenant(self, record_id: int) -> bool:
        """单条记录是否落在作用域内 —— 与列表共用一个判据（``_tenant_conditions``）。"""
        return (
            self.db.query(TrainingRecord.id).filter(TrainingRecord.id == record_id, *self._tenant_conditions()).first()
            is not None
        )


router = APIRouter(prefix="/api/export", tags=["导出"])


@router.post("/records")
def export_records(
    _current_user: _Exporter,
    db: DbSession,
    scope: Scope,
    request: Request,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    records, msg_counts = RecordService(db, scope).get_records_for_export()

    columns = [
        ColumnDef("记录ID", key="id", fmt=str),
        ColumnDef("学生姓名", value=lambda r: r.user.display_name if r.user else ""),
        ColumnDef("学号", value=lambda r: r.user.student_id if r.user else ""),
        ColumnDef("病例名称", value=lambda r: r.case.name if r.case else ""),
        # 实验批次（多批次实验的分组键；未标记为空）
        ColumnDef("实验批次", value=lambda r: experiment_label(r.practice_snapshot)),
        ColumnDef("状态", key="status"),
        ColumnDef("开始时间", value=lambda r: r.start_time.strftime("%Y-%m-%d %H:%M:%S") if r.start_time else ""),
        ColumnDef("结束时间", value=lambda r: r.end_time.strftime("%Y-%m-%d %H:%M:%S") if r.end_time else ""),
        ColumnDef(
            "总分",
            value=lambda r: str(r.score.effective_total) if r.score and r.score.effective_total is not None else "",
        ),
        # 成绩来源（AI 初评/教师复核/系统降级）随导出可见：降级分不进统计，导出也不能
        # 把它呈现成正常成绩。
        ColumnDef(
            "成绩来源",
            value=lambda r: (
                SOURCE_LABELS.get(
                    score_source(reviewed_total=r.score.reviewed_total, fallback=r.score.fallback),
                    "",
                )
                if r.score
                else ""
            ),
        ),
        ColumnDef("优点", value=lambda r: "；".join(r.score.strengths) if r.score and r.score.strengths else ""),
        ColumnDef("不足", value=lambda r: "；".join(r.score.weaknesses) if r.score and r.score.weaknesses else ""),
        ColumnDef(
            "漏问内容", value=lambda r: "；".join(r.score.missed_content) if r.score and r.score.missed_content else ""
        ),
        ColumnDef("改进建议", value=lambda r: r.score.suggestions if r.score else ""),
        ColumnDef("对话轮数", value=lambda r: str(msg_counts.get(r.id, 0))),
    ]
    return export_response(
        records,
        columns,
        "training_records",
        "训练记录",
        format,
        audit=ExportAudit(request=request, target_label="训练记录"),
    )


@router.post("/record/{record_id}")
def export_record_detail(
    record_id: int,
    current_user: CurrentUser,
    db: DbSession,
    scope: Scope,
):
    record = RecordService(db, scope).get_record_detail(record_id, current_user)
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
        lines.append(f"总分：{score.effective_total}")
        lines.append(
            "成绩来源："
            + SOURCE_LABELS.get(
                score_source(reviewed_total=score.reviewed_total, fallback=score.fallback),
                "",
            )
        )
        lines.append(f"分项得分（展示刻度）：{score.detail_scores}")
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
