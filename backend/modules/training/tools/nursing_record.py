"""Nursing record tool handler — ADPIE form storage with patient context prefill.

护理评估生命周期（``draft`` → ``submitted``）：提交是**学生的动作**，不是系统的副作用。

- ``save``：只写草稿，且 ``status`` 永远由服务端写成 ``draft``（客户端不能自封已提交）；
  已提交后 ``save`` 返回冲突，绝不静默覆盖冻结内容。
- ``submit``：把当前草稿冻结成提交版本（写 ``submitted_at``）；幂等（重复提交返回同一时间戳）；
  可携带最后一次 ``sheet_data``，服务端在**同一事务**里先落盘再提交。
- ``reopen``：显式重开草稿——解除冻结的唯一途径（训练结束后被 registry 授权层挡住）。
- ``load``：回放服务端真值（``status`` / ``submitted_at`` / ``missing_fields``），前端据此进只读态。

只有 ``submitted_at`` 非空的冻结版本才进入评分证据（见 ``scoring/engine.py``）。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from core.exceptions import AppError, ValidationError
from models import NursingRecord

from .base import ToolContext, ToolHandler, ToolResult

log = logging.getLogger(__name__)

STATUS_DRAFT = "draft"
STATUS_SUBMITTED = "submitted"

#: ADPIE 字段顺序 —— 模板、缺失提示与评分注入共用同一顺序
FIELD_KEYS: tuple[str, ...] = ("subjective", "objective", "assessment", "plan", "evaluation")

CODE_SUBMITTED = "nursing_record_submitted"
CODE_EMPTY = "nursing_record_empty"
CODE_MISSING = "nursing_record_missing"
CODE_REQUIRED = "nursing_record_required"

_FIELD_LABELS: dict[str, str] = {
    "subjective": "主观资料 (S)",
    "objective": "客观资料 (O)",
    "assessment": "评估 (A)",
    "plan": "计划 (P)",
    "evaluation": "评价 (E)",
}

_HINTS: dict[str, str] = {
    "subjective": "记录患者主诉、症状感受、现病史和既往史要点",
    "objective": "记录生命体征、体格检查结果、实验室数据等客观信息",
    "assessment": "基于收集的信息提出护理诊断，评估风险等级",
    "plan": "制定具体的护理措施、预期目标和健康教育内容",
    "evaluation": "评价措施效果，记录病情变化和后续计划",
}


class NursingAssessmentError(AppError):
    """护理评估生命周期错误。

    工具面（``/tools``）由 handler 转成 ``ok=False`` + ``data.code``；
    完成面（``/end``）由路由转成 409 的 ``{message, code, missing_fields}``——
    同一条域规则只在这里定义一次。
    """

    code = "nursing_record_error"
    status_code = 409
    default_message = "护理评估操作失败"

    def __init__(self, message: str | None = None, *, missing_fields: list[str] | None = None) -> None:
        self.message = message or self.default_message
        self.missing_fields = list(missing_fields or [])
        super().__init__(self.message)


class NursingAssessmentMissingError(NursingAssessmentError):
    """尚无任何护理评估记录（连草稿都没有）。"""

    code = CODE_MISSING
    status_code = 400
    default_message = "护理评估尚未创建，请先填写并保存草稿"


class NursingAssessmentEmptyError(NursingAssessmentError):
    """内容为空 —— 空提交等于「零评估」，必须拒绝。"""

    code = CODE_EMPTY
    status_code = 400
    default_message = "护理评估内容为空，请至少填写一项后提交"


class NursingAssessmentSubmittedError(NursingAssessmentError):
    """已提交的内容被再次编辑 —— 冻结版本不可静默覆盖。"""

    code = CODE_SUBMITTED
    status_code = 409
    default_message = "护理评估已提交，内容不可修改；如需修改请先重新编辑"


class NursingAssessmentRequiredError(NursingAssessmentError):
    """要求评估的 workflow 里，完成训练前必须存在已提交版本。"""

    code = CODE_REQUIRED
    status_code = 409
    default_message = "请先提交护理评估记录，再结束训练"


def get_nursing_record(db, record_id: int) -> NursingRecord | None:
    """一条训练至多一份护理评估（``nursing_records.record_id`` 唯一）。"""
    return db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()


def is_submitted(nr: NursingRecord | None) -> bool:
    return nr is not None and nr.submitted_at is not None


def filled_fields(sheet: dict | None) -> list[str]:
    """已填写（去空白后非空）的 ADPIE 字段。"""
    data = sheet or {}
    return [k for k in FIELD_KEYS if str(data.get(k) or "").strip()]


def missing_fields(sheet: dict | None) -> list[str]:
    """未填写字段 —— 前端据此提示「还差哪几项」。"""
    data = sheet or {}
    return [k for k in FIELD_KEYS if not str(data.get(k) or "").strip()]


def submit_nursing_assessment(
    db,
    *,
    record_id: int,
    user_id: int,
    sheet_data: dict | None = None,
    at: datetime | None = None,
) -> NursingRecord:
    """把护理评估冻结成提交版本（幂等）。**不做事务提交** —— 由调用方持有事务边界。

    ``sheet_data`` 非空时先落盘为草稿再提交（``/end`` 的原子「提交并完成」路径），
    因此客户端最后一次输入与服务端冻结内容必然一致。

    Raises:
        NursingAssessmentMissingError: 无记录且未提供内容。
        NursingAssessmentEmptyError: 全部字段为空（空提交 == 零评估）。
        NursingAssessmentSubmittedError: 已提交且内容不同 —— 拒绝覆盖冻结版本。
    """
    now = at or datetime.now(UTC)
    nr = get_nursing_record(db, record_id)

    incoming = dict(sheet_data) if sheet_data is not None else None
    if nr is None:
        if incoming is None:
            raise NursingAssessmentMissingError
        if not filled_fields(incoming):
            raise NursingAssessmentEmptyError(missing_fields=missing_fields(incoming))
        nr = NursingRecord(
            record_id=record_id,
            user_id=user_id,
            sheet_data=incoming,
            status=STATUS_DRAFT,
        )
        db.add(nr)
    elif nr.submitted_at is not None:
        if incoming is not None and incoming != dict(nr.sheet_data or {}):
            raise NursingAssessmentSubmittedError(missing_fields=missing_fields(nr.sheet_data))
        return nr  # 幂等：重复提交返回同一冻结版本
    elif incoming is not None:
        nr.sheet_data = incoming

    sheet = dict(nr.sheet_data or {})
    if not filled_fields(sheet):
        raise NursingAssessmentEmptyError(missing_fields=missing_fields(sheet))

    nr.submitted_at = now
    nr.status = STATUS_SUBMITTED
    nr.updated_at = now
    db.flush()
    log.info("Nursing assessment submitted: record_id=%d fields=%s", record_id, ",".join(filled_fields(sheet)))
    return nr


def reopen_nursing_assessment(db, *, record_id: int, at: datetime | None = None) -> NursingRecord:
    """显式重开草稿 —— 已提交内容解除冻结的唯一途径。"""
    nr = get_nursing_record(db, record_id)
    if nr is None:
        raise NursingAssessmentMissingError
    if nr.submitted_at is None:
        return nr
    nr.submitted_at = None
    nr.status = STATUS_DRAFT
    nr.updated_at = at or datetime.now(UTC)
    db.flush()
    log.info("Nursing assessment reopened as draft: record_id=%d", record_id)
    return nr


class NursingRecordHandler(ToolHandler):
    tool_name = "nursing_record"
    actions = frozenset({"load", "save", "submit", "reopen"})

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        # action/授权/启用由 registry.dispatch + service._authorize 统一校验
        if action == "load":
            return self._load(ctx)
        if action == "save":
            return self._save(params, ctx)
        if action == "reopen":
            return self._reopen(ctx)
        return self._submit(params, ctx)

    # ── actions ──────────────────────────────────────────────────────────

    def _load(self, ctx: ToolContext) -> ToolResult:
        nr = get_nursing_record(ctx.db, ctx.record.id)
        if nr is not None:
            return ToolResult(ok=True, data=self._state_payload(nr))
        # 尚无记录 —— 返回模板（未落库），学生首次保存才创建草稿。
        return ToolResult(ok=True, data=self._build_template(ctx))

    def _save(self, params: dict, ctx: ToolContext) -> ToolResult:
        sheet_data = params.get("sheet_data")
        if not isinstance(sheet_data, dict):
            raise ValidationError(detail="sheet_data 必须是对象")

        nr = get_nursing_record(ctx.db, ctx.record.id)
        if nr is not None and nr.submitted_at is not None:
            # 冻结版本不可覆盖：客户端必须显式 reopen 才能继续编辑。
            return ToolResult(
                ok=False,
                error=f"{NursingAssessmentSubmittedError.default_message}",
                data={
                    "code": CODE_SUBMITTED,
                    "status": STATUS_SUBMITTED,
                    "submitted_at": nr.submitted_at.isoformat(),
                },
            )

        if nr is None:
            nr = NursingRecord(
                record_id=ctx.record.id,
                user_id=ctx.current_user.id,
                sheet_data=dict(sheet_data),
                status=STATUS_DRAFT,
            )
            ctx.db.add(nr)
        else:
            nr.sheet_data = dict(sheet_data)
            # status 由服务端独占：客户端传什么都不改变「草稿」这一事实。
            nr.status = STATUS_DRAFT
        nr.updated_at = datetime.now(UTC)

        ctx.db.flush()
        return ToolResult(ok=True, data=self._state_payload(nr))

    def _submit(self, params: dict, ctx: ToolContext) -> ToolResult:
        """提交护理评估（幂等）—— 内容冻结，此后只读。"""
        sheet_data = params.get("sheet_data")
        if sheet_data is not None and not isinstance(sheet_data, dict):
            raise ValidationError(detail="sheet_data 必须是对象")
        try:
            nr = submit_nursing_assessment(
                ctx.db,
                record_id=ctx.record.id,
                user_id=ctx.current_user.id,
                sheet_data=sheet_data,
            )
        except NursingAssessmentError as exc:
            return ToolResult(ok=False, error=exc.message, data=self._error_payload(exc))
        return ToolResult(ok=True, data=self._state_payload(nr))

    def _reopen(self, ctx: ToolContext) -> ToolResult:
        """重开草稿：提交版解冻，学生可继续编辑并再次提交。"""
        try:
            nr = reopen_nursing_assessment(ctx.db, record_id=ctx.record.id)
        except NursingAssessmentError as exc:
            return ToolResult(ok=False, error=exc.message, data=self._error_payload(exc))
        return ToolResult(ok=True, data=self._state_payload(nr))

    # ── payloads ─────────────────────────────────────────────────────────

    @staticmethod
    def _error_payload(exc: NursingAssessmentError) -> dict:
        return {"code": exc.code, "message": exc.message, "missing_fields": exc.missing_fields}

    @classmethod
    def _state_payload(cls, nr: NursingRecord) -> dict:
        submitted = nr.submitted_at is not None
        sheet = dict(nr.sheet_data or {})
        return {
            "id": nr.id,
            "sheet_data": sheet,
            "status": STATUS_SUBMITTED if submitted else STATUS_DRAFT,
            "submitted_at": nr.submitted_at.isoformat() if nr.submitted_at else None,
            "updated_at": nr.updated_at.isoformat() if nr.updated_at else None,
            "editable": not submitted,
            "missing_fields": missing_fields(sheet),
        }

    def _build_template(self, ctx: ToolContext) -> dict:
        """Build template with fixed hints and patient context prefill."""
        case_data = ctx.case_data or {}
        sheet: dict[str, str] = dict.fromkeys(_FIELD_LABELS, "")
        info = case_data.get("patient_info") or {}
        name = info.get("name", "患者")
        age = info.get("age", "")
        gender = info.get("gender", "")
        chief = case_data.get("chief_complaint", "")
        parts = [f"患者{name}"]
        if age:
            parts.append(f"{age}岁")
        if gender:
            parts.append(gender)
        patient_line = "，".join(parts)
        objective = patient_line
        if chief:
            objective += f"。主诉：{chief}"
        objective += "。\n\n生命体征：\n\n体格检查：\n\n实验室检查："
        sheet["objective"] = objective
        return {
            "id": 0,
            "sheet_data": sheet,
            "status": STATUS_DRAFT,
            "submitted_at": None,
            "updated_at": None,
            "editable": True,
            "missing_fields": missing_fields(sheet),
            "template": {"hints": dict(_HINTS), "fields": dict(_FIELD_LABELS)},
        }
