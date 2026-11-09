"""``clinical_judgment`` Activity handler —— 证据获取与行动完成（V2）。

三条命令，全部返回最新公有状态 ``ToolResult.data = {"state": <PublicClinicalState>}``：

* ``load`` —— 返回当前公有状态（**纯投影，不写库**）。``tools.service`` 把 ``load``
  当只读命令：不取行锁、不做 revision CAS，也不为它提交事务——在这里写
  ``runtime_state`` 只会产生"响应成功但库里没有"的半截状态。开场证据
  （``initial.visible_findings``）因此**只**在真实的写入路径里原子补齐：
  ``observe``/``act`` 的 patch、或患者对话回合成功落库的同一次提交。
* ``observe`` —— ``{finding_id}``：获取一条**可主动获取且尚未观察**的证据。
  只能靠对话（``obtainable_via`` 全为 ``inquiry``）的证据在这里被拒 —— 学生必须去问，
  否则"患者说的话"就能被观察面板一键拿满分。
* ``act`` —— ``{objective_id}``：完成 ``objectives.must_act`` 里的一个行动目标。
  ``must_notice`` 由证据观察自然达成，``must_communicate`` 由对话回合达成，
  动作命令不能冒充它们。行动的 ``requires_findings`` 是**前置证据**：还没观察到的
  前置证据会让该命令被拒（``ValidationError`` 列出缺失证据的可读名），且不写
  ``completed_objectives`` —— 否则学生可以零证据连点拿分。前置证据齐全时行为不变。

幂等：重复 observe 同一条证据、重复 act 同一个目标都返回同一份最新状态（不重复追加）。
本 handler 在 ``tools.service`` 的行锁内执行，``runtime_state`` 写入使用
:func:`patch_runtime_state`（行锁 + 重读 + 只改本键），与对话回合的证据写入互不覆盖。
"""

from __future__ import annotations

import logging
from typing import Any

from core.exceptions import ValidationError
from modules.training.session.state import patch_runtime_state
from modules.training.tools.base import ToolHandler

from .state import (
    STATE_KEY,
    evidence_entry,
    findings_index,
    initial_catalog,
    is_inquiry_only,
    merge_state,
    missing_required_findings,
    objectives_of,
    observed_ids,
    public_state_for,
    read_state,
    seed_state,
)

log = logging.getLogger(__name__)

ACTIVITY_ID = "clinical_judgment"

COMMAND_LOAD = "load"
COMMAND_OBSERVE = "observe"
COMMAND_ACT = "act"

#: 获取途径登记（来源标记，落进 evidence[].source）
SOURCE_OBSERVED = "observation"
SOURCE_PATIENT = "patient"


