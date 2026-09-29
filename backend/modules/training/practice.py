"""复盘后的再练习：同例纠正与迁移变式。

服务端**唯一**解析允许的目标病例，前端不自行拼目标 case_id：

* 同例纠正（``remediation``）：回到源训练钉住的病例。病例内容若已更新（新 revision），
  本次同例练习使用**当前** revision，并在记录里显式标记 ``revision_changed`` ——
  绝不悄悄换成新版本却让界面声称"同一任务"。
* 迁移变式（``transfer``）：只能沿教学蓝图声明的家族关系找同族的另一角色病例
  （练习病例 ↔ 迁移变式）。没有声明家族关系时**没有**迁移入口，不渲染假入口。

写入面只有 ``practice_snapshot["practice"]`` 一个键（记录创建期配置的快照），
与 ``features`` 同属记录创建期的冻结配置，不新增列、不新建表。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from models import CASE_STATUS_PUBLISHED, Case, CaseRevision, TrainingRecord
from modules.training.blueprint import family_view
from modules.training.workflows import case_is_startable

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

PRACTICE_KIND_REMEDIATION = "remediation"
PRACTICE_KIND_TRANSFER = "transfer"
PRACTICE_KINDS = (PRACTICE_KIND_REMEDIATION, PRACTICE_KIND_TRANSFER)

PRACTICE_FIELD = "practice"

#: 不可用原因的机器可读码（前端据此决定是否渲染入口，不猜）。
REASON_SOURCE_NOT_FINISHED = "source_not_finished"
REASON_NO_FAMILY = "no_family_declared"
REASON_NO_COUNTERPART = "no_counterpart_available"
REASON_CASE_NOT_OPEN = "case_not_open"
REASON_WORKFLOW_NOT_STARTABLE = "workflow_not_startable"

PRACTICE_LABELS = {
    PRACTICE_KIND_REMEDIATION: "同例纠正练习",
    PRACTICE_KIND_TRANSFER: "变式迁移练习",
}


@dataclass(frozen=True)
class PracticeTarget:
    """解析出的再练习目标。"""

    kind: str
    case: Case
    revision: CaseRevision
    #: 同例纠正时病例内容已更新（源记录钉住的 revision ≠ 当前 revision）
    revision_changed: bool = False
    source_record_id: int | None = None


class PracticeTargetUnavailable(Exception):
    """没有可用的再练习目标（附机器可读原因）。"""

    def __init__(self, kind: str, reason: str, message: str) -> None:
        self.kind = kind
        self.reason = reason
        self.message = message
        super().__init__(message)


def _content_sources(case: Case) -> list[tuple[Case, dict]]:
    """病例的**已发布**内容（当前 revision 优先，回落工作副本用于未发布病例）。"""
    revision = getattr(case, "current_revision", None)
    content = getattr(revision, "content", None)
    if isinstance(content, dict) and content:
        return [(case, content)]
    working = getattr(case, "case_data", None)
    return [(case, working)] if isinstance(working, dict) else []


def _family_candidates(db: Session, family_id: str, wanted_role: str) -> Sequence[tuple[Case, dict]]:
    """同族里扮演目标角色的可开始病例（按 case id 稳定排序，结果可复现）。"""
    if not family_id:
        return []
    cases = db.query(Case).filter(Case.status == CASE_STATUS_PUBLISHED, Case.is_open == True).order_by(Case.id).all()
    matches: list[tuple[Case, dict]] = []
    for candidate in cases:
        for case, content in _content_sources(candidate):
            view = family_view(content)
            if view["family_id"] == family_id and view["variant_role"] == wanted_role:
                matches.append((case, content))
                break
    return matches


def _require_startable_case(db: Session, kind: str, case: Case) -> None:
    """目标病例可开始：先看病例是否开放，再看 workflow 是否运行期就绪。

    与 ``POST /start`` 的门禁一致（``Case.is_open``）—— 再练习不能成为绕过"病例已关闭"的入口。
    """
    if not case.is_open:
        raise PracticeTargetUnavailable(kind, REASON_CASE_NOT_OPEN, "该病例已关闭，无法开始新的训练")
    if not case_is_startable(case):
        raise PracticeTargetUnavailable(
            kind,
            REASON_WORKFLOW_NOT_STARTABLE,
            "该病例所属训练类型暂不支持开始训练",
        )


def resolve_practice_target(
    db: Session,
    *,
    source: TrainingRecord,
    kind: str,
    require_current_revision,
) -> PracticeTarget:
    """解析再练习目标病例与要钉住的 revision。

    Args:
        source: 源训练记录（已完成，属当前学生）
        kind: ``remediation`` | ``transfer``
        require_current_revision: ``modules.cases.revisions.require_current_revision``
            （由调用方注入，避免本模块反向依赖路由/服务层）
    """
    source_case = db.query(Case).filter(Case.id == source.case_id).first()
    if source_case is None:
        raise PracticeTargetUnavailable(kind, REASON_NO_COUNTERPART, "源病例已不可用")

    source_content = source.case_snapshot or {}
    view = family_view(source_content)

    if kind == PRACTICE_KIND_REMEDIATION:
        _require_startable_case(db, kind, source_case)
        revision = require_current_revision(db, source_case)
        return PracticeTarget(
            kind=kind,
            case=source_case,
            revision=revision,
            revision_changed=bool(source.case_revision_id is not None and revision.id != source.case_revision_id),
            source_record_id=source.id,
        )

    if kind != PRACTICE_KIND_TRANSFER:
        raise PracticeTargetUnavailable(kind, REASON_NO_COUNTERPART, "未知的再练习类型")

    if not view["family_id"]:
        raise PracticeTargetUnavailable(
            kind,
            REASON_NO_FAMILY,
            "该病例未声明病例家族与迁移变式，暂不提供迁移练习",
        )
    wanted_role = "transfer" if view["variant_role"] == "practice" else "practice"
    candidates = _family_candidates(db, view["family_id"], wanted_role)
    if not candidates:
        raise PracticeTargetUnavailable(
            kind,
            REASON_NO_COUNTERPART,
            "该家族暂无可用的迁移练习病例",
        )
    target_case, _content = candidates[0]
    _require_startable_case(db, kind, target_case)
    revision = require_current_revision(db, target_case)
    return PracticeTarget(
        kind=kind,
        case=target_case,
        revision=revision,
        source_record_id=source.id,
    )


def practice_options(
    db: Session,
    *,
    source: TrainingRecord,
    require_current_revision,
) -> dict:
    """结果页可用的再练习入口（服务端解析；不可用时不渲染入口）。"""
    options: dict[str, dict] = {}
    for kind in PRACTICE_KINDS:
        try:
            target = resolve_practice_target(
                db, source=source, kind=kind, require_current_revision=require_current_revision
            )
        except PracticeTargetUnavailable as exc:
            options[kind] = {
                "available": False,
                "label": PRACTICE_LABELS[kind],
                "reason": exc.reason,
                "message": exc.message,
            }
            continue
        options[kind] = {
            "available": True,
            "label": PRACTICE_LABELS[kind],
            "case_id": target.case.id,
            "case_name": target.case.name,
            "revision_changed": target.revision_changed,
            "message": ("该病例内容已更新，本次同例练习使用最新版本" if target.revision_changed else ""),
        }
    return options


def practice_snapshot_entry(target: PracticeTarget) -> dict:
    """写进 ``practice_snapshot["practice"]`` 的留痕：练习目的与来源。"""
    return {
        "kind": target.kind,
        "purpose": PRACTICE_LABELS.get(target.kind, target.kind),
        "source_record_id": target.source_record_id,
        "revision_changed": target.revision_changed,
    }
