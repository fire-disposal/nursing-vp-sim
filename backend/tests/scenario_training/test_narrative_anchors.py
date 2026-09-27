"""叙事锚点（docs/21 §4.0）：状态重算 / 注入（防泄露·催办）/ 提案裁决 / 向后兼容。

守的是**可观察的机制**，不是"输出像不像"：
- 规范化后同时最多一个 `active`；无可满足项时允许全体 blocked；
- `satisfied` 由**已登记的观察**（事实已采集 / 动作已用过）推出，且只增不改；
- `pending` 锚点的 `cue` 一个字都不进提示词（直接断言注入串不含它），`active` 的必须写全；
- 催办按 `deadline_turns` 起算、有预算、不重复同一句，并附"学生尚未做的前置"；
- DM 的锚点提案只采纳与重算一致者：不一致 → 拒绝 + 落事件 + 下回合纠偏；
- 不声明 anchors 的 pack：DM 的 user 段提示词**逐字节不变**（同一夹具的字符面量，见文件末）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from modules.scenario_training.dm.prompt import build_dm_messages
from modules.scenario_training.runtime.anchors import NUDGE_BUDGET, AnchorStatus, compute_anchors
from modules.scenario_training.runtime.session import StudentAction, load_events, open_session, submit_action
from modules.scenario_training.runtime.world import ActionRecord, initial_world, world_from_events
from modules.scenario_training.schema import ScenarioPack
from modules.scenario_training.validation import validate_pack

PACK_KEY = "sputum-ineffective"


@pytest.fixture(scope="module")
def pack() -> ScenarioPack:
    from modules.scenario_training.pack_loader import load_pack_file

    return load_pack_file(PACK_KEY)


def _with_anchors(pack: ScenarioPack, anchors: list[dict[str, Any]]) -> ScenarioPack:
    """在**真包**上换一组锚点声明：判据语言（requires/blocked_by/unlocks）始终来自真包的事实与动作。"""
    return ScenarioPack.model_validate({**pack.model_dump(mode="python"), "anchors": anchors})


def _anchor(anchor_id: str, **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": anchor_id,
        "stage": "s",
        "goal": f"目标 {anchor_id}",
        "cue": f"信号 {anchor_id}",
        "requires": [],
        "unlocks": [],
        "blocked_by": [],
        "deadline_turns": 1,
    }
    return {**base, **extra}


def _action(turn: int, affordance_id: str) -> dict[str, Any]:
    """一条学生动作事件（与 `session.append_event` 同形）。"""
    action = {"turn": turn, "affordance_id": affordance_id, "type": "act"}
    return {"kind": "student_action", "payload": {"turn": turn, "action": action}}


def _states(pack: ScenarioPack, events: list[dict[str, Any]]) -> dict[str, Any]:
    return {state.id: state for state in compute_anchors(pack, events).states}


def _user_prompt(pack: ScenarioPack, events: list[dict[str, Any]], **kwargs: Any) -> str:
    world = world_from_events(pack, events) if events else initial_world(pack)
    report = compute_anchors(pack, events)
    return build_dm_messages(pack, world, None, [], anchors=report, **kwargs)[1]["content"]


# --------------------------------------------------------------------------- #
# 1) 规范化：同时最多一个 active；无可满足项时允许全体 blocked
# --------------------------------------------------------------------------- #


def test_two_satisfiable_anchors_normalize_to_one_active(pack: ScenarioPack) -> None:
    two = _with_anchors(
        pack,
        [
            _anchor("x_first", requires=["measure_spo2"]),
            _anchor("x_second", requires=["auscultate"]),
        ],
    )
    report = compute_anchors(two, [])
    states = {state.id: state for state in report.states}
    assert states["x_first"].status is AnchorStatus.ACTIVE
    assert states["x_second"].status is AnchorStatus.PENDING
    assert report.active is not None
    assert report.active.id == "x_first"
    assert sum(1 for state in report.states if state.status is AnchorStatus.ACTIVE) == 1


def test_all_blocked_stays_blocked_and_has_no_active(pack: ScenarioPack) -> None:
    two = _with_anchors(
        pack,
        [
            _anchor("b_one", blocked_by=["bag_valve"]),
            _anchor("b_two", blocked_by=["call_doctor"]),
        ],
    )
    report = compute_anchors(two, [])
    assert report.active is None
    assert [state.status for state in report.states] == [AnchorStatus.BLOCKED, AnchorStatus.BLOCKED]
    assert [state.reason for state in report.states] == ["bag_valve", "call_doctor"]
    assert report.of(AnchorStatus.PENDING) == ()


def test_blocked_clears_once_the_missing_step_happens(pack: ScenarioPack) -> None:
    """`blocked_by` 的世界抵抗是**诚实**的：缺的那一步做了，它就不再卡住（但仍不抢 active）。"""
    two = _with_anchors(
        pack,
        [
            _anchor("b_one", requires=["measure_spo2"], blocked_by=["bag_valve"]),
            _anchor("n_two", requires=["auscultate"]),
        ],
    )
    assert _states(two, [])["b_one"].status is AnchorStatus.BLOCKED
    states = _states(two, [_action(1, "bag_valve")])
    assert states["b_one"].status is AnchorStatus.ACTIVE  # 解除阻塞后按声明序成为唯一 active
    assert states["n_two"].status is AnchorStatus.PENDING


# --------------------------------------------------------------------------- #
# 2) 达成与只增不改
# --------------------------------------------------------------------------- #


def test_requires_met_becomes_satisfied_and_never_regresses(pack: ScenarioPack) -> None:
    two = _with_anchors(
        pack,
        [
            _anchor("a_fact", requires=["f_left_absent"]),  # 事实键：靠"已揭示线索"或"用过的动作"采集到
            _anchor("a_next", requires=["document"]),
        ],
    )
    assert _states(two, [])["a_fact"].status is AnchorStatus.ACTIVE

    met = [_action(1, "auscultate")]
    states = _states(two, met)
    assert states["a_fact"].status is AnchorStatus.SATISFIED
    assert states["a_fact"].missing_requires == ()
    assert states["a_next"].status is AnchorStatus.ACTIVE  # 推进权交给下一个

    later = [*met, _action(2, "increase_o2"), _action(3, "suction"), _action(4, "reposition")]
    after = _states(two, later)
    assert after["a_fact"].status is AnchorStatus.SATISFIED  # 只增不改
    assert after["a_fact"].overdue == 0  # 已达成的不再被催办
    assert after["a_fact"].nudge == ""


# --------------------------------------------------------------------------- #
# 3) 防泄露：pending / blocked 的 cue 不进提示词
# --------------------------------------------------------------------------- #


def test_only_the_active_anchor_cue_reaches_the_prompt(pack: ScenarioPack) -> None:
    report = compute_anchors(pack, [])
    user = _user_prompt(pack, [], opening=True, max_steps=3)
    assert "# 锚点" in user

    active = report.active
    assert active is not None
    assert active.cue in user
    leaked = [state.id for state in report.states if state.cue in user]
    assert leaked == [active.id], f"只有 active 的 cue 允许出现，实际：{leaked}"

    for state in report.of(AnchorStatus.PENDING) + report.of(AnchorStatus.BLOCKED):
        assert state.cue not in user
    # 禁令是明确的（列 id、不列线索原文）
    assert "不得提前抖出" in user
    assert "a_control_airway" in user  # 仍 pending 的那个：只以 id 出现在禁令里


def test_pack_without_anchors_has_no_anchor_section(pack: ScenarioPack) -> None:
    bare = pack.model_copy(update={"anchors": []})
    user = _user_prompt(bare, [], opening=True, max_steps=3)
    assert "# 锚点" not in user
    assert compute_anchors(bare, []).states == ()


# --------------------------------------------------------------------------- #
# 4) 催办：超期起算、有预算、不重复同一句，并附尚未做的前置
# --------------------------------------------------------------------------- #


def test_nudge_starts_after_the_deadline_and_stops_at_budget(pack: ScenarioPack) -> None:
    pack_urgent = _with_anchors(pack, [_anchor("a_urgent", requires=["bag_valve"], deadline_turns=1)])
    seen: list[str] = []
    for turn in range(9):
        events = [_action(t, "increase_o2") for t in range(1, turn + 1)]
        state = _states(pack_urgent, events)["a_urgent"]
        assert state.status is AnchorStatus.ACTIVE
        assert state.active_since == 0
        seen.append(state.nudge)

    assert seen[0] == ""
    assert seen[1] == "", "没有超过 deadline_turns 的回合不催办"
    assert all(seen[2:5]), f"第 2 回合起应当催办：{seen}"
    assert len(set(seen[2:5])) == 3, "同一句话不得重复"
    assert seen[5:] == ["", "", "", ""], "预算用尽后静默"
    assert sum(1 for line in seen if line) == NUDGE_BUDGET

    events = [_action(1, "increase_o2"), _action(2, "suction")]  # 第 2 回合：overdue = 1
    world = world_from_events(pack_urgent, events)
    user = build_dm_messages(
        pack_urgent,
        world,
        ActionRecord(turn=2, affordance_id="suction", type="act"),
        [],
        anchors=compute_anchors(pack_urgent, events),
    )[1]["content"]
    assert "催办①" in user
    assert "前置未满足（**不得**替学生完成）：bag_valve" in user


# --------------------------------------------------------------------------- #
# 5) 提案裁决：只采纳与重算一致者（拒绝 → 事件 → 下回合纠偏）
# --------------------------------------------------------------------------- #


class _ScriptedLLM:
    """按顺序回放预置输出；记录每次调用收到的消息（供断言"下回合的提示词里有什么"）。"""

    def __init__(self, outputs: list[str]) -> None:
        self.outputs = list(outputs)
        self.calls: list[list[dict[str, str]]] = []

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        self.calls.append([dict(message) for message in messages])
        return self.outputs.pop(0)


def _envelope(**extra: Any) -> str:
    return json.dumps({"narration": "监护仪还在响。", **extra}, ensure_ascii=False)


def _kinds(events: list[dict[str, Any]]) -> list[str]:
    return [str(event["kind"]) for event in events]


def test_inconsistent_proposal_is_rejected_and_corrected_next_turn(pg_session, pack: ScenarioPack) -> None:
    session = open_session(pg_session, user_id=1, revision_id=1, pack=pack)
    llm = _ScriptedLLM([_envelope(anchor_satisfied="a_control_airway"), _envelope()])

    first = asyncio.run(
        submit_action(
            pg_session,
            session=session,
            pack=pack,
            action=StudentAction(type="ask", text="……"),
            llm=llm,
            user_id=1,
        )
    )

    events = load_events(pg_session, session.id)
    assert "anchor_satisfied" not in _kinds(events), "与重算不一致的提案不得被采纳"
    rejected = [event for event in events if event["kind"] == "anchor_proposal_rejected"]
    assert rejected == [
        {
            "kind": "anchor_proposal_rejected",
            "payload": {
                "turn": 1,
                "anchor_id": "a_control_airway",
                "proposal": "anchor_satisfied",
                "actual": "pending",
            },
        }
    ]
    assert any(
        problem.startswith("anchor_proposal_rejected:anchor_satisfied:a_control_airway") for problem in first.problems
    )
    # 学生面不变：`problems` 是维护侧诊断串（前端只认 `dm_fallback*`，其余不进界面），
    # 除它之外视图里没有锚点 id、也没有任何锚点的线索文本——学生只看到世界。
    visible = json.dumps(
        {key: value for key, value in first.view.items() if key != "problems"}, ensure_ascii=False, default=str
    )
    assert "a_control_airway" not in visible
    assert all(state.cue not in visible for state in compute_anchors(pack, []).states)

    # 下回合：提示词里带纠偏（只在 DM 的 user 段）
    asyncio.run(
        submit_action(
            pg_session,
            session=session,
            pack=pack,
            action=StudentAction(type="ask", text="继续"),
            llm=llm,
            user_id=1,
        )
    )
    assert len(llm.calls) == 2
    next_user = llm.calls[1][1]["content"]
    assert "纠偏" in next_user
    assert "a_control_airway" in next_user
    # 只纠偏一次（上一回合的那条）
    assert (
        len([event for event in load_events(pg_session, session.id) if event["kind"] == "anchor_proposal_rejected"])
        == 1
    )


def test_consistent_proposals_are_adopted(pg_session, pack: ScenarioPack) -> None:
    """一致（重算确实达成/确实卡住）→ 采纳并落事件；`anchor_blocked` 带上 DM 给的原因。"""
    session = open_session(pg_session, user_id=1, revision_id=1, pack=pack)
    llm = _ScriptedLLM(
        [
            _envelope(
                anchor_blocked={"id": "a_reassess_after", "reason": "气道还没加压打开"},
            )
        ]
    )
    outcome = asyncio.run(
        submit_action(
            pg_session,
            session=session,
            pack=pack,
            action=StudentAction(affordance_id="measure_spo2", type="measure"),
            llm=llm,
            user_id=1,
        )
    )
    assert outcome.problems == []
    blocked = [event for event in load_events(pg_session, session.id) if event["kind"] == "anchor_blocked"]
    assert blocked == [
        {
            "kind": "anchor_blocked",
            "payload": {"turn": 1, "anchor_id": "a_reassess_after", "reason": "气道还没加压打开"},
        }
    ]

    # 没写 reason：概念上仍一致（重算确实 blocked）→ 采纳，原因记引擎重算出的那个缺失步骤
    session2 = open_session(pg_session, user_id=1, revision_id=1, pack=pack)
    llm2 = _ScriptedLLM([_envelope(anchor_blocked={"id": "a_reassess_after"})])
    asyncio.run(
        submit_action(
            pg_session,
            session=session2,
            pack=pack,
            action=StudentAction(type="ask", text="……"),
            llm=llm2,
            user_id=1,
        )
    )
    assert [event for event in load_events(pg_session, session2.id) if event["kind"] == "anchor_blocked"] == [
        {"kind": "anchor_blocked", "payload": {"turn": 1, "anchor_id": "a_reassess_after", "reason": "bag_valve"}}
    ]


def test_satisfied_proposal_is_adopted_when_the_requires_are_met(pg_session, pack: ScenarioPack) -> None:
    one = _with_anchors(pack, [_anchor("a_ready", requires=["auscultate"])])
    session = open_session(pg_session, user_id=1, revision_id=1, pack=one)
    llm = _ScriptedLLM([_envelope(anchor_satisfied="a_ready")])
    outcome = asyncio.run(
        submit_action(
            pg_session,
            session=session,
            pack=one,
            action=StudentAction(affordance_id="auscultate", type="observe"),
            llm=llm,
            user_id=1,
        )
    )
    assert outcome.problems == []
    satisfied = [event for event in load_events(pg_session, session.id) if event["kind"] == "anchor_satisfied"]
    assert satisfied == [{"kind": "anchor_satisfied", "payload": {"turn": 1, "anchor_id": "a_ready"}}]


# --------------------------------------------------------------------------- #
# 7) 流式路径（router 走的那条）与落地路径共用同一份报告
# --------------------------------------------------------------------------- #


def test_streaming_path_carries_the_anchor_section(pack: ScenarioPack) -> None:
    from modules.scenario_training.dm.runner import iter_dm_stream

    class _StreamLLM:
        def __init__(self) -> None:
            self.calls: list[list[dict[str, str]]] = []

        async def stream(self, messages: list[dict[str, str]], **_: Any):  # type: ignore[no-untyped-def]
            self.calls.append([dict(message) for message in messages])
            yield _envelope()

    async def drain() -> tuple[_StreamLLM, list[dict[str, Any]]]:
        llm = _StreamLLM()
        items = [
            item
            async for item in iter_dm_stream(
                llm,
                pack,
                initial_world(pack),
                None,
                [],
                user_id=1,
                max_steps=0,
                anchors=compute_anchors(pack, []),
            )
        ]
        return llm, items

    llm, items = asyncio.run(drain())
    assert "# 锚点" in llm.calls[0][1]["content"]
    assert items[-1]["kind"] == "turn"


# --------------------------------------------------------------------------- #
# 8) 加载期校验
# --------------------------------------------------------------------------- #


def test_sample_pack_anchors_pass_validation(pack: ScenarioPack) -> None:
    assert validate_pack(pack) == []
    assert [anchor.id for anchor in pack.anchors] == ["a_see_the_plug", "a_control_airway", "a_reassess_after"]


def test_bad_anchor_declarations_are_reported(pack: ScenarioPack) -> None:
    bad = _with_anchors(
        pack,
        [
            _anchor(
                "dup",
                cue="c",
                requires=["not_a_fact"],
                blocked_by=["ghost_aff"],
                unlocks=["not_an_affordance"],
                deadline_turns=-1,
            ),
            _anchor("dup", cue="   "),
        ],
    )
    problems = validate_pack(bad)
    assert any("anchor id 重复：dup" in problem for problem in problems)
    assert any("requires 引用未登记的事实/动作 not_a_fact" in problem for problem in problems)
    assert any("blocked_by 引用未登记的事实/动作 ghost_aff" in problem for problem in problems)
    assert any("unlocks 引用未登记的动作 not_an_affordance" in problem for problem in problems)
    assert any("缺 cue" in problem for problem in problems)
    assert any("deadline_turns 不得为负" in problem for problem in problems)


# --------------------------------------------------------------------------- #
# 6) 向后兼容：不声明 anchors 的 pack，DM 的 user 段提示词逐字节不变
# --------------------------------------------------------------------------- #

_GOLDEN_NO_ANCHOR_PROMPT = """# 环境
情境：吸痰无效：血氧上不来｜学生扮演：夜班护士
地点：呼吸内科病房｜时间线索：凌晨 02:10
处境说明：夜班，患者痰多却吸不出来，血氧一路往下掉。

