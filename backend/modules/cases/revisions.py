"""病例版本（CaseRevision）与生命周期门 —— docs/15 §六。

两条不变量：

1. **已发布 revision 不可改**：本模块是 revision 的**唯一创建入口**，全仓没有
   任何更新 ``CaseRevision.content`` 的代码路径；教师改病例 = 追加新 revision。
2. **published 病例的 current revision == 工作副本**：每次成功编辑已发布病例都会
   追加 revision 并移动 ``Case.current_revision_id``，因此不存在「列上是旧版、
   case_data 是新版」的第二真相源；学员训练读 **revision.content**，不读工作副本。

本模块刻意只依赖 models / schemas（不依赖 modules.cases.validator）——发布门禁在
:mod:`modules.cases.gate`，否则 ``modules.training`` ↔ ``modules.assignments`` 的导入链
会在本模块上成环。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.exceptions import ConflictError
from models import CASE_STATUS_ARCHIVED, CASE_STATUS_PUBLISHED, Case, CaseRevision
from schemas.case_schema import strip_case_metadata


def require_publishable(case: Case) -> None:
    """新训练/作业只允许使用 published 且已产生版本的病例。

    docs/15 §六：draft 从未发布、archived 只阻止新使用 —— 两者都不接受新的作业/训练，
    但都不影响历史 revision 与既有训练的复盘。
    """
    if case.status == CASE_STATUS_PUBLISHED and case.current_revision_id is not None:
        return
    raise ConflictError(detail="该病例尚未发布（或已归档），不能用于新的训练或作业")


def require_editable(case: Case) -> None:
    """已归档病例内容冻结 —— 归档是终止动作，没有恢复路径（历史 revision 永久保留）。"""
    if case.status == CASE_STATUS_ARCHIVED:
        raise ConflictError(detail="病例已归档，内容不可再编辑")


def _next_revision_no(db: Session, case_id: int) -> int:
    current = db.query(func.max(CaseRevision.revision_no)).filter(CaseRevision.case_id == case_id).scalar()
    return int(current or 0) + 1


def content_matches_current_revision(case: Case) -> bool:
    """工作副本与 current revision 内容是否一致（决定发布是否需要新 revision）。"""
    revision = case.current_revision
    if revision is None:
        return False
    return strip_case_metadata(case.case_data or {}) == strip_case_metadata(revision.content or {})


def append_revision(db: Session, case: Case, *, user_id: int | None = None) -> CaseRevision:
    """按病例当前工作副本追加新 revision 并移动 ``current_revision_id``。

    唯一创建入口：内容冻结成快照后不再有任何写入路径。
    """
    now = datetime.now(UTC)
    revision = CaseRevision(
        case_id=case.id,
        revision_no=_next_revision_no(db, case.id),
        content=strip_case_metadata(case.case_data or {}),
        created_by=user_id,
        created_at=now,
        published_at=now,
    )
    db.add(revision)
    db.flush()
    case.current_revision_id = revision.id
    case.status = CASE_STATUS_PUBLISHED
    return revision


def require_current_revision(db: Session, case: Case) -> CaseRevision:
    """病例的 current revision（训练/作业的版本来源）；没有 = 拒绝新使用。"""
    require_publishable(case)
    revision = db.get(CaseRevision, case.current_revision_id) if case.current_revision_id else None
    if revision is None:
        raise ConflictError(detail="该病例的当前版本已不存在，不能用于新的训练或作业")
    return revision


def revision_of(db: Session, revision_id: int | None, *, case: Case | None = None) -> CaseRevision | None:
    """按 id 取 revision；``case`` 给定时校验它确实属于该病例。"""
    if revision_id is None:
        return None
    revision = db.get(CaseRevision, revision_id)
    if revision is None:
        return None
    if case is not None and revision.case_id != case.id:
        return None
    return revision


def require_pinned_revision(db: Session, revision_id: int, *, case: Case) -> CaseRevision:
    """作业/记录**钉住**的版本（docs/15 §六）：解析失败即拒绝，不回落到当前版本。

    回落会让同一份已发布作业在不同时间跑在不同内容上（版本边界失效），所以这里
    只有两种结果：拿到那条 revision，或者冲突报错。
    """
    revision = revision_of(db, revision_id, case=case)
    if revision is None:
        raise ConflictError(detail="该作业钉住的病例版本已不存在，不能开始训练")
    return revision
