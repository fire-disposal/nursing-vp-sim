"""线索板（白板）：**只读、按需具现**的事实区。

来源只有两类（docs/23 §5.2：**DM 不再写白板**）：
- `pack`：作者写好的内容（已揭示线索的文本；已采集事实的意图文本）；
- `world`：平台从事件流推导（读数、已处置动作、已可见的现场细节）。

每条带 `turn`（最近更新回合，供"点回去看来源"）；单行限长、去重、限量。
"""

from __future__ import annotations

from ..api_models import ScenarioBoard, ScenarioBoardEntry, ScenarioBoardSection
from ..schema import BoardSection, ScenarioPack
from .devices import device_refs
from .world import World, facts_observed, trigger_holds

LINE_LIMIT = 48  # 单条上限（超出截断，不换行）
MAX_ENTRIES = 20  # 每版块上限


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


def _state_entries(section: BoardSection, world: World, skip: set[str]) -> list[ScenarioBoardEntry]:
    out: list[ScenarioBoardEntry] = []
    for ref in section.refs:
        if ref in skip or ref not in world.state:
            continue  # 监护仪已展示的读数，白板让位（同一读数不出现两次）
        turns = world.state_turns.get(ref, [])
        out.append(
            ScenarioBoardEntry(
                id=f"state:{ref}",
                kind="state",
                text=_clean(f"{section.label_for(ref)} {world.state[ref]}"),
                source="world",
                ref=f"effect:{ref}",
                value=world.state[ref],
                turn=turns[-1] if turns else None,
            )
        )
    return out


def _noticed_entries(world: World) -> list[ScenarioBoardEntry]:
    return [
        ScenarioBoardEntry(
            id=f"noticed:{index}",
            kind="noticed",
            text=_clean(text, 40),
            source="world",
            ref="",
            turn=world.noticed_turns.get(text),
        )
        for index, text in enumerate(world.ad_hoc_cues)
    ]


def _fact_entries(pack: ScenarioPack, world: World) -> list[ScenarioBoardEntry]:
    """已确认的事实：**证据先于结论**——判据是线索已揭示或动作已用过（`facts_observed`）。

    文本取作者写在 `FactSpec.intent` 里的那句话；它只在这条事实的观察条件成立后才出现，
    因此白板上的「已确认」始终有对应证据（`evidence` 列出那些线索/动作）。
    旧事件流里 DM 声明过的事实（`declared_facts`）原样保留在板上——历史不重解释。
    """
    observed = facts_observed(pack, world)
    out: list[ScenarioBoardEntry] = []
    seen: set[str] = set()
    for index, fact in enumerate(world.declared_facts):
        fact_id = str(fact.get("fact_id") or "")
        text = _clean(fact.get("fact"), 40)
        if not text:
            continue
        seen.add(fact_id)
        out.append(
            ScenarioBoardEntry(
                id=f"fact:{fact_id or index}",
                kind="fact",
                text=text,
                source="pack",
                evidence=_clean(fact.get("evidence"), 60),
            )
        )
    for fact in pack.facts:
        if fact.id not in observed or fact.id in seen:
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
    """投影出线索板：版块 → 条目（稳定 id、单行、去重、限量）。"""
    on_device = device_refs(pack)  # 读数优先由设备展示，白板让位
    sections: list[ScenarioBoardSection] = []
    for section in pack.presentation.board:
        if section.visible_when is not None and not trigger_holds(pack, world, section.visible_when):
            continue  # 版块也按需求出现；不写门控 = 一直在
        if section.source == "cue":
            entries = _cue_entries(pack, world)
        elif section.source == "state":
            entries = _state_entries(section, world, on_device)
        elif section.source == "noticed":
            entries = _noticed_entries(world)
        elif section.source == "fact":
            entries = _fact_entries(pack, world)
        else:
            entries = _action_entries(pack, world)
        entries = _dedupe(entries)
        if section.source == "noticed" and not entries:
            # 新机制里 DM 不再登记"即兴细节"（docs/23 §5.2）：这个版块在新会话里没有生产者，
            # 不渲染一个永远空着的版块（旧会话折入的历史条目照常显示）。
            continue
        sections.append(
            ScenarioBoardSection(
                id=section.id,
                title=section.title,
                source=section.source,
                entries=entries[:MAX_ENTRIES],
                more=max(0, len(entries) - MAX_ENTRIES),
            )
        )
    return ScenarioBoard(
        sections=sections,
        entry_count=sum(len(section.entries) for section in sections),
        editable=False,
    )
