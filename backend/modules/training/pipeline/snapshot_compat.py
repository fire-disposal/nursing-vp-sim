"""Prompt snapshot compat reader — handles v1 (flat) and v2 (versioned segments).

v1 (legacy, no schema_version):
    {"system": "...", "dynamic": "..."}

v2 (current):
    {"schema_version": 2, "segments": {"system": "...", "dynamic": "..."}}

形状版本描述的是**布局**，不是内容：v1→v2 只是键位搬家，提示词内容没变。
内容身份不在这里（见 docs/17 §2.3）。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PromptSnapshot:
    schema_version: int
    system: str
    dynamic: str


def read_prompt_snapshot(raw: dict | None) -> PromptSnapshot | None:
    """Parse a prompt_snapshot JSONB value into a normalized structure.

    Returns None if raw is empty/None.
    """
    if not raw:
        return None

    version = raw.get("schema_version", 1)

    if version >= 2:
        segments = raw.get("segments", {})
        return PromptSnapshot(
            schema_version=version,
            system=segments.get("system", ""),
            dynamic=segments.get("dynamic", ""),
        )

    # v1: flat keys
    return PromptSnapshot(
        schema_version=1,
        system=raw.get("system", ""),
        dynamic=raw.get("dynamic", ""),
    )
