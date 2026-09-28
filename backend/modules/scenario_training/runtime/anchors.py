"""情境训练 · 叙事锚点：DM 的「任务列表」（docs/21 §4.0）。

锚点**不是真源**：每个锚点的状态都是 **(pack 声明 × 事件流)** 的函数——与判读、经历页、
教师回放共用同一份事实（只用 `runtime/world.py` 的既有读取：事实已采集、动作已使用、回合数）。

四件事：
1. `compute_anchors(pack, events)`：**本回合**的状态重算（唯一 `active` 的规范化、超期与催办）；
2. `anchor_turns(pack, events)`：**逐回合**的状态全景（教师/管理回放面板读它）——同一份重算的逐前缀结果；
3. `NUDGE_BUDGET` / `NUDGE_LINES`：超期催办的**升级阶梯**（有预算、不重复同一句）；
4. `AnchorReport` / `AnchorTurn`：注入与回放要用的**结构化**数据（文本拼装留在 `dm/prompt.py`）。

状态语义（§4.0）：
- `satisfied`：`requires` 全部已达成**且** `blocked_by` 无缺失——两项判据都只增，故只增不改；
- `blocked(reason)`：`blocked_by` 里还有没发生的一步（原因 = 那一步的 id）——世界要诚实抵抗；
- `active`：规范化后**唯一**在推进的锚点（按声明序保留第一个可推进者）；`blocked` 不参与自动提升；
- `pending`：其余（尚未轮到）；
- `abandoned`：本批无产生路径（DM 信封只提 satisfied/blocked；退役属于教师侧，尚未实现）。
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from ..schema import NarrativeAnchor, ScenarioPack
from .world import World, facts_observed, fold_event, initial_world

NUDGE_BUDGET = 3
"""催办预算：同一个锚点最多催办这么多次（阶梯用尽即静默，不重复同一句）。"""

NUDGE_LINES: tuple[str, ...] = (
    "催办①：这个锚点还没推进——给它一次自然发生的机会（不要替学生完成前置）。",
    "催办②：已超期。这一回合必须让世界朝它的目标动一步。",
    "催办③：严重超期。学生若仍不动，由处境（不再是旁白）把它顶到台前。",
)


class AnchorStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    SATISFIED = "satisfied"
    BLOCKED = "blocked"
    ABANDONED = "abandoned"


@dataclass(frozen=True)
class AnchorState:
    """一个锚点在**本回合**的状态与原因（注入与回放读它，不读散文）。"""

    id: str
    stage: str
    goal: str
    cue: str
    status: AnchorStatus
    reason: str = ""  # blocked：缺失的那一步（id）
    satisfied_requires: tuple[str, ...] = ()
    missing_requires: tuple[str, ...] = ()
    unlocks: tuple[str, ...] = ()
    active_since: int | None = None  # 首次成为 active 的回合（从事件流推导）
    overdue: int = 0  # 超期回合数（0 = 未超期）
    nudge: str = ""  # 本回合该注入的催办（空 = 不注入：未超期或预算已用尽）


@dataclass(frozen=True)
class AnchorReport:
    """本回合的锚点全景：状态 + 上一回合被拒提案的纠偏提醒。"""

    states: tuple[AnchorState, ...] = ()
    reminders: tuple[str, ...] = ()

    @property
    def active(self) -> AnchorState | None:
        """此刻**唯一**在推进的锚点（无锚点/无可推进者时为 None）。"""
        return next((state for state in self.states if state.status is AnchorStatus.ACTIVE), None)

    def of(self, status: AnchorStatus) -> tuple[AnchorState, ...]:
        return tuple(state for state in self.states if state.status is status)


def _observed_ids(pack: ScenarioPack, world: World) -> set[str]:
    """已登记的观察：事实已采集（线索已揭示或动作已用过）+ 动作已使用。"""
    observed = set(facts_observed(pack, world))
    observed.update(action.affordance_id for action in world.actions if action.affordance_id)
    return observed


def _candidate(
    anchor: NarrativeAnchor, observed: set[str]
) -> tuple[AnchorStatus, str, tuple[str, ...], tuple[str, ...]]:
    """单个锚点的**候选**状态（与声明序无关）：(状态, 原因, 已满足前置, 未满足前置)。"""
    satisfied = tuple(ref for ref in anchor.requires if ref in observed)
    missing_requires = tuple(ref for ref in anchor.requires if ref not in observed)
    missing_blockers = tuple(ref for ref in anchor.blocked_by if ref not in observed)
    if not missing_requires and not missing_blockers:
        return AnchorStatus.SATISFIED, "", satisfied, ()
    if missing_blockers:
        return AnchorStatus.BLOCKED, missing_blockers[0], satisfied, missing_requires
    return AnchorStatus.PENDING, "", satisfied, missing_requires


def _normalize(
    pack: ScenarioPack, observed: set[str]
) -> list[tuple[NarrativeAnchor, AnchorStatus, str, tuple[str, ...], tuple[str, ...]]]:
    """规范化：同时最多一个 `active`（按声明序保留第一个可推进者，其余退回 `pending`）。"""
    promoted = False
    rows: list[tuple[NarrativeAnchor, AnchorStatus, str, tuple[str, ...], tuple[str, ...]]] = []
    for anchor in pack.anchors:
        status, reason, satisfied, missing = _candidate(anchor, observed)
        if status is AnchorStatus.PENDING and not promoted:
            status, promoted = AnchorStatus.ACTIVE, True
        rows.append((anchor, status, reason, satisfied, missing))
    return rows


def _note_active(pack: ScenarioPack, world: World, since: dict[str, int]) -> None:
    """记下「此刻已是 `active` 的锚点首次成为 active 的回合」（`since` 只增不改）。"""
    for anchor, status, *_rest in _normalize(pack, _observed_ids(pack, world)):
        if status is AnchorStatus.ACTIVE:
            since.setdefault(anchor.id, world.turn)


def _states(pack: ScenarioPack, world: World, since: dict[str, int]) -> list[AnchorState]:
    """给定**世界**与 `since` 表 → 每个锚点此刻的状态（状态重算的**唯一**出口）。

    `compute_anchors` 与 `anchor_turns` 都走这里：两者只差"取哪个前缀"，判据一份。
    """
    observed = _observed_ids(pack, world)
    states: list[AnchorState] = []
    for anchor, status, reason, satisfied, missing in _normalize(pack, observed):
        overdue = 0
        nudge = ""
        if status is AnchorStatus.ACTIVE:
            active_since = since.get(anchor.id, world.turn)
            overdue = max(world.turn - active_since - anchor.deadline_turns, 0)
            if 1 <= overdue <= NUDGE_BUDGET:
                nudge = NUDGE_LINES[overdue - 1]
        states.append(
            AnchorState(
                id=anchor.id,
                stage=anchor.stage,
                goal=anchor.goal,
                cue=anchor.cue,
                status=status,
                reason=reason,
                satisfied_requires=satisfied,
                missing_requires=missing,
                unlocks=tuple(anchor.unlocks),
                active_since=since.get(anchor.id),
                overdue=overdue,
                nudge=nudge,
            )
        )
    return states


def _replay(pack: ScenarioPack, events: Iterable[dict[str, Any]]) -> tuple[World, dict[str, int]]:
    """逐回合**前缀重放**：给出终局世界与「某锚点首次成为 active 的回合」。

    不落盘、不新增真源：只用事件流 + 声明（`fold_event` 与回放共用同一份折法）。
    """
    world = initial_world(pack)
    since: dict[str, int] = {}
    _note_active(pack, world, since)  # 开场（第 0 回合）
    for event in events:
        fold_event(world, event)
        _note_active(pack, world, since)
    return world, since


def _reminders(events: Iterable[dict[str, Any]], turn: int) -> tuple[str, ...]:
    """**上一回合**被拒的提案 → 本回合的纠偏提醒（`todo` 的「整条丢弃 + 隐藏提醒」口径）。"""
    out: list[str] = []
    for event in events:
        if str(event.get("kind")) != "anchor_proposal_rejected":
            continue
        payload = event.get("payload") or {}
        if payload.get("turn") != turn - 1:
            continue
        actual = str(payload.get("actual", ""))
        label = "这个锚点未声明" if actual == "undeclared" else f"引擎的重算结果是 {actual}"
        out.append(
            f"纠偏：上一回合你提议「{payload.get('proposal', '?')}」的锚点 {payload.get('anchor_id', '?')} "
            f"与重算不一致（{label}），该提议已作废；不要替学生完成尚未满足的前置。"
        )
    return tuple(out)


def compute_anchors(pack: ScenarioPack, events: list[dict[str, Any]]) -> AnchorReport:
    """**本回合**的锚点全景（确定性：只读事件流与声明）。**不声明 anchors 的 pack → 空报告**。"""
    if not pack.anchors:
        return AnchorReport()
    world, since = _replay(pack, events)
    return AnchorReport(states=tuple(_states(pack, world, since)), reminders=_reminders(events, world.turn))


@dataclass(frozen=True)
class AnchorTurn:
    """**一个回合结束时**的锚点全景（教师/管理回放面板逐回合读它）。"""

    turn: int
    states: tuple[AnchorState, ...] = ()
    """本回合末尾每个锚点的状态（含该回合引擎给出的催办 `AnchorState.nudge`）。"""
    rejected: tuple[dict[str, Any], ...] = ()
    """本回合被拒的提案（`anchor_proposal_rejected` 的载荷，原样）。"""


def anchor_turns(pack: ScenarioPack, events: list[dict[str, Any]]) -> tuple[AnchorTurn, ...]:
    """**逐回合**的锚点全景：`turn 0`（开场）到当前回合，每回合末尾一份快照。

    与 `compute_anchors` 同一份重算、同一份 `fold_event` 折法，只差"取哪个前缀"：
    这里在每个回合边界（第一条属于下一回合的事件之前）留一份 `_states`。
    提案裁决（`_record_anchor_proposals`）读的正是"本回合末尾"的那个前缀，所以面板上的
    状态与它当时据以采纳/拒绝的状态是同一个——不是另一套判据。

    催办是**推导**出来的（`AnchorState.nudge` 由 `overdue = 回合 - active_since - deadline` 给出），
    引擎注入时用的也是这条式子、同一个回合号；所以本回合末尾的 `nudge` 非空 = 本回合发过催办。

    **不声明 anchors 的 pack → 空元组**（回放界面据此不渲染面板）。
    """
    if not pack.anchors:
        return ()
    world = initial_world(pack)
    since: dict[str, int] = {}
    turns: list[AnchorTurn] = []
    rejected: list[dict[str, Any]] = []
    current = world.turn

    def snapshot() -> None:
        turns.append(AnchorTurn(turn=current, states=tuple(_states(pack, world, since)), rejected=tuple(rejected)))

    _note_active(pack, world, since)  # 开场（第 0 回合）
    for event in events:
        payload = event.get("payload") or {}
        turn = payload.get("turn")
        if turn is not None and int(turn) > current:
            snapshot()  # 上一回合到此为止（此刻世界还没折入新回合的第一条事件）
            current = int(turn)
            rejected.clear()
        if str(event.get("kind")) == "anchor_proposal_rejected":
            rejected.append(dict(payload))
        fold_event(world, event)
        _note_active(pack, world, since)
    snapshot()
    return tuple(turns)
