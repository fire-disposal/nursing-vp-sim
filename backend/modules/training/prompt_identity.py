"""提示词**内容身份**的按需派生（docs/ideas/prompt-context-versioning.md §四）。

身份 = 产物原文的 sha256 前 12 位，**不落库、不预先物化**：

* ``training_records.prompt_snapshot`` 已经存着模板原文，随时可算；
* 只有出现真实消费者（归因端点 / 版本页）时才派生 —— 现消费者是
  ``modules/admin/versions.py`` 的只读归因查询；
* 若将来聚合成本证明需要物化列，物化值必须能被这里重算验证（设计里的不变式）。

形状不是内容：v1 扁平与 v2 segments 只要文本相同，身份必须相同。
"""

from __future__ import annotations

import hashlib

_ID_LEN = 12
_POLICY_LEN = 8


def _digest(*parts: str) -> str:
    """按顺序哈希；``\\x00`` 分隔，避免相邻字段拼接歧义（ab|c 与 a|bc）。"""
    hasher = hashlib.sha256()
    for part in parts:
        hasher.update(part.encode("utf-8"))
        hasher.update(b"\x00")
    return hasher.hexdigest()


def compute_prompt_id(workflow_id: str, system: str, dynamic: str) -> str:
    """``{workflow_id}@{hash12}``：同一 workflow 的提示词原文身份。"""
    return f"{workflow_id}@{_digest(system, dynamic)[:_ID_LEN]}"


def prompt_id_from_snapshot(snapshot: dict | None, workflow_id: str | None) -> str | None:
    """从冻结的 ``prompt_snapshot`` 派生身份；快照为空或缺 workflow 时返回 None。

    ``workflow_id`` 由**记录**提供（快照里只有模板文本，没有 workflow 身份）。
    """
    if not snapshot or not workflow_id:
        return None
    segments = snapshot.get("segments") or {} if snapshot.get("schema_version", 1) >= 2 else snapshot
    system = segments.get("system") or ""
    dynamic = segments.get("dynamic") or ""
    if not system and not dynamic:
        return None
    return compute_prompt_id(workflow_id, system, dynamic)


def compute_context_policy_version() -> str:
    """上下文装配策略身份：``ctx@{hash8}``。

    覆盖**预算类常量**与结构性标记（槽位集合、示例段标记）——这些决定"每轮把什么放进
    prompt、先裁谁"。常量以模块属性读取，因此改预算即改身份（有测试钉住）。

    已知边界：只改装配**算法**而不动这些常量，身份不变。算法级改动应在改动里同步更新
    被覆盖的标记（或在评审里明确这是身份盲区），不靠人工版本号兜底。
    """
    from modules.training.context import budget as budget_module
    from modules.training.context.examples import EXAMPLES_MARKER
    from modules.training.context.fragment import ContextSlot

    budget_parts = (
        f"history_budget={budget_module.HISTORY_BUDGET_TOKENS}",
        f"patient_state_budget={budget_module.PATIENT_STATE_BUDGET_TOKENS}",
        f"min_history_rounds={budget_module.MIN_HISTORY_ROUNDS}",
        f"head_pinned_rounds={budget_module.HEAD_PINNED_ROUNDS}",
        f"max_token_scale={budget_module.MAX_TOKEN_SCALE}",
    )
    slots = ",".join(slot.value for slot in ContextSlot)
    return f"ctx@{_digest(*budget_parts, slots, EXAMPLES_MARKER)[:_POLICY_LEN]}"
