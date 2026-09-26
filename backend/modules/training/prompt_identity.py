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
