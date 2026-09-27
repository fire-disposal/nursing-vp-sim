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

from modules.scenario_training.dm.contract import ENVELOPE_KEYS, DMTurn, parse_step, parse_turn, validate_turn
from modules.scenario_training.dm.prompt import build_dm_messages
from modules.scenario_training.dm.runner import run_dm
from modules.scenario_training.dm.tools import TOOL_NAMES, run_tool
from modules.scenario_training.runtime.world import World, initial_world, world_from_events
from modules.scenario_training.schema import ScenarioPack

ENVELOPE: dict[str, Any] = {"narration": "监护仪还在响。", "lines": [{"actor": "patient", "text": "……"}]}


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


def test_unknown_tool_does_not_break_the_turn(pack: ScenarioPack) -> None:
    """未知工具 / 工具内部出错 → 只把错误交回给 DM，信封照样产出。"""
    steps, on_step = _collector()
    llm = _ScriptedLLM([_tool("cure_everything"), json.dumps(ENVELOPE, ensure_ascii=False)])

    turn, problems = asyncio.run(run_dm(llm, pack, initial_world(pack), None, [], user_id=1, on_step=on_step))

    assert problems == []
    assert turn.narration == ENVELOPE["narration"]
    assert steps[0]["ok"] is False
    assert "unknown_tool" in steps[0]["result"]
    assert "unknown_tool:cure_everything" in "\n".join(message["content"] for message in llm.calls[1])


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


def test_parse_step_only_reads_tool_calls(pack: ScenarioPack) -> None:
    """只有"纯工具调用"才算一步：带信封字段的输出一律按信封处理（不吞半成品叙述）。"""
    assert parse_step('{"tool": "world.state", "args": {}}').tool == "world.state"  # type: ignore[union-attr]
    assert parse_step('{"tool": "world.state", "args": {}}').args == {}  # type: ignore[union-attr]
    assert parse_step(_tool("note.write", text="x")).tool == "note.write"  # type: ignore[union-attr]
    assert parse_step(json.dumps(ENVELOPE, ensure_ascii=False)) is None
    assert parse_step('{"tool": "world.state", "narration": "让我看看"}') is None
    assert parse_step("不是 JSON") is None
    assert parse_step('{"tool": 3}') is None
    # 工具调用不会被当成"空信封"落地
    assert parse_turn('{"tool": "world.state"}') == DMTurn()


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
