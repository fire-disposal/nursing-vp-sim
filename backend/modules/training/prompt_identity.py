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

    覆盖三类事实，改任一项即改身份：

    1. ``ContextPolicy`` 的每个字段（历史预算、患者状态预算、保底轮、钉轮）；
    2. ``COMPILER_SCHEMA`` —— 消息布局与选择**算法**的版本号：算法本身无法被哈希，
       改装配行为必须显式 +1（见 ``context/compiler.py``），否则该改动在观测上隐形；
    3. 结构性标记：槽位集合、示例段标记与预算、摘要段预算。

    常量以模块属性读取，因此改策略即改身份（有测试钉住）。
    """
    from dataclasses import fields as dataclass_fields

    from modules.training.context import budget as budget_module
    from modules.training.context import compiler as compiler_module
    from modules.training.context import examples as examples_module
    from modules.training.context import history_compaction as summary_module
    from modules.training.context.fragment import ContextSlot

    policy = budget_module.DEFAULT_POLICY
    parts = [f"{field.name}={getattr(policy, field.name)}" for field in dataclass_fields(policy)]
    parts.append(f"compiler_schema={compiler_module.COMPILER_SCHEMA}")
    parts.append("slots=" + ",".join(slot.value for slot in ContextSlot))
    parts.append(f"examples_budget={examples_module.MAX_EXAMPLES_TOKENS}")
    parts.append(f"summary_budget={summary_module.SUMMARY_BUDGET_TOKENS}")
    return f"ctx@{_digest(*parts, examples_module.EXAMPLES_MARKER)[:_POLICY_LEN]}"
