"""线索板（只读、按需具现的事实区）：**平台从世界推导**，作者不声明版块。

三个版块固定：现场看到的（已揭示线索）、已确认的（已采集事实 + 证据）、已处置（用过的声明动作）。
**读数不在这里**：数值只由设备面板展示（"读数归设备面板"），所以没有 `state` 来源、也没有
"同一读数出现两次"的问题。

每条带 `turn`（最近更新回合，供"点回去看来源"）；单行限长、去重、限量。
"""

from __future__ import annotations

from ..api_models import ScenarioBoard, ScenarioBoardEntry, ScenarioBoardSection
from ..schema import ScenarioPack
from .world import World, facts_observed

LINE_LIMIT = 48  # 单条上限（超出截断，不换行）
MAX_ENTRIES = 20  # 每版块上限

SCENE_TITLE = "现场看到的"
FACT_TITLE = "已确认的"
ACTION_TITLE = "已处置"


def _clean(text: object, limit: int = LINE_LIMIT) -> str:
    collapsed = " ".join(str(text or "").split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip("，,。；;、 ") + "…"


def _cue_entries(pack: ScenarioPack, world: World) -> list[ScenarioBoardEntry]:
    return [
        ScenarioBoardEntry(
            id=f"cue:{cue_id}",
            kind="cue",
            text=_clean(text, 60),
            source="pack",
            ref=f"cue:{cue_id}",
            turn=world.revealed_turns.get(cue_id, 0),
        )
        for cue_id, text in pack.cue_items(world.revealed)
    ]


def _fact_entries(pack: ScenarioPack, world: World) -> list[ScenarioBoardEntry]:
    """已确认的事实：**证据先于结论**——判据是线索已揭示或动作已用过（`facts_observed`）。

    文本取作者写在 `FactSpec.intent` 里的那句话；它只在这条事实的观察条件成立后才出现，
    因此白板上的「已确认」始终有对应证据（`evidence` 列出那些线索/动作）。
    """
    observed = facts_observed(pack, world)
    out: list[ScenarioBoardEntry] = []
    for fact in pack.facts:
        if fact.id not in observed:
            continue
        cues = pack.cue_items([cue_id for cue_id in fact.cue_ids if cue_id in world.revealed])
        acts = [aff.label for item in fact.affordance_ids if (aff := pack.affordance(item))]
        turns = [world.revealed_turns.get(cue_id, 0) for cue_id in fact.cue_ids if cue_id in world.revealed]
        turns += [action.turn for action in world.actions if action.affordance_id in fact.affordance_ids]
        evidence = "、".join([text for _, text in cues] + acts)
        out.append(
            ScenarioBoardEntry(
                id=f"fact:{fact.id}",
                kind="fact",
                text=_clean(fact.intent, 40),
                source="pack",
                evidence=_clean(evidence, 60),
                turn=max(turns) if turns else None,
            )
        )
    return out


def _action_entries(pack: ScenarioPack, world: World) -> list[ScenarioBoardEntry]:
    """已处置：只收**声明过的动作**，同名重复合并计数（「某动作 ×3」比三条一样的有用）。"""
    grouped: dict[str, ScenarioBoardEntry] = {}
    counts: dict[str, int] = {}
    for action in world.actions:
        if not action.affordance_id:
            continue  # 自由表达属于对话，不进白板
        label = action.label(pack)
        counts[label] = counts.get(label, 0) + 1
        entry = grouped.get(label)
        if entry is None:
            grouped[label] = ScenarioBoardEntry(
                id=f"action:{action.affordance_id}",
                kind="action",
                text=label,
                source="world",
                ref=f"action:{action.affordance_id}",
                count=1,
                turn=action.turn,
            )
        else:
            entry.turn = max(entry.turn or 0, action.turn)
    for label, entry in grouped.items():
        if counts[label] > 1:
            entry.text = f"{entry.text} ×{counts[label]}"
    return list(grouped.values())


def _dedupe(entries: list[ScenarioBoardEntry]) -> list[ScenarioBoardEntry]:
    seen: set[str] = set()
    out: list[ScenarioBoardEntry] = []
    for entry in entries:
        if not entry.text or entry.text in seen:
            continue
        seen.add(entry.text)
        out.append(entry)
    return out


def build_board(pack: ScenarioPack, world: World) -> ScenarioBoard:
    """投影出线索板：三个固定版块 → 条目（稳定 id、单行、去重、限量）。空的版块不渲染。"""
    sections: list[ScenarioBoardSection] = []
    for section_id, title, source, entries in (
        ("board_scene", SCENE_TITLE, "cue", _cue_entries(pack, world)),
        ("board_confirmed", FACT_TITLE, "fact", _fact_entries(pack, world)),
        ("board_done", ACTION_TITLE, "action", _action_entries(pack, world)),
    ):
        cleaned = _dedupe(entries)
        if not cleaned:
            continue  # 还没有内容就不占位
        sections.append(
            ScenarioBoardSection(
                id=section_id,
                title=title,
                source=source,
                entries=cleaned[:MAX_ENTRIES],
                more=max(0, len(cleaned) - MAX_ENTRIES),
            )
        )
    return ScenarioBoard(
        sections=sections,
        entry_count=sum(len(section.entries) for section in sections),
        editable=False,
    )
