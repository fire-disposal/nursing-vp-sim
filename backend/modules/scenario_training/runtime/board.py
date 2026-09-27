"""线索板（白板）：**按需具现的只读事实区**。

推理游戏式的"白板"：一块固定区域，学生**不能直接编辑**；条目随事实被确立而出现——
来源两类：(a) 平台从交互推导（已揭示线索、读数、注意到的、已处置的动作）；
(b) DM 写入（`facts_declared` 与 `notes`，可含 `supersedes` 订正）。

**白板必须简洁**（裁定 2026-09-27）：只放有价值的信息、分条显示、不赘述——
每条单行限长、去重、重复动作合并计数、自由发问不进板、每版块有条数上限。
"""

from __future__ import annotations

from typing import Any

from ..schema import BoardSection, ScenarioPack
from .devices import device_refs
from .world import World

LINE_LIMIT = 48  # 单条上限（超出截断，不换行）
MAX_ENTRIES = 20  # 每版块上限


def _clean(text: Any, limit: int = LINE_LIMIT) -> str:
    """压成单行、去空白、限长——白板条目不是段落。"""
    collapsed = " ".join(str(text or "").split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip("，,。；;、 ") + "…"


def _dedupe(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for entry in entries:
        key = entry["text"]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(entry)
    return out


def _cue_entries(pack: ScenarioPack, world: World) -> list[dict[str, Any]]:
    return [
        {"id": f"cue:{cue_id}", "kind": "cue", "text": _clean(text, 60), "source": "pack"}
        for cue_id, text in pack.cue_items(world.revealed)
    ]


def _state_entries(section: BoardSection, world: World, skip: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ref in section.refs:
        if ref in skip or ref not in world.state:
            continue  # 监护仪已展示的读数，白板让位（同一读数不出现两次）
        out.append(
            {
                "id": f"state:{ref}",
                "kind": "state",
                "text": _clean(f"{section.label_for(ref)} {world.state[ref]}"),
                "value": world.state[ref],
                "source": "world",
            }
        )
    return out


def _noticed_entries(world: World) -> list[dict[str, Any]]:
    return [
        {"id": f"noticed:{index}", "kind": "noticed", "text": _clean(text, 40), "source": "dm"}
        for index, text in enumerate(world.ad_hoc_cues)
    ]


def _fact_entries(world: World) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for index, fact in enumerate(world.declared_facts):
        text = _clean(fact.get("fact"), 40)
        if not text:
            continue
        out.append(
            {
                "id": f"fact:{fact.get('fact_id') or index}",
                "kind": "fact",
                "text": text,
                "evidence": _clean(fact.get("evidence"), 60),
                "source": "dm",
            }
        )
    return out


def _action_entries(pack: ScenarioPack, world: World) -> list[dict[str, Any]]:
    """已处置：只收**声明过的动作**，同名重复合并计数（「某动作 ×3」比三条一样的有用）。"""
    grouped: dict[str, dict[str, Any]] = {}
    for action in world.actions:
        if not action.affordance_id:
            continue  # 自由发问属于对话，不进白板
        label = action.label(pack)
        entry = grouped.setdefault(
            label,
            {"id": f"action:{action.affordance_id}", "kind": "action", "text": label, "count": 0, "turn": action.turn},
        )
        entry["count"] += 1
    for entry in grouped.values():
        if entry["count"] > 1:
            entry["text"] = f"{entry['text']} ×{entry['count']}"
    return list(grouped.values())


def _note_entries(world: World) -> tuple[list[dict[str, Any]], set[str]]:
    entries: list[dict[str, Any]] = []
    superseded: set[str] = set()
    for index, note in enumerate(world.notes):
        text = _clean(note.get("text"), 40)
        if not text:
            continue
        target = note.get("supersedes")
        if target:
            superseded.add(str(target))
        entries.append(
            {
                "id": str(note.get("id") or f"note:{index}"),
                "kind": "note",
                "text": text,
                "turn": note.get("turn"),
                "supersedes": target,
                "source": "dm",
            }
        )
    return entries, superseded


def build_board(pack: ScenarioPack, world: World) -> dict[str, Any]:
    """投影出线索板：版块 → 条目（稳定 id、单行、去重、限量）。"""
    from .world import trigger_holds

    note_entries, superseded = _note_entries(world)
    on_device = device_refs(pack)  # 读数优先由设备展示，白板让位
    sections: list[dict[str, Any]] = []
    for section in pack.presentation.board:
        if section.visible_when is not None and not trigger_holds(pack, world, section.visible_when):
            continue  # 版块也按需求出现（例如"读数"要等学生真去测过）；不写门控 = 一直在
        if section.source == "cue":
            entries = _cue_entries(pack, world)
        elif section.source == "state":
            entries = _state_entries(section, world, on_device)
        elif section.source == "noticed":
            entries = _noticed_entries(world)
        elif section.source == "fact":
            entries = _fact_entries(world)
        elif section.source == "action":
            entries = _action_entries(pack, world)
        else:  # note
            entries = note_entries
        entries = _dedupe(entries)
        for entry in entries:
            if entry["id"] in superseded:
                entry["superseded"] = True
        more = max(0, len(entries) - MAX_ENTRIES)
        sections.append(
            {
                "id": section.id,
                "title": section.title,
                "source": str(section.source),
                "entries": entries[:MAX_ENTRIES],
                "more": more,
            }
        )
    return {
        "sections": sections,
        "entry_count": sum(len(section["entries"]) for section in sections),
        "editable": False,  # 只读投影：学生只能通过"做事情"让它长出来
    }
