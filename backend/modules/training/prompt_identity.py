"""提示词与上下文产物的**内容身份**（docs/ideas/prompt-context-versioning.md）。

设计要点：

* 身份**内容派生**（sha256），不用人工递增版本号 —— 人工号会"忘了改"。
* 身份只覆盖**产物原文**，不覆盖渲染结果：渲染随病例数据变化，那是上下文而非提示词。
* 提示词形状（``schema_version`` 1/2）与提示词内容是两件事：v1 扁平与 v2 segments
  只要文本相同，身份必须相同 —— 形状不是版本。
* 常量以**模块属性**方式读取，便于测试证明"改常量 ⇒ 改身份"。

不在这里做的事：身份落库（列）、聚合、UI。见设计的 S2-S6。
"""

from __future__ import annotations

import hashlib
from functools import cache

from modules.training.context import budget as budget_module
from modules.training.context.examples import EXAMPLES_MARKER
from modules.training.context.fragment import ContextSlot

_ID_LEN = 12
_POLICY_LEN = 8

#: 生成器身份用的哨兵 rubric —— 隔离"生成器结构"与"真实 rubric 内容"，
#: 避免 rubric 变化污染评分提示词身份（rubric 由 ``rubric_version`` 单独标识）。
_IDENTITY_SENTINEL_RUBRIC = {"id": "__identity__", "version": "0", "dimensions": []}


def _digest(*parts: str) -> str:
    """按顺序拼接并哈希（\\x00 分隔，避免相邻字段歧义拼接）。"""
    hasher = hashlib.sha256()
    for part in parts:
        hasher.update(part.encode("utf-8"))
        hasher.update(b"\x00")
    return hasher.hexdigest()


def compute_prompt_id(workflow_id: str, system: str, dynamic: str) -> str:
    """患者对话提示词身份：``{workflow_id}@{hash12}``。

    ``system`` / ``dynamic`` 是 workflow 声明的模板**原文**（未渲染）。
    """
    return f"{workflow_id}@{_digest(system, dynamic)[:_ID_LEN]}"


def prompt_id_from_snapshot(snapshot: dict | None, workflow_id: str) -> str | None:
    """从已冻结的 ``prompt_snapshot`` 计算身份；空快照返回 None。

    ``workflow_id`` 由**记录**提供（快照里只有模板文本，没有 workflow 身份）。
    对 v1 扁平与 v2 segments 形状给出**相同**结果（形状不是版本，内容才是）。
    读取方式与 ``snapshot_compat.read_prompt_snapshot`` 一致，但不依赖其 dataclass，
    避免身份计算被形状演化绑住。
    """
    if not snapshot:
        return None
    segments = snapshot.get("segments") or {} if snapshot.get("schema_version", 1) >= 2 else snapshot
    if not segments.get("system") and not segments.get("dynamic"):
        return None
    return compute_prompt_id(workflow_id, segments.get("system", ""), segments.get("dynamic", ""))


@cache
def _generator_shape() -> str:
    """哨兵 rubric 下 JSON schema 生成器的输出（生成器结构身份；进程内不变）。"""
    from modules.training.scoring.prompt_builder import build_scoring_json_schema

    return build_scoring_json_schema(_IDENTITY_SENTINEL_RUBRIC)


def compute_scoring_prompt_id() -> str:
    """评分提示词身份：两个评分模板原文 + JSON schema 生成器在哨兵输入下的结构。

    模板经**模块属性**读取，因此模板文本变化即身份变化（无进程内缓存）。
    生成器结构用哨兵 rubric 求值，既捕获生成器改动，又不与真实 rubric 耦合。
    """
    from modules.training.prompts import scoring as scoring_prompts

    digest = _digest(
        scoring_prompts.SCORING_SYSTEM,
        scoring_prompts.SCORING_FEEDBACK_SYSTEM,
        _generator_shape(),
    )
    return f"score@{digest[:_ID_LEN]}"


def compute_context_policy_version() -> str:
    """上下文装配策略身份：``ctx@{hash8}``。

    覆盖预算常量与结构性标记（槽位集合、示例段标记）。不改常量而改变装配**行为**
    （例如重写裁剪算法）需要同时更新这里覆盖的标记，否则身份不变 —— 这是本设计的
    已知边界，见设计文档"风险"一节。
    """
    budget_parts = (
        f"history_budget={budget_module.HISTORY_BUDGET_TOKENS}",
        f"patient_state_budget={budget_module.PATIENT_STATE_BUDGET_TOKENS}",
        f"min_history_rounds={budget_module.MIN_HISTORY_ROUNDS}",
        f"head_pinned_rounds={budget_module.HEAD_PINNED_ROUNDS}",
        f"max_token_scale={budget_module.MAX_TOKEN_SCALE}",
    )
    slots = ",".join(slot.value for slot in ContextSlot)
    return f"ctx@{_digest(*budget_parts, slots, EXAMPLES_MARKER)[:_POLICY_LEN]}"


def context_fingerprint(policy_version: str, ledger: dict) -> str:
    """单轮上下文指纹：策略身份 + ledger 中的**取舍事实**。

    只取数值字段（各段 token、预算、有效预算、裁掉的轮次、token scale），不含文本，
    因此可安全落审计表用于等值比较：同一策略下取舍相同 ⇒ 指纹相同。
    """
    numeric = {
        key: value for key, value in ledger.items() if isinstance(value, int | float) and not isinstance(value, bool)
    }
    payload = "|".join(f"{key}={numeric[key]}" for key in sorted(numeric))
    return f"{policy_version}#{_digest(payload)[:_ID_LEN]}"
