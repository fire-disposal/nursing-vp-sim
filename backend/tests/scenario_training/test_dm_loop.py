"""DM 受限多步循环：先读环境，再产出信封（docs/21 §四）。

守的是**可观察的机制**，不是"输出像不像"：
- 读工具往返真的发生，并被记成 `dm_step`（回放/统计的取数来源）；
- 步数有上限：超预算仍要工具 → 退保单步，**绝不**给学生一个空回合；
- 工具失败/未知工具不炸，信封照样合法；
- `note.write` 只进 DM 的草稿纸（学生不可见），并随事件流回放；
- 提示词里"工具一节"随上限开关，并且**仍然列全**信封字段（契约漂移守卫）。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from modules.scenario_training.dm.contract import ENVELOPE_KEYS, DMTurn, parse_steps, parse_turn, validate_turn
from modules.scenario_training.dm.prompt import build_dm_messages
from modules.scenario_training.dm.runner import run_dm
from modules.scenario_training.dm.tools import TOOL_NAMES, run_tool
from modules.scenario_training.runtime.world import World, initial_world, world_from_events
from modules.scenario_training.schema import AffordanceType, EffectOp, ScenarioPack

ENVELOPE: dict[str, Any] = {"narration": "监护仪还在响。", "lines": [{"actor": "patient", "text": "……"}]}

#: 线上那一回合的**逐字原文**（2026-09-28 06:35:33 生产 `llm_call_logs.response_text`，`status=success`，135 字节）：
#: 模型在**一次响应**里发了三条工具调用（一行一个 JSON 对象），而解析层只认"整段就是一个对象"——
#: `safe_parse_json` 从第一个 `{` 切到最后一个 `}`，三条被切成一段 `Extra data`，
#: 问题串 `dm_parse:无法解析LLM返回的JSON: {...}`，整回合降级成保底。
PRODUCTION_BATCH = (
    '{"tool": "world.state", "args": {}}\n'
    '{"tool": "actor.knowledge", "args": {"who": "patient"}}\n'
    '{"tool": "history.lastN", "args": {"n": 6}}'
)


@pytest.fixture(scope="module")
def pack() -> ScenarioPack:
    from modules.scenario_training.pack_loader import load_pack_file

    return load_pack_file("sputum-ineffective")


class _ScriptedLLM:
    """按顺序回放预置输出；用尽后回一个空信封。记录每次调用收到的消息。"""

    def __init__(self, outputs: list[str]) -> None:
        self.outputs = list(outputs)
        self.calls: list[list[dict[str, str]]] = []

    async def call(self, messages: list[dict[str, str]], **_: Any) -> str:
        self.calls.append([dict(message) for message in messages])
        return self.outputs.pop(0) if self.outputs else json.dumps(ENVELOPE, ensure_ascii=False)


class _StreamingLLM(_ScriptedLLM):
    async def stream(self, messages: list[dict[str, str]], **_: Any):  # type: ignore[override]
        self.calls.append([dict(message) for message in messages])
        text = self.outputs.pop(0) if self.outputs else json.dumps(ENVELOPE, ensure_ascii=False)
        for index in range(0, len(text), 16):
            yield text[index : index + 16]


def _collector() -> tuple[list[dict[str, Any]], Any]:
    steps: list[dict[str, Any]] = []

    async def on_step(payload: dict[str, Any]) -> None:
        steps.append(payload)

    return steps, on_step


def _tool(tool: str, **args: Any) -> str:
    return json.dumps({"tool": tool, "args": args}, ensure_ascii=False)


def test_dm_can_read_the_environment_before_the_envelope(pack: ScenarioPack) -> None:
    """一步读工具 → 结果回到对话里 → 再产出信封。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("world.state"), json.dumps(ENVELOPE, ensure_ascii=False)])
    world = initial_world(pack)

    turn, problems = asyncio.run(
        run_dm(llm, pack, world, None, [], user_id=1, max_steps=3, on_step=on_step),
    )

    assert problems == []
    assert turn.narration == ENVELOPE["narration"]
    assert len(llm.calls) == 2
    assert len(steps) == 1
    assert {key: value for key, value in steps[0].items() if key != "ms"} == {
        "turn": 0,
        "step": 1,
        "tool": "world.state",
        "args": {},
        "ok": True,
        "result": f"turn=0 state={len(world.state)} 项",
    }
    assert isinstance(steps[0]["ms"], int)
    # 读到的结果确实注入了下一轮（否则"先看后做"就是空话）
    readback = "\n".join(message["content"] for message in llm.calls[1])
    assert "# 工具 world.state 的结果" in readback
    assert "scene.spo2" in readback