## 在场者（各自的知识边界）
[patient] 患者（在场方式：on_site；索取注意力的方式：quiet）
  他知道：{'主诉': '……喘不上来……', '既往': '慢阻肺、长期吸烟', '自述': '痰很多，可就是咳不出来'}
  风格：说话断续费力，越急越说不清；情绪一激动就更喘；目的：想喘上气
  他当前状态：{'comfort': 2, 'consciousness': 3, 'airway_patent': False}
[doctor] 值班医生（在场方式：callable；索取注意力的方式：neutral）
  他知道：{'现场': '需要护士先给出可复述的观察与已做处置'}
  风格：干脆，要求具体数据与已采取措施；目的：稳定气道
  他当前状态：（未声明）

## 学生看不到的（真相与尚未揭示的线索，任何在场者都不得直接说出）
- 深部痰栓导致左侧气道堵塞，单纯经口吸痰取不出
- 正确处置是加压给氧＋体位引流＋呼叫医生准备插管，而不是继续吸痰
- 深部痰栓导致单侧堵塞
- 需要加压给氧而非继续吸痰

## 读数（学生看到的设备面）
- 床旁监护仪：血氧 88%（critical）

## 可改状态（effects 只能改这些键）
- scene.spo2 = 88
- scene.o2_flow = 3
- scene.doctor_present = False
- patient.comfort = 2
- patient.consciousness = 3
- patient.airway_patent = False

