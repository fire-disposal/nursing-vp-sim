"""Resolved Manifest —— 服务端解析出的单一真相源（docs/15 §四·补）。

同一 envelope 支持三种投影（session / catalog / authoring）；本切片只落地
``projection="session"``：学生运行时的 activities[].availability、artifacts
（draft/submitted）、completion（eligible/conditions/blockers）与 actions[].enabled。

硬规则：前端不得重新推导 availability / completion / audience / 病例版本 ——
``eligible`` 与 ``availability`` 一律来自这里。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.statuses import TrainingStatus
from modules.training.activities import artifact_definition, resolve_activities
from modules.training.profile import WorkflowDefinition

SCHEMA = "workflow-manifest"
PROJECTION_SESSION = "session"

ARTIFACT_EMPTY = "empty"
ARTIFACT_DRAFT = "draft"
ARTIFACT_SUBMITTED = "submitted"

#: 完成阻塞的机器可读码（前端只渲染 message 与 target，不自行判定）
CODE_SESSION_NOT_ACTIVE = "SESSION_NOT_ACTIVE"
CODE_ARTIFACT_NOT_SUBMITTED = "ARTIFACT_NOT_SUBMITTED"

ACTION_COMPLETE_SESSION = "complete_session"


@dataclass(frozen=True)
class ArtifactState:
    """学生产物状态（目前只有护理记录一种产物）。"""

    kind: str
    state: str = ARTIFACT_EMPTY
    required: bool = False
    submitted_at: str | None = None
    updated_at: str | None = None

    @property
    def submitted(self) -> bool:
        return self.state == ARTIFACT_SUBMITTED


def build_session_manifest(
    *,
    session_id: int,
    status: str,
    revision: int | None,
    case_data: Mapping[str, Any] | None,
    workflow: WorkflowDefinition,
    case_id: int | None = None,
    case_revision_id: int | None = None,
    case_revision_no: int | None = None,
    overrides: Mapping[str, Any] | None = None,
    artifacts: Mapping[str, ArtifactState] | None = None,
) -> dict[str, Any]:
    """解析会话 manifest（纯函数：入参齐备即可复算，无 IO）。"""
    session_active = status == TrainingStatus.IN_PROGRESS
    resolved_activities = resolve_activities(
        case_data,
        allowed=workflow.activities,
        overrides=overrides,
        session_active=session_active,
    )
    # 产物只在病例真的启用了对应 Activity 时才存在（与 finalize 的完成判定同一口径）
    configured_artifacts = {
        str(item.definition.artifact_kind)
        for item in resolve_activities(case_data, allowed=workflow.activities, overrides=overrides)
        if item.availability.available and item.definition.artifact_kind
    }
    resolved_artifacts = {
        kind: ArtifactState(
            kind=kind,
            state=artifact.state,
            required=workflow.completion.covers(kind),
            submitted_at=artifact.submitted_at,
            updated_at=artifact.updated_at,
        )
        for kind, artifact in (artifacts or {}).items()
        if kind in configured_artifacts
    }
    for kind in configured_artifacts:
        resolved_artifacts.setdefault(kind, ArtifactState(kind=kind, required=workflow.completion.covers(kind)))

    conditions: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    if not session_active:
        blockers.append(
            {
                "code": CODE_SESSION_NOT_ACTIVE,
                "message": "训练已结束，无法再次提交完成",
                "target": None,
            }
        )
    for kind in (k for k in workflow.completion.required_artifacts if k in configured_artifacts):
        artifact = resolved_artifacts.get(kind) or ArtifactState(kind=kind, required=True)
        definition = artifact_definition(kind)
        label = definition.label if definition else kind
        satisfied = artifact.submitted
        conditions.append({"id": f"{kind}_submitted", "label": f"提交{label}", "satisfied": satisfied})
        if session_active and not satisfied:
            blockers.append(
                {
                    "code": CODE_ARTIFACT_NOT_SUBMITTED,
                    "message": f"请先提交{label}，再结束训练",
                    "target": {"type": "artifact", "id": kind},
                }
            )

    eligible = session_active and all(condition["satisfied"] for condition in conditions)

    return {
        "schema": SCHEMA,
        "projection": PROJECTION_SESSION,
        "workflow": {"id": workflow.id, "label": workflow.label, "ui": dict(workflow.ui)},
        # 会话引用的病例版本（docs/15 §六）：旧记录（迁移前）没有 revision_id，
        # 只有 case_snapshot，因此两项都可能为 null。
        "case": {"case_id": case_id, "revision_id": case_revision_id, "revision_no": case_revision_no},
        "session": {"session_id": session_id, "status": status, "revision": revision},
        "activities": [
            {
                "id": resolved.definition.id,
                "label": resolved.definition.label,
                "availability": {
                    "state": resolved.availability.state,
                    "reason_code": resolved.availability.reason_code,
                },
                "commands": sorted(resolved.definition.commands),
                "ui": {
                    "renderer": resolved.definition.ui_renderer,
                    "placement": resolved.definition.ui_placement,
                    "order": resolved.definition.ui_order,
                },
                "evidence_kind": resolved.definition.evidence_kind,
                "artifact_kind": resolved.definition.artifact_kind,
            }
            for resolved in resolved_activities
        ],
        "artifacts": {
            kind: {
                "required": artifact.required,
                "state": artifact.state,
                "submitted_at": artifact.submitted_at,
                "updated_at": artifact.updated_at,
            }
            for kind, artifact in resolved_artifacts.items()
        },
        "completion": {"eligible": eligible, "conditions": conditions, "blockers": blockers},
        "actions": [
            {
                "id": ACTION_COMPLETE_SESSION,
                "label": "结束训练",
                "enabled": eligible,
            }
        ],
    }