def test_the_production_batch_reads_three_calls_in_order(pack: ScenarioPack) -> None:
    """线上逐字原文：三条调用**按顺序**执行、三条结果**按顺序**回注，随后照常交付信封（不再降级）。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([PRODUCTION_BATCH, json.dumps(ENVELOPE, ensure_ascii=False)])
    world = initial_world(pack)

    turn, problems = asyncio.run(run_dm(llm, pack, world, None, [], user_id=1, max_steps=3, on_step=on_step))

    assert problems == []
    assert turn.narration == ENVELOPE["narration"]
    assert [(step["step"], step["tool"], step["ok"]) for step in steps] == [
        (1, "world.state", True),
        (2, "actor.knowledge", True),
        (3, "history.lastN", True),
    ]
    assert len(llm.calls) == 2, "一批读完 ⇒ 下一轮直接交付信封"
    # 一批 = 一条 assistant（回显它自己发的原文）+ 一条 user（结果按顺序拼在一起）
    assert [message["role"] for message in llm.calls[1]] == ["system", "user", "assistant", "user"]
    readback = llm.calls[1][-1]["content"]
    order = [readback.index(f"# 工具 {tool} 的结果") for tool in ("world.state", "actor.knowledge", "history.lastN")]
    assert order == sorted(order), "结果必须按调用顺序回注"
    assert "scene.spo2" in readback  # world.state 的内容真的到了下一轮
    assert '"id": "patient"' in readback  # actor.knowledge 的内容真的到了下一轮


def test_a_batch_beyond_the_step_budget_reads_up_to_the_budget(pack: ScenarioPack) -> None:
    """步数按**条数**计：上限 2 + 三条调用 → 前两条执行，第三条不执行并在回注里说明预算已用尽。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([PRODUCTION_BATCH, json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(
        run_dm(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=2, on_step=on_step)
    )

    assert [step["tool"] for step in steps] == ["world.state", "actor.knowledge"]
    assert problems == ["dm_step_budget_exhausted:history.lastN"]
    assert turn.narration == ENVELOPE["narration"]
    readback = llm.calls[1][-1]["content"]
    assert readback.count("# 工具 ") == 2
    assert "# 步数已用尽" in readback


def test_a_batch_with_an_unknown_tool_reads_the_rest_and_reports_it(pack: ScenarioPack) -> None:
    """一批里混一条不合法：合法的照读、不合法的那条**不执行**，并留一条带原文片段的问题串。"""
    steps, on_step = _collector()
    raw = (
        '{"tool": "world.state", "args": {}}\n'
        '{"tool": "actor.knowledge", "args": {"who": "patient"}}\n'
        '{"tool": "cure_everything", "args": {}}'
    )
    llm = _ScriptedLLM([raw, json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(
        run_dm(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3, on_step=on_step)
    )

    assert [step["tool"] for step in steps] == ["world.state", "actor.knowledge"]
    assert problems == ['dm_step_invalid:unknown_tool:cure_everything:{"tool": "cure_everything", "args": {}}'], (
        "被拒的那条要带原文片段（诊断看得到模型发了什么）"
    )
    assert turn.narration == ENVELOPE["narration"]
    readback = llm.calls[1][-1]["content"]
    assert "# 这次工具调用不合法，已跳过" in readback
    assert "cure_everything" in readback


def test_an_unknown_tool_alone_is_rejected_and_retried(pack: ScenarioPack) -> None:
    """只有一条未知工具名：**不执行**（没有 `dm_step`）→ 纠偏重试 → 回合仍然交付信封。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("cure_everything"), json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=on_step))

    assert steps == [], "被拒的调用不产生 `dm_step`"
    assert len(llm.calls) == 2, "一次纠偏重试（不空转、也不重复烧调用）"
    assert problems == ['dm_step_invalid:unknown_tool:cure_everything:{"tool": "cure_everything", "args": {}}']
    assert turn.narration == ENVELOPE["narration"]
    hint = llm.calls[1][-1]["content"]
    assert "# 这次工具调用不合法，已跳过" in hint
    assert "world.state" in hint, "纠偏话术要把可用工具再说一遍，否则模型还会照着发"


def test_unextractable_output_is_still_rejected(pack: ScenarioPack) -> None:
    """损坏且**提取不出任何 JSON 对象** → 仍然拒绝：不当工具调用、不当信封（走重试/保底）。"""
    broken = '{"tool": "world.state", "args": '

    assert parse_steps(broken).is_step is False

    steps, on_step = _collector()
    llm = _ScriptedLLM([broken, json.dumps(ENVELOPE, ensure_ascii=False)])
    turn, problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=on_step))

    assert steps == []
    assert problems[0].startswith("dm_truncated:"), "截断要走「压缩输出」那条纠偏路径"
    assert "world.state" in problems[0], "问题串要带原文（诊断看不到原文就只能猜）"
    assert turn.narration == ENVELOPE["narration"]


def test_step_budget_is_bounded_and_falls_back_to_a_legal_envelope(pack: ScenarioPack) -> None:
    """永远在调工具 → 用尽预算后不再空转：退化到无 LLM 的保底回合（学生看不到空回合）。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("world.state")] * 10)

    turn, problems = asyncio.run(
        run_dm(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3, on_step=on_step)
    )

    assert len(steps) == 3, "步数上限就是 3"
    assert len(llm.calls) == 5, "3 步 + 2 次交付尝试（预算用尽后仍要工具 ⇒ 不再给步）"
    assert [problem.split(":")[0] for problem in problems] == [
        "dm_step_budget_exhausted",
        "dm_step_budget_exhausted",
        "dm_fallback",
    ]
    assert turn.narration  # 保底回合也必须有内容
    assert turn.options


def test_tool_that_reports_an_error_does_not_break_the_turn(pack: ScenarioPack) -> None:
    """工具**内部**出错（问的是名录外的人）：错误交回给 DM，信封照样产出。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("actor.knowledge", who="nobody"), json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=on_step))

    assert problems == []
    assert turn.narration == ENVELOPE["narration"]
    assert steps[0]["ok"] is False
    assert "unknown_actor:nobody" in steps[0]["result"]
    assert "unknown_actor:nobody" in "\n".join(message["content"] for message in llm.calls[1])


def test_unreadable_state_is_reported_not_guessed(pack: ScenarioPack) -> None:
    """包外的人不许编：`actor.knowledge` 只回已声明角色，问别人就给 error + 名册。"""
    world = initial_world(pack)

    assert run_tool(pack, world, "actor.knowledge", {"who": "nobody"}) == {
        "error": "unknown_actor:nobody",
        "actors": [actor.id for actor in pack.actors],
    }
    known = run_tool(pack, world, "actor.knowledge", {"who": "patient"})
    assert known["id"] == "patient"
    assert known["knows"] == pack.actor("patient").knowledge


def test_note_write_keeps_a_scratchpad_the_student_never_sees(pack: ScenarioPack) -> None:
    """便条：写进 DM 的草稿纸（不进视图），随 `dm_step` 事件回放，并回到下一回合的提示词。"""
    from modules.scenario_training.runtime.view import build_view

    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("note.write", text="学生始终没问过敏史——下回合让他自己想起来"), json.dumps(ENVELOPE)])
    world = initial_world(pack)

    asyncio.run(run_dm(llm, pack, world, None, [], user_id=1, on_step=on_step))

    assert steps[0]["tool"] == "note.write"
    assert steps[0]["args"]["text"].startswith("学生始终没问过敏史")
    assert world.dm_notes == ["学生始终没问过敏史——下回合让他自己想起来"]

    # 回放：事件流重建出同一份草稿纸
    replayed = world_from_events(pack, [{"kind": "dm_step", "payload": steps[0]}])
    assert replayed.dm_notes == world.dm_notes
    # 学生视图里没有它（草稿纸不是线索板）
    view = build_view(pack, replayed, session_id=1, status="active", revision_id=1)
    assert "过敏史" not in json.dumps(view, ensure_ascii=False)
    # 下一回合的提示词带上它
    prompt = build_dm_messages(pack, replayed, None, [], max_steps=3)
    assert "# 你之前的便条（只有你能看见）" in prompt[1]["content"]
    assert "过敏史" in prompt[1]["content"]


def test_tool_round_trip_does_not_weaken_the_guards(pack: ScenarioPack) -> None:
    """读工具不改变守卫：越权 effects 键、未揭示线索、未声明动作仍然一律被丢。"""
    llm = _ScriptedLLM(
        [
            _tool("history.lastN", n=5),
            json.dumps(
                {
                    "narration": "……",
                    "effects": [{"target": "scene", "key": "ghost", "op": "set", "value": 1}],
                    "reveals": ["c_not_declared"],
                    "interpretation": {"affordance_id": "cure_everything"},
                }
            ),
        ]
    )

    turn, _problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=None))
    check = validate_turn(pack, turn)

    assert check.turn.effects == []
    assert check.turn.reveals == []
    assert check.turn.interpretation is None
    assert "undeclared_state_key:scene.ghost" in check.problems
    assert "unknown_cue:c_not_declared" in check.problems
    assert "unknown_affordance:cure_everything" in check.problems


def test_stream_path_runs_the_same_loop_without_leaking_tool_fields(pack: ScenarioPack) -> None:
    """流式路径同循环：工具那一轮不推块（那些字段不属于信封），信封轮照常推。"""
    from modules.scenario_training.dm.runner import iter_dm_stream

    steps, on_step = _collector()
    llm = _StreamingLLM([_tool("world.state"), json.dumps(ENVELOPE, ensure_ascii=False)])

    async def drain() -> list[dict[str, Any]]:
        return [
            item
            async for item in iter_dm_stream(
                llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3, on_step=on_step
            )
        ]

    items = asyncio.run(drain())

    kinds = [item["kind"] for item in items]
    assert kinds.count("turn") == 1
    assert kinds[-1] == "turn"
    assert kinds.count("blocks") >= 1
    for item in items:
        if item["kind"] == "blocks":  # 工具那一轮一个块都不该推出去（那些字段不属于信封）
            assert set(item["blocks"]) <= ENVELOPE_KEYS
    assert items[-1]["turn"].narration == ENVELOPE["narration"]
    assert len(llm.calls) == 2, "一轮工具 + 一轮信封"
    assert steps[0]["tool"] == "world.state"


def test_stream_path_degrades_when_the_budget_runs_out(pack: ScenarioPack) -> None:
    """流式 + 预算用尽仍在要工具 → 退单步，最后仍给出合法信封（不给空回合）。"""
    from modules.scenario_training.dm.runner import iter_dm_stream

    llm = _StreamingLLM([_tool("world.state")] * 8)

    async def drain() -> list[dict[str, Any]]:
        return [item async for item in iter_dm_stream(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=1)]

    items = asyncio.run(drain())

    assert [item["kind"] for item in items] == ["turn"]
    assert items[0]["turn"].narration
    assert any(problem.startswith("dm_fallback") for problem in items[0]["problems"])


def test_prompt_declares_the_tools_and_every_envelope_field(pack: ScenarioPack) -> None:
    """契约漂移守卫：提示词必须列全信封字段；工具一节随步数上限开关。"""
    world = initial_world(pack)
    with_tools = build_dm_messages(pack, world, None, [], max_steps=3)
    system, user = with_tools[0]["content"], with_tools[1]["content"]

    # `delegate` 是冻结的预留路径（docs/21 §三：无 pack 声明 dedicated），提示词刻意不提供
    for field in set(DMTurn.model_fields) - {"delegate"}:
        assert field in system, f"信封字段 {field} 没写进提示词（契约与提示词漂移）"
    for tool in TOOL_NAMES:
        assert tool in user, f"工具 {tool} 没写进提示词"
    assert "最多 3 步" in user

    single = build_dm_messages(pack, world, None, [], max_steps=0)
    assert "工具" not in single[1]["content"].split("# 本回合")[0].split("## 可用图片")[-1]


def test_prompt_carries_form_actions_when_they_are_the_next_step(pack: ScenarioPack) -> None:
    """表单型动作只能由 DM 的 `options` 带出（前端不再陈列动作清单）；
    提示词必须点出"自然下一步时放进 options"，否则该能力实际不可达（2026-09-28 审计）。"""
    system = build_dm_messages(pack, initial_world(pack), None, [], max_steps=0)[0]["content"]

    line = next(line for line in system.splitlines() if "表单型" in line)
    assert "options" in line, "表单型动作的出口必须写清是 options"


def test_prompt_spells_out_the_enum_whitelists(pack: ScenarioPack) -> None:
    """契约漂移守卫（实测坑 2026-09-28，线上事件流）：DM 自造 `options[].type`（写了枚举之外的值）
    会让解析层整回合判错——流式与非流式各失败一次，白花一次调用才重试成功。

    所以这两个枚举必须在提示词里**逐字**列出，且与契约同源（枚举一改，提示词跟着改）。
    """
    system = build_dm_messages(pack, initial_world(pack), None, [], max_steps=0)[0]["content"]

    assert "、".join(kind.value for kind in AffordanceType) in system, "options[].type 的允许取值没逐字列出"
    assert "、".join(operation.value for operation in EffectOp) in system, "effects[].op 的允许取值没逐字列出"
    assert "`options[].type`" in system
    assert "`effects[].op`" in system


def test_prompt_carries_the_declared_board_sections(pack: ScenarioPack) -> None:
    """实测坑（跨会话反复）：DM 把 `notes[].section` 写成未声明的版块（「既往」「查体」…），
    引擎按白名单整条丢弃 → **笔记内容直接丢了**。

    提示词必须给出该 pack 声明的版块 id + 标题，并点明「只能取这里的值、拿不准就留空」。
    """
    user = build_dm_messages(pack, initial_world(pack), None, [], max_steps=0)[1]["content"]

    assert "## 线索板版块" in user
    assert "`notes[].section` 只能取这里的 id" in user
    for section in pack.presentation.board:
        assert section.id in user, f"版块 id {section.id} 没写进提示词"
        assert section.title in user, f"版块标题 {section.title} 没写进提示词"
    # 默认版块（= 引擎投影笔记的地方）也要点名，DM 才有"取不到就留空"的退路
    defaults = [section.id for section in pack.presentation.board if section.source == "note"]
    assert defaults
    assert "默认版块" in user
    for section_id in defaults:
        assert section_id in user


def test_prompt_states_the_engine_rule_for_packs_without_board_sections(pack: ScenarioPack) -> None:
    """没声明版块的 pack：提示词必须明说"没有额外版块、notes 不写 section"，且与引擎行为一致。"""
    bare = pack.model_copy(update={"presentation": pack.presentation.model_copy(update={"board": []})})
    user = build_dm_messages(bare, initial_world(bare), None, [], max_steps=0)[1]["content"]

    assert "没有额外版块" in user
    assert "不写 section" in user
    assert "不要输出 `notes`" in user

    check = validate_turn(bare, DMTurn.model_validate({"notes": [{"text": "试着记一笔", "section": "既往"}]}))
    assert check.turn.notes == []
    assert "board_not_declared" in check.problems


def test_prompt_names_every_whitelist_it_enforces(pack: ScenarioPack) -> None:
    """其余白名单（`reveals` / `images` / `lines[].actor` / `notes[].section`）都要在提示里可查，
    并且指到 user 段里真实存在的那一节——否则 DM 只能靠猜（实测的丢弃就是这么来的）。"""
    world = initial_world(pack)
    system = build_dm_messages(pack, world, None, [], max_steps=0)[0]["content"]
    user = build_dm_messages(pack, world, None, [], max_steps=0)[1]["content"]

    for pointer in (
        "「尚未揭示的线索」",
        "「可用图片」",
        "「在场者」",
        "「线索板版块」",
        "「可改状态」",
        "「可做动作」",
    ):
        assert pointer in system
    for heading in ("## 尚未揭示的线索", "## 可用图片", "## 在场者", "## 线索板版块", "## 可改状态", "## 可做动作"):
        assert heading in user


def test_unrevealed_cue_texts_never_reach_the_prompt(pack: ScenarioPack) -> None:
    """给 id 白名单 ≠ 提前抖出内容：未揭示线索只给 id，**文本一个字都不进提示词**（安全不变量 #2）。"""
    world = initial_world(pack)
    user = build_dm_messages(pack, world, None, [], max_steps=0)[1]["content"]
    unrevealed = [cue for cue in pack.setting.cues if cue.id not in set(world.revealed)]

    assert unrevealed
    for cue in unrevealed:
        assert cue.id in user, "id 白名单必须给全（那是 `reveals` 的校验集）"
        assert cue.text not in user, "未揭示线索的文本不得出现在提示词里"


def test_parse_steps_only_reads_tool_calls() -> None:
    """只有"要工具"的输出才算一步：带信封字段的输出一律按信封处理（不吞半成品叙述）。"""
    batch = parse_steps('{"tool": "world.state", "args": {}}')

    assert [call.tool for call in batch.calls] == ["world.state"]
    assert batch.calls[0].args == {}
    assert batch.problem is None
    assert [call.tool for call in parse_steps(_tool("note.write", text="x")).calls] == ["note.write"]
    # 带信封字段 = 信封（含"半成品叙述"），不是工具调用
    assert parse_steps(json.dumps(ENVELOPE, ensure_ascii=False)).is_step is False
    assert parse_steps('{"tool": "world.state", "narration": "让我看看"}').is_step is False
    assert parse_steps("不是 JSON").is_step is False  # 散文里根本没有对象
    assert parse_steps("{}").is_step is False
    # 有 `tool` 键却写成别的类型 = 要工具的意图但不合法：拒绝并说明（不静默当成"没看懂"）
    assert parse_steps('{"tool": 3}').problem == 'dm_step_invalid:bad_tool_name:{"tool": 3}'
    # 工具调用不会被当成"空信封"落地
    assert parse_turn('{"tool": "world.state"}') == DMTurn()


def test_wrong_args_shape_is_rejected_not_silently_emptied() -> None:
    """`args` 形状错（数组/字符串）→ 拒绝并留问题串；默默按空参执行 = 替模型猜它想读什么。"""
    assert parse_steps('{"tool": "history.lastN", "args": [3]}').problem == (
        'dm_step_invalid:bad_args:list:{"tool": "history.lastN", "args": [3]}'
    )
    assert parse_steps('{"tool": "history.lastN", "args": "3"}').problem == (
        'dm_step_invalid:bad_args:str:{"tool": "history.lastN", "args": "3"}'
    )


@pytest.mark.parametrize(
    "raw",
    [
        '{"tool": "world.state", "args": {}}',  # 原文（空 args）
        '```json\n{"tool": "world.state", "args": {}}\n```',  # 代码围栏
        '我先看一下情况。\n{"tool": "world.state", "args": {}}\n（读完再回答）',  # 前后夹自然语言
        '我先看看{世界状态}吧\n{"tool": "world.state", "args": {}}',  # 散文里也带花括号
        '{"tool": "world.state"}',  # 只有工具名，没有 args 键
        '{"tool": "world.state", "args": null}',  # args 写成 null
        '{"tool": "world.state()", "args": {}}',  # 照抄提示词里的带括号签名
        '{"tool"： "world.state", "args": {}}',  # 全角冒号
        '{"tool": "world.state"，"args": {}}',  # 全角逗号
        '{"tool":\u3000"world.state", "args": {}}',  # 全角空格
        '{"tool": "world.state",\u200b "args": {}}',  # 零宽字符
        "{\u201ctool\u201d: \u201cworld.state\u201d, \u201cargs\u201d: {}}",  # 弯引号
        '{"tool": "world.state", "args": {},}',  # 尾随逗号
    ],
)
def test_a_call_is_recognized_however_the_model_wraps_it(raw: str) -> None:
    """模型"会怎么发"的各类写法都必须认出来（线上那回合就是被这些差异之一判死的）。"""
    batch = parse_steps(raw)

    assert batch.problem is None, f"{raw!r} 应当被认成合法调用"
    assert [call.tool for call in batch.calls] == ["world.state"]
    assert batch.calls[0].args == {}


def test_a_wrapped_call_still_reads_the_environment(pack: ScenarioPack) -> None:
    """围栏 / 散文 / 全角字符只是**包装**：整条循环里一样读得到（旧实现这里整回合降级成保底）。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM(
        ['让我先看一眼。\n```json\n{"tool"： "world.state", "args": {}}\n```', json.dumps(ENVELOPE, ensure_ascii=False)]
    )

    turn, problems = asyncio.run(
        run_dm(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3, on_step=on_step)
    )

    assert problems == []
    assert [step["tool"] for step in steps] == ["world.state"]
    assert turn.narration == ENVELOPE["narration"]


def test_a_batch_is_read_on_the_stream_path_too(pack: ScenarioPack) -> None:
    """流式路径共用同一套循环：一次响应三条调用 ⇒ 三条 `dm_step`，然后交付信封。"""
    from modules.scenario_training.dm.runner import iter_dm_stream

    steps, on_step = _collector()
    llm = _StreamingLLM([PRODUCTION_BATCH, json.dumps(ENVELOPE, ensure_ascii=False)])

    async def drain() -> list[dict[str, Any]]:
        return [
            item
            async for item in iter_dm_stream(
                llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3, on_step=on_step
            )
        ]

    items = asyncio.run(drain())

    assert items[-1]["kind"] == "turn"
    assert items[-1]["turn"].narration == ENVELOPE["narration"]
    assert items[-1]["problems"] == []
    assert [step["tool"] for step in steps] == ["world.state", "actor.knowledge", "history.lastN"]
    assert len(llm.calls) == 2


def test_normalization_never_rewrites_string_contents() -> None:
    """规整只碰结构：字符串里的中文标点与转义引号一字不改（否则是在改 DM 的正文）。"""
    batch = parse_steps('{"tool": "note.write", "args": {"text": "先问，再写：核对「他说\\"别动\\"」"}}')

    assert batch.calls[0].args == {"text": '先问，再写：核对「他说"别动"」'}


def test_tool_registry_is_read_only(pack: ScenarioPack) -> None:
    """读工具不改世界；`note.write` 只碰草稿纸。"""
    world: World = initial_world(pack)
    before = (dict(world.state), list(world.actions), list(world.revealed))

    run_tool(pack, world, "world.state", {})
    run_tool(pack, world, "history.lastN", {"n": 3})
    run_tool(pack, world, "actor.knowledge", {"who": "patient"})
    run_tool(pack, world, "note.write", {"text": "提醒自己"})

    assert (dict(world.state), list(world.actions), list(world.revealed)) == before
    assert world.dm_notes == ["提醒自己"]


def test_degenerate_output_is_not_delivered_as_an_empty_turn(pack: ScenarioPack) -> None:
    """实测坑（2026-09-28，真实 DeepSeek）：`response_format` 有时被回显成整个输出。

    `{"type": "json_object"}` 能过 `DMTurn` 校验却什么都没有——它必须算**失败**（重试/保底），
    而不是把空叙述交给学生。
    """
    llm = _ScriptedLLM(['{"type": "json_object"}', json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=None))

    assert problems == ["dm_empty_turn"]
    assert turn.narration == ENVELOPE["narration"]
    assert len(llm.calls) == 2

    empty = _ScriptedLLM(['{"type": "json_object"}'] * 4)
    turn, problems = asyncio.run(run_dm(empty, pack, initial_world(pack), None, [], user_id=1, on_step=None))
    assert problems[-1] == "dm_fallback"
    assert turn.narration  # 保底回合有内容


def test_stream_path_degrades_on_a_degenerate_output(pack: ScenarioPack) -> None:
    """流式同理：退化输出 → 退单步 → 仍然给出有内容的回合。"""
    from modules.scenario_training.dm.runner import iter_dm_stream

    llm = _StreamingLLM(['{"type": "json_object"}', json.dumps(ENVELOPE, ensure_ascii=False)])

    async def drain() -> list[dict[str, Any]]:
        return [item async for item in iter_dm_stream(llm, pack, initial_world(pack), None, [], user_id=1, max_steps=3)]

    items = asyncio.run(drain())

    assert [item["kind"] for item in items] == ["turn"]
    assert items[0]["turn"].narration == ENVELOPE["narration"]


def test_transcript_is_in_turn_order(pack: ScenarioPack) -> None:
    """DM 的观察窗口**按回合时序**：第 N 回合 = 学生做了什么 → 场景 → 台词。

    旧实现按"动作/叙述/台词"分组后再截取，最近一屏常常只剩台词——顺序错了会误导判断。
    """
    events = [
        {
            "kind": "student_action",
            "payload": {"turn": 1, "action": {"turn": 1, "affordance_id": "auscultate", "type": "observe"}},
        },
        {
            "kind": "dm_turn",
            "payload": {
                "turn": 1,
                "narration": "一回合的场景描写",
                "lines": [{"actor": "patient", "text": "一回合的台词"}],
            },
        },
        {
            "kind": "student_action",
            "payload": {"turn": 2, "action": {"turn": 2, "affordance_id": "measure_spo2", "type": "measure"}},
        },
        {
            "kind": "dm_turn",
            "payload": {
                "turn": 2,
                "narration": "二回合的场景描写",
                "lines": [{"actor": "patient", "text": "二回合的台词"}],
            },
        },
    ]
    world = world_from_events(pack, events)

    assert world.transcript(pack).splitlines() == [
        "第1回合：[学生] 听诊双肺",
        "[场景] 一回合的场景描写",
        "[patient] 一回合的台词",
        "第2回合：[学生] 测血氧",
        "[场景] 二回合的场景描写",
        "[patient] 二回合的台词",
    ]
    # 开场（第 0 回合）单独标"开场"；截取从最近往前（额度是条目数，与旧实现同级），
    # 且截断处仍带回合前缀——只看半屏也知道这是第几回合
    opening = world_from_events(pack, [{"kind": "dm_turn", "payload": {"turn": 0, "narration": "开场描写"}}])
    assert opening.transcript(pack).splitlines() == ["开场：[场景] 开场描写"]
    assert world.transcript(pack, limit=2).splitlines() == [
        "第2回合：[场景] 二回合的场景描写",
        "[patient] 二回合的台词",
    ]
    # `history.lastN` 就是这扇窗口（同一个实现）
    assert run_tool(pack, world, "history.lastN", {"n": 2})["transcript"].splitlines() == [
        "第2回合：[场景] 二回合的场景描写",
        "[patient] 二回合的台词",
    ]