## 已揭示线索（reveals 只能取这些 id；学生已经看到的）
- c_restless：患者坐起前倾，说话断续，额头发汗。
- c_secretions：床旁吸引器就位，痰液黏稠、量多。

## 可做动作（本回合**已解锁**；options 与 interpretation 只能取这里的 id）
- suction（act）吸痰
- increase_o2（act）调高氧流量
- auscultate（observe）听诊双肺
- measure_spo2（measure）测血氧
- bag_valve（act）球囊面罩加压给氧
- reposition（act）侧卧拍背 / 体位引流
- call_doctor（summon）呼叫值班医生
- document（document）记录处置与病情变化

## 可用图片（需要让学生看见画面时，用 images 引用这里的 asset_id）
- a_room｜夜班病房｜适合：开场时让学生对所处环境有画面感
（本情境不允许现场生成图片：image_request 会被丢弃）

# 工具（只读；本回合最多 3 步，用尽后直接产出信封）
- world.state()　这一刻已登记的状态键与取值、当前回合数
- actor.knowledge(who)　某个在场者该知道什么（知识边界快照；who = 角色 id）
- history.lastN(n)　最近 n 条回合记录（n ≤ 20）
- note.write(text)　写一张只给你自己看的便条（≤200 字；学生看不到，教师回放可见）
（读工具的结果会立刻回给你；`note.write` 是只有你能看见的便条，学生看不到）