class ClinicalJudgmentHandler(ToolHandler):
    """证据获取与行动完成（注册进 ``ACTIVITY_BINDINGS``，见包 ``__init__`` 的集成说明）。"""

    tool_name = ACTIVITY_ID
    actions = frozenset({COMMAND_LOAD, COMMAND_OBSERVE, COMMAND_ACT})

    async def handle(self, action: str, params: dict, ctx) -> Any:

        # action 白名单/授权/启用/生命周期由 registry.dispatch + service._authorize 统一校验
        if action == COMMAND_LOAD:
            return self._load(ctx)
        if action == COMMAND_OBSERVE:
            return self._observe(params, ctx)
        return self._act(params, ctx)

    # ── commands ──────────────────────────────────────────────────────────

    def _load(self, ctx) -> Any:
        """纯投影：**不写库**。

        ``tools.service`` 把 ``load`` 当只读命令（不取行锁、不做 revision CAS、也不为
        它提交事务）。在这里写 ``runtime_state`` 会留下"响应成功但库里没有"的半截状态，
        因此开场证据只在**真实写入路径**（首次 observe/act 或对话回合成功落库）里原子补齐
        （见 :func:`seed_state` 的调用点）。
        """
        from modules.training.tools.base import ToolResult

        case_data = ctx.case_data or {}
        current = ctx.record.runtime_state or {}
        seeded = seed_state(case_data, current.get(STATE_KEY))
        # 投影用「已声明的开场证据」，但**不**回写：库里还没有这些行，这里只是让学生看到
        # 开场状态；第一次真实动作会把它们一次性写入。
        return ToolResult(
            ok=True,
            data={"state": public_state_for(case_data, {STATE_KEY: seeded}, revision=ctx.record.revision)},
        )

    def _observe(self, params: dict, ctx) -> Any:
        from modules.training.tools.base import ToolResult

        finding_id = str(params.get("finding_id") or "").strip()
        if not finding_id:
            raise ValidationError(detail="缺少 finding_id")

        case_data = ctx.case_data or {}
        index = findings_index(case_data)
        finding = index.get(finding_id)
        if finding is None:
            raise ValidationError(detail=f"未知证据: {finding_id}")

        visible, hidden = initial_catalog(case_data)
        if finding_id not in set(visible) | set(hidden):
            raise ValidationError(detail=f"证据 {finding_id} 不在本病例的获取目录中")
        if is_inquiry_only(finding):
            raise ValidationError(detail="该信息只能通过与患者交流获得，不能直接观察")

        observed = {item.get("finding_id") for item in read_state(ctx.record.runtime_state)["evidence"]}
        already = finding_id in observed
        entry = None if already else evidence_entry(finding, source=SOURCE_OBSERVED)

        def _patch(current: dict) -> dict[str, Any]:
            base = seed_state(case_data, current.get(STATE_KEY))
            return {
                STATE_KEY: merge_state(
                    base=base,
                    evidence=[entry] if entry is not None else None,
                )
            }

        merged = patch_runtime_state(ctx.db, ctx.record.id, _patch)
        ctx.record.runtime_state = merged
        ctx.db.flush()
        log.info(
            "Clinical evidence observed: record_id=%d finding=%s duplicated=%s",
            ctx.record.id,
            finding_id,
            already,
        )
        return ToolResult(
            ok=True,
            data={"state": public_state_for(case_data, merged, revision=ctx.record.revision)},
        )

    def _act(self, params: dict, ctx) -> Any:
        from modules.training.tools.base import ToolResult

        objective_id = str(params.get("objective_id") or "").strip()
        if not objective_id:
            raise ValidationError(detail="缺少 objective_id")

        case_data = ctx.case_data or {}
        must_act = {str(item.get("id")): item for item in objectives_of(case_data)["must_act"] if item.get("id")}
        if objective_id not in must_act:
            raise ValidationError(detail=f"不是可执行的行动目标: {objective_id}")

        # 前置证据：没先拿到证据就能"点完成"的行动等于零证据得分。拒绝时点名缺哪几条
        # （用 findings[].label，学生看到的临床表述），且**不写** completed_objectives。
        missing = missing_required_findings(
            case_data, must_act[objective_id], observed_ids(read_state(ctx.record.runtime_state))
        )
        if missing:
            label = must_act[objective_id].get("label") or objective_id
            raise ValidationError(detail=f"缺少前置评估结果，暂时无法完成「{label}」：{'；'.join(missing)}")

        completed = set(read_state(ctx.record.runtime_state)["completed_objectives"])
        already = objective_id in completed

        def _patch(current: dict) -> dict[str, Any]:
            base = seed_state(case_data, current.get(STATE_KEY))
            return {
                STATE_KEY: merge_state(
                    base=base,
                    completed=None if already else [objective_id],
                )
            }

        merged = patch_runtime_state(ctx.db, ctx.record.id, _patch)
        ctx.record.runtime_state = merged
        ctx.db.flush()
        log.info(
            "Clinical action completed: record_id=%d objective=%s duplicated=%s",
            ctx.record.id,
            objective_id,
            already,
        )
        return ToolResult(
            ok=True,
            data={"state": public_state_for(case_data, merged, revision=ctx.record.revision)},
        )


HANDLER = ClinicalJudgmentHandler()
