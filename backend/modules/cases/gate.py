"""病例发布门禁 —— docs/15 §六、§十。

复用 CI 病例审计的同一份校验器（:mod:`modules.cases.validator`）：发布动作与
``scripts/case-audit.py`` 用同一批规则，「发布即失败」的判定不会漂移。

已发布病例的**编辑**同样过这道门（编辑即产生新版本，规则与其他新版本一致）。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from core.exceptions import ErrorCode
from models import Case
from modules.cases.builtin_sync import SEED_HASH_KEY
from modules.cases.validator import CaseIssue, CaseReport, validate_case
from schemas.case import CaseValidationIssue, CaseValidationReport
from schemas.case_schema import strip_case_metadata

CODE_NOT_PUBLISHABLE = "CASE_NOT_PUBLISHABLE"


class CaseNotPublishableError(HTTPException):
    """发布门禁拒绝（422）：detail 携带字段级报告，前端直接渲染 errors[].field/message。"""

    def __init__(self, case: Case, report: CaseReport):
        self.error_code = ErrorCode.VALIDATION
        self.report = build_validation_report(case, report)
        super().__init__(
            status_code=422,
            detail={
                "code": CODE_NOT_PUBLISHABLE,
                "message": f"病例未通过发布门禁：{len(report.errors)} 个 error",
                "report": self.report.model_dump(mode="json"),
            },
        )


def _issue(item: CaseIssue) -> CaseValidationIssue:
    return CaseValidationIssue(severity=item.severity, field=item.field, message=item.message, fix_hint=item.fix_hint)


def build_validation_report(case: Case, report: CaseReport) -> CaseValidationReport:
    return CaseValidationReport(
        case_id=case.id,
        case_name=case.name,
        publishable=not report.errors,
        errors=[_issue(i) for i in report.issues if i.severity == "error"],
        warnings=[_issue(i) for i in report.issues if i.severity == "warning"],
        infos=[_issue(i) for i in report.issues if i.severity == "info"],
    )


def validation_payload(case_data: dict[str, Any], *, name: str, difficulty: int, time_limit: int) -> dict:
    """把「列上的元数据 + case_data 载荷」拼回校验器认识的病例形状。

    校验器以病例 JSON 为输入（元数据在文件里与内容同层）；落库后元数据只在列上，
    所以这里重新拼回 —— 保证「时长合法 / 难度」这类规则校验的是**库内当前值**，
    而不是 case_data 里已被剥离的副本。

    ``_seed_hash`` 是存储指纹，不是病例字段（CI 病例审计读文件时根本没有这个键），
    拼回时必须排除，否则内置病例会拿到一条「未登记消费端」的假警告。
    """
    payload = {k: v for k, v in strip_case_metadata(case_data).items() if k != SEED_HASH_KEY}
    return {"name": name, "difficulty": difficulty, "time_limit": time_limit, **payload}


def validate_candidate(case_data: dict[str, Any], *, name: str, difficulty: int, time_limit: int) -> CaseReport:
    """对候选内容跑发布门禁（不落库、不改工作副本）。"""
    return validate_case(validation_payload(case_data, name=name, difficulty=difficulty, time_limit=time_limit))


def validate_case_row(case: Case) -> CaseReport:
    """发布门禁：对库内当前内容跑病例质量校验（纯函数，不落库）。"""
    return validate_candidate(
        case.case_data or {}, name=case.name, difficulty=case.difficulty, time_limit=case.time_limit_minutes
    )