# 本回合：开场（第 0 回合）
用 1–2 处感官细节把处境立起来（这里是什么地方、此刻什么在动、什么人是什么状态），
让此刻在场的人按自己的状态开口或保持沉默。学生还没做任何事，等他动手。

# 对话记录
"""


def test_prompt_is_byte_identical_for_a_pack_without_anchors(pack: ScenarioPack) -> None:
    """同一夹具（`PACK_KEY` 的真包）去掉 anchors 后，提示词就是**改动前**那一份。

    锚点功能不得扰动不声明它的病例：新增字段、新 section 都不许留下多余空行或占位。
    这条是字符面量守卫——**改了 user 段正文就要同步更新它**（system 段不参与）。
    """
    bare = pack.model_copy(update={"anchors": []})
    user = _user_prompt(bare, [], opening=True, max_steps=3)
    if user != _GOLDEN_NO_ANCHOR_PROMPT:
        diff = [
            (index, expected, actual)
            for index, (expected, actual) in enumerate(
                zip(_GOLDEN_NO_ANCHOR_PROMPT.splitlines(), user.splitlines(), strict=False)
            )
            if expected != actual
        ]
        pytest.fail(f"不声明 anchors 的 pack 提示词变了（首个差异：{diff[:3]}；行数 {len(user.splitlines())}）")
    # 同一个包声明了 anchors 时，差异**只**是新增的「# 锚点」一节
    assert "# 锚点" in _user_prompt(pack, [], opening=True, max_steps=3)
